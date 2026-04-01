// Instruction Generator
// Generates actionable coach instructions for a resource, personalised
// to the athlete's current training context.
//
// Unlike the summary (generic), instructions are athlete-specific:
//   "Given your current base phase and FTP of 280W, apply this..."
//
// Model: Sonnet — more reasoning needed to bridge resource → athlete context.
// Cost: $3.00/M input, $15.00/M output.
//
// Output written to resource.coach_instructions via PATCH /knowledge/resources/:id.

import Anthropic from '@anthropic-ai/sdk';
import pino from 'pino';
import { apiClient } from '../api/client.js';
import { logUsage } from './usageLogger.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const MODEL = 'claude-sonnet-4-6';
const SONNET_INPUT_COST_PER_TOKEN  = 3.00  / 1_000_000;
const SONNET_OUTPUT_COST_PER_TOKEN = 15.00 / 1_000_000;
const MAX_TOKENS = 800;

const INSTRUCT_PROMPT = `You are an AI coach translating a sports science resource into personalised training instructions for a specific athlete.

Given the athlete's profile and the resource content, write 400-500 words of actionable coaching instructions. Structure:
1. The one most important thing this athlete should take from this resource (1-2 sentences, bold the key point)
2. Specific actions: 2-4 concrete things to do in training, phrased as instructions ("In your next base block, do X")
3. Watch out for: 1-2 common mistakes or misapplications to avoid
4. A suggested experiment: one specific session or test to try that applies this resource's principles

Write in second person, directly to the athlete. Reference their specific numbers (FTP, VDOT, period, etc.) where relevant.
Be specific. No generic advice.`;

// ---------------------------------------------------------------------------
// Build athlete context string
// ---------------------------------------------------------------------------

async function buildAthleteContext() {
  const [athlete, snapshot, period] = await Promise.all([
    apiClient.get('/athlete').catch(() => null),
    apiClient.get('/fitness/snapshot').catch(() => null),
    apiClient.get('/periods/current').catch(() => null),
  ]);

  const parts = [];
  if (athlete?.name)          parts.push(`Athlete: ${athlete.name}`);
  if (athlete?.primary_sport) parts.push(`Sport: ${athlete.primary_sport}`);
  if (athlete?.ftp_watts)     parts.push(`FTP: ${athlete.ftp_watts}W`);
  if (athlete?.vdot)          parts.push(`VDOT: ${athlete.vdot}`);
  if (athlete?.limiter)       parts.push(`Training limiter: ${athlete.limiter}`);
  if (period?.period_type)    parts.push(`Current period: ${period.period_type}${period.sub_period ? ' ' + period.sub_period : ''}`);
  if (snapshot?.ctl)          parts.push(`CTL: ${snapshot.ctl} (fitness)`);
  if (snapshot?.tsb)          parts.push(`TSB: ${snapshot.tsb} (form)`);
  if (snapshot?.readiness_score) parts.push(`Readiness: ${snapshot.readiness_score}/100`);

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Generate instructions for a single resource
// ---------------------------------------------------------------------------

/**
 * @param {object} resource
 * @returns {{ success: boolean, instructions?: string }}
 */
export async function generateInstructions(resource) {
  const resourceId = resource.id;
  log.info({ resourceId, title: resource.title }, 'generating coach instructions');

  // Fetch athlete context and resource chunks in parallel
  const [athleteContext, chunksResult] = await Promise.all([
    buildAthleteContext(),
    apiClient.get(`/knowledge/search?q=${encodeURIComponent(resource.title)}&limit=8`).catch(() => null),
  ]);

  const chunks = chunksResult?.results ?? [];

  const contentParts = [
    `Resource: "${resource.title}"${resource.author ? ' by ' + resource.author : ''}`,
    resource.coach_summary ? `Coach summary:\n${resource.coach_summary}` : null,
    chunks.length
      ? `Key excerpts:\n${chunks.slice(0, 4).map(c => c.content).join('\n\n---\n\n')}`
      : null,
  ].filter(Boolean).join('\n\n');

  const userMessage = [
    `ATHLETE PROFILE\n${athleteContext || 'No athlete profile available.'}`,
    `\nRESOURCE\n${contentParts}`,
    `\n${INSTRUCT_PROMPT}`,
  ].join('\n\n');

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model:      MODEL,
    max_tokens: MAX_TOKENS,
    messages:   [{ role: 'user', content: userMessage }],
  });

  const instructions = response.content[0]?.text?.trim() ?? '';
  const inputTokens  = response.usage?.input_tokens  ?? 0;
  const outTokens    = response.usage?.output_tokens ?? 0;
  const costUsd      = inputTokens * SONNET_INPUT_COST_PER_TOKEN + outTokens * SONNET_OUTPUT_COST_PER_TOKEN;

  log.info({ resourceId, inputTokens, outTokens, costUsd: costUsd.toFixed(6) }, 'instructions generated');

  await logUsage(resourceId, {
    model:         MODEL,
    call_type:     'coach_instructions',
    input_tokens:  inputTokens,
    output_tokens: outTokens,
    cost_usd:      costUsd,
  });

  await apiClient.patch(`/knowledge/resources/${resourceId}`, { coach_instructions: instructions });

  return { success: true, instructions };
}

// ---------------------------------------------------------------------------
// Poller
// ---------------------------------------------------------------------------

export async function pollAndInstruct() {
  const result = await apiClient.get('/knowledge/resources?limit=50');
  const resources = (result?.data ?? []).filter(r =>
    r.coach_instructions_requested_at && !r.coach_instructions
  );

  if (!resources.length) {
    log.debug('no pending instruction requests');
    return [];
  }

  log.info({ count: resources.length }, 'processing pending instruction requests');

  const results = [];
  for (const resource of resources) {
    try {
      const r = await generateInstructions(resource);
      results.push({ resource_id: resource.id, ...r });
    } catch (err) {
      log.error({ resourceId: resource.id, err: err.message }, 'instruction generation failed');
      results.push({ resource_id: resource.id, success: false, error: err.message });
    }
  }

  return results;
}

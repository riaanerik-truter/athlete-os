// Summary Generator
// Generates a coach summary for a resource on request.
// Triggered when resource.coach_summary_requested_at IS NOT NULL AND coach_summary IS NULL.
//
// Model: Haiku — 300-400 word summary, cheap enough to run on-demand.
// Cost: ~$0.80/M input, $4.00/M output.
//
// Output written to resource.coach_summary via PATCH /knowledge/resources/:id.

import Anthropic from '@anthropic-ai/sdk';
import pino from 'pino';
import { apiClient } from '../api/client.js';
import { logUsage } from './usageLogger.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const MODEL = 'claude-haiku-4-5-20251001';
const HAIKU_INPUT_COST_PER_TOKEN  = 0.80 / 1_000_000;
const HAIKU_OUTPUT_COST_PER_TOKEN = 4.00 / 1_000_000;
const MAX_TOKENS = 500;

const SUMMARY_PROMPT = `You are an AI coach summarising a sports science resource for an endurance athlete.

Write a coach summary of this resource in 300-400 words. Structure:
1. What this resource is about (1-2 sentences)
2. The 3-5 key concepts or findings most relevant to endurance training
3. How the athlete can apply this to their training
4. Evidence quality note (brief — one sentence on how much to trust this source)

Write in second person ("you", "your training"). Be direct. No bullet points. No headings.`;

// ---------------------------------------------------------------------------
// Fetch chunks for a resource
// ---------------------------------------------------------------------------

async function getResourceChunks(resourceId) {
  // GET /knowledge/search doesn't filter by resource_id yet.
  // Use the sources endpoint as a fallback; in the full implementation
  // the knowledge engine would query knowledge_chunk directly by resource_id.
  // For now, use the search endpoint with the resource title as a proxy.
  try {
    const resource = await apiClient.get(`/knowledge/resources/${resourceId}`);
    if (!resource) return null;

    const chunks = await apiClient.get(`/knowledge/search?q=${encodeURIComponent(resource.title)}&limit=10`);
    return { resource, chunks: chunks?.results ?? [] };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Generate summary for a single resource
// ---------------------------------------------------------------------------

/**
 * Generates and writes a coach summary for a resource.
 *
 * @param {object} resource - resource record
 * @returns {{ success: boolean, summary?: string }}
 */
export async function generateSummary(resource) {
  const resourceId = resource.id;
  log.info({ resourceId, title: resource.title }, 'generating coach summary');

  // Gather content: use existing chunks if available, else resource metadata
  const data = await getResourceChunks(resourceId);
  const chunks = data?.chunks ?? [];

  // Build the content input: up to 5 chunks + resource metadata
  const contentParts = [
    `Title: ${resource.title}`,
    resource.author ? `Author: ${resource.author}` : null,
    resource.source_type ? `Source type: ${resource.source_type}` : null,
    resource.evidence_level ? `Evidence level: ${resource.evidence_level}` : null,
    resource.topic_tags?.length ? `Topics: ${resource.topic_tags.join(', ')}` : null,
    '',
    chunks.length
      ? `Content excerpts:\n${chunks.slice(0, 5).map(c => c.content).join('\n\n---\n\n')}`
      : '(No chunks available — summarise based on title and metadata only)',
  ].filter(v => v !== null).join('\n');

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model:      MODEL,
    max_tokens: MAX_TOKENS,
    messages:   [{ role: 'user', content: `${SUMMARY_PROMPT}\n\n---\n${contentParts}` }],
  });

  const summary     = response.content[0]?.text?.trim() ?? '';
  const inputTokens = response.usage?.input_tokens  ?? 0;
  const outTokens   = response.usage?.output_tokens ?? 0;
  const costUsd     = inputTokens * HAIKU_INPUT_COST_PER_TOKEN + outTokens * HAIKU_OUTPUT_COST_PER_TOKEN;

  log.info({ resourceId, inputTokens, outTokens, costUsd: costUsd.toFixed(6) }, 'summary generated');

  await logUsage(resourceId, {
    model:         MODEL,
    call_type:     'coach_summary',
    input_tokens:  inputTokens,
    output_tokens: outTokens,
    cost_usd:      costUsd,
  });

  // Write back to resource
  await apiClient.patch(`/knowledge/resources/${resourceId}`, { coach_summary: summary });

  return { success: true, summary };
}

// ---------------------------------------------------------------------------
// Poller: process all pending summary requests
// ---------------------------------------------------------------------------

/**
 * Finds resources with coach_summary_requested_at set but no summary yet,
 * and generates summaries for each.
 */
export async function pollAndSummarise() {
  // Fetch resources that have been requested but not yet processed
  // The API doesn't support filtering by coach_summary_requested_at directly,
  // so we fetch recent resources and filter client-side.
  const result = await apiClient.get('/knowledge/resources?limit=50');
  const resources = (result?.data ?? []).filter(r =>
    r.coach_summary_requested_at && !r.coach_summary
  );

  if (!resources.length) {
    log.debug('no pending summary requests');
    return [];
  }

  log.info({ count: resources.length }, 'processing pending summary requests');

  const results = [];
  for (const resource of resources) {
    try {
      const r = await generateSummary(resource);
      results.push({ resource_id: resource.id, ...r });
    } catch (err) {
      log.error({ resourceId: resource.id, err: err.message }, 'summary generation failed');
      results.push({ resource_id: resource.id, success: false, error: err.message });
    }
  }

  return results;
}

// Topic Suggester (Path C — proactive)
// Generates topic suggestions based on the athlete's current training context.
// Runs daily (or on-demand). Suggestions are written to GET /knowledge/topics
// via a dedicated endpoint (stubbed in API until knowledge engine runs).
//
// Flow:
//   1. Fetch athlete profile, current period, snapshot, recent diary
//   2. Call Haiku with athlete context → returns 3 suggested topics
//   3. For each topic, trigger discoverResources (resourceFinder)
//   4. Post a coach message with the suggestions
//
// Model: Haiku — topic generation is simple reasoning.

import Anthropic from '@anthropic-ai/sdk';
import pino from 'pino';
import { apiClient } from '../api/client.js';
import { logUsage } from '../notes/usageLogger.js';
import { discoverResources } from './resourceFinder.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const MODEL = 'claude-haiku-4-5-20251001';
const HAIKU_INPUT_COST_PER_TOKEN  = 0.80 / 1_000_000;
const HAIKU_OUTPUT_COST_PER_TOKEN = 4.00 / 1_000_000;
const MAX_TOKENS = 300;

const TOPIC_PROMPT = `You are an AI coach identifying knowledge gaps for an endurance athlete.

Based on the athlete's current training context, suggest 3 sports science topics they should learn about right now.
Choose topics that are directly applicable to their current phase and limiters.

Return a JSON array of 3 strings, each a specific topic (not a book title).
Examples: "aerobic decoupling management", "base to build transition criteria", "polarised training intensity distribution"

Return only the JSON array of 3 strings.`;

// ---------------------------------------------------------------------------
// Build athlete context for topic suggestion
// ---------------------------------------------------------------------------

async function buildContext() {
  const [athlete, snapshot, period, diary] = await Promise.all([
    apiClient.get('/athlete').catch(() => null),
    apiClient.get('/fitness/snapshot').catch(() => null),
    apiClient.get('/periods/current').catch(() => null),
    apiClient.get('/diary?limit=3').catch(() => null),
  ]);

  const parts = [];
  if (period?.period_type) {
    parts.push(`Current period: ${period.period_type}${period.sub_period ? ' ' + period.sub_period : ''}`);
    if (period.objective) parts.push(`Period objective: ${period.objective}`);
  }
  if (athlete?.limiter)       parts.push(`Training limiter: ${athlete.limiter}`);
  if (athlete?.primary_sport) parts.push(`Primary sport: ${athlete.primary_sport}`);
  if (snapshot?.ctl != null)  parts.push(`CTL: ${snapshot.ctl}, TSB: ${snapshot.tsb}`);
  if (snapshot?.decoupling_last_long != null) {
    parts.push(`Aerobic decoupling (last long ride): ${snapshot.decoupling_last_long}%`);
  }
  if (snapshot?.readiness_score) parts.push(`Readiness: ${snapshot.readiness_score}/100`);

  const diaryEntries = diary?.data ?? [];
  if (diaryEntries.length) {
    const rpeSummary = diaryEntries
      .filter(e => e.rpe_overall)
      .map(e => `RPE ${e.rpe_overall} on ${e.entry_date}`)
      .join(', ');
    if (rpeSummary) parts.push(`Recent RPE: ${rpeSummary}`);
  }

  return parts.join('\n') || 'No training context available';
}

// ---------------------------------------------------------------------------
// Generate topic suggestions
// ---------------------------------------------------------------------------

/**
 * Generates 3 topic suggestions based on athlete context.
 * Optionally triggers discovery for each topic.
 *
 * @param {object} [options]
 * @param {boolean} [options.triggerDiscovery=false] - auto-discover resources for each topic
 * @returns {{ topics: string[], discoveries: object[] }}
 */
export async function generateTopicSuggestions({ triggerDiscovery = false } = {}) {
  log.info({ triggerDiscovery }, 'generating topic suggestions');

  const context = await buildContext();
  const client  = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model:      MODEL,
    max_tokens: MAX_TOKENS,
    messages:   [{ role: 'user', content: `${TOPIC_PROMPT}\n\nATHLETE CONTEXT:\n${context}` }],
  });

  const raw         = response.content[0]?.text?.trim() ?? '[]';
  const inputTokens = response.usage?.input_tokens  ?? 0;
  const outTokens   = response.usage?.output_tokens ?? 0;
  const costUsd     = inputTokens * HAIKU_INPUT_COST_PER_TOKEN + outTokens * HAIKU_OUTPUT_COST_PER_TOKEN;

  await logUsage('topic_suggester', {
    model:         MODEL,
    call_type:     'topic_suggestions',
    input_tokens:  inputTokens,
    output_tokens: outTokens,
    cost_usd:      costUsd,
  });

  let topics = [];
  try {
    const match = raw.match(/\[[\s\S]*\]/);
    topics = match ? JSON.parse(match[0]).slice(0, 3) : [];
  } catch {
    log.warn({ raw }, 'failed to parse topic suggestions JSON');
    topics = [];
  }

  log.info({ topics }, 'topics generated');

  // Post coach message with suggestions
  if (topics.length) {
    const message = `Based on your current training, here are 3 topics worth exploring:\n\n${topics.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\nWant me to find resources on any of these? Reply with the number or say "find all".`;
    await apiClient.post('/conversations', { role: 'assistant', content: message }).catch(() => {});
  }

  // Optionally trigger discovery for each topic
  const discoveries = [];
  if (triggerDiscovery && topics.length) {
    const athlete = await apiClient.get('/athlete').catch(() => null);
    const sport   = athlete?.primary_sport ?? null;

    for (const topic of topics) {
      try {
        const result = await discoverResources(topic, sport, 'topic_suggester');
        discoveries.push({ topic, ...result });
      } catch (err) {
        log.error({ topic, err: err.message }, 'discovery failed for topic');
      }
    }
  }

  return { topics, discoveries };
}

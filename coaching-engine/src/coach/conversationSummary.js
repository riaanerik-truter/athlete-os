// Conversation Summariser
// Compresses older conversation messages into a single summary string.
// Uses claude-haiku-4-5-20251001 — cheap and fast for summarisation.
//
// Trigger: called after every 20th message written to the conversation table.
// The caller (coachHandler) checks conversation count and calls this when needed.
//
// Result is written to PATCH /conversations/summary and stored on the athlete record.
// Subsequent context builds read this summary and include it in the system context.

import Anthropic from '@anthropic-ai/sdk';
import { apiClient } from '../api/client.js';
import pino from 'pino';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// Model pricing (per token) for cost logging
// claude-haiku-4-5-20251001: $0.80/M input, $4.00/M output
const HAIKU_INPUT_COST_PER_TOKEN  = 0.80  / 1_000_000;
const HAIKU_OUTPUT_COST_PER_TOKEN = 4.00  / 1_000_000;

const SUMMARY_MODEL = 'claude-haiku-4-5-20251001';
const SUMMARY_MAX_TOKENS = 350;
const MESSAGE_TRIGGER_COUNT = 20;

const SUMMARY_PROMPT = `Summarise this coaching conversation in 200 words or less.
Focus on: training decisions made, athlete's physical and mental state, goals discussed, any concerns flagged, plan changes agreed.
Be factual and concise. Write in third person (e.g. "athlete reported..."). Do not use bullet points.`;

// ---------------------------------------------------------------------------
// Main summariser
// ---------------------------------------------------------------------------

/**
 * Fetches the most recent messages, summarises them with Haiku,
 * and writes the result to the athlete record via PATCH /conversations/summary.
 *
 * @param {string} athleteId   - used for usage logging
 * @param {object} [options]
 * @param {number} [options.messageLimit=20] - how many messages to summarise
 * @returns {{ summary: string, tokens: object, cost_usd: number } | null}
 */
export async function updateConversationSummary(athleteId, { messageLimit = MESSAGE_TRIGGER_COUNT } = {}) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Fetch recent messages
  const result = await apiClient.get(`/conversations?limit=${messageLimit}`);
  const messages = result?.data ?? [];

  if (messages.length < 5) {
    log.info({ count: messages.length }, 'too few messages to summarise');
    return null;
  }

  // Format for the summarisation call
  const transcript = messages
    .slice()
    .reverse()  // API returns newest-first; we want chronological
    .map(m => `[${m.role.toUpperCase()}] ${m.content}`)
    .join('\n');

  log.info({ messageCount: messages.length, model: SUMMARY_MODEL }, 'summarising conversation');

  const response = await client.messages.create({
    model:      SUMMARY_MODEL,
    max_tokens: SUMMARY_MAX_TOKENS,
    messages: [
      {
        role:    'user',
        content: `${SUMMARY_PROMPT}\n\n---\n${transcript}`
      }
    ]
  });

  const summary     = response.content[0]?.text?.trim() ?? '';
  const inputTokens = response.usage?.input_tokens  ?? 0;
  const outTokens   = response.usage?.output_tokens ?? 0;
  const costUsd     = inputTokens * HAIKU_INPUT_COST_PER_TOKEN + outTokens * HAIKU_OUTPUT_COST_PER_TOKEN;

  log.info({ inputTokens, outTokens, costUsd: costUsd.toFixed(6) }, 'summarisation complete');

  // Write summary to athlete record
  await apiClient.patch('/conversations/summary', { summary });

  // Log API usage
  await logUsage(athleteId, {
    model:         SUMMARY_MODEL,
    call_type:     'conversation_summary',
    input_tokens:  inputTokens,
    output_tokens: outTokens,
    cost_usd:      costUsd,
  });

  return {
    summary,
    tokens:   { input: inputTokens, output: outTokens },
    cost_usd: costUsd,
  };
}

/**
 * Checks whether a summarisation run is needed.
 * Returns true if the message count is a multiple of MESSAGE_TRIGGER_COUNT.
 *
 * @param {number} totalMessageCount - current total messages in the conversation
 */
export function shouldSummarise(totalMessageCount) {
  return totalMessageCount > 0 && totalMessageCount % MESSAGE_TRIGGER_COUNT === 0;
}

// ---------------------------------------------------------------------------
// Usage logger (shared by all coach layer functions that call Anthropic)
// ---------------------------------------------------------------------------

/**
 * Writes an api_usage_log row via POST /usage/log.
 * All Anthropic API calls in the coaching engine must call this after completion.
 *
 * Since the API layer doesn't expose a POST /usage/log endpoint yet, we call
 * the internal db function via a lightweight inline approach:
 * writes directly by POST-ing to the API.
 *
 * @param {string} athleteId
 * @param {object} data
 */
export async function logUsage(athleteId, data) {
  try {
    // POST to a dedicated usage log endpoint (added to API as part of coaching engine setup)
    // Until that endpoint exists, we use a no-op so the coaching engine doesn't crash.
    // The endpoint can be added to routes/usage.js as POST /usage/log.
    await apiClient.post('/usage/log', {
      service:       'anthropic',
      call_type:     data.call_type,
      model:         data.model,
      input_tokens:  data.input_tokens,
      output_tokens: data.output_tokens,
      cost_usd:      data.cost_usd,
      currency:      'USD',
      context_mode:  data.context_mode ?? null,
      engine_mode:   data.engine_mode  ?? null,
      metadata:      data.metadata     ?? null,
    });
  } catch (err) {
    // Usage logging is non-critical — never let it break a coaching response
    log.warn({ err: err.message }, 'usage log write failed (non-fatal)');
  }
}

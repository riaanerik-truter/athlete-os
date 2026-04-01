// Coach Handler
// Main entry point for all incoming athlete messages.
// Orchestrates: intent → context → Anthropic call → usage logging → response.
//
// Model selection:
//   Haiku  — coach_chat, log_session, view_plan, update_diary, show_stats, help
//   Sonnet — run_gate_check, import_plan, onboarding (complex reasoning required)
//
// Called by the messaging service webhook for every inbound WhatsApp message.
// Returns a string (the coach's reply) ready to send back.

import Anthropic from '@anthropic-ai/sdk';
import pino from 'pino';

import { apiClient } from '../api/client.js';
import { classifyIntent, isComplexIntent } from './intentClassifier.js';
import { buildContext } from './contextBuilder.js';
import { shouldSummarise, updateConversationSummary, logUsage } from './conversationSummary.js';
import { checkProgressionGate } from '../planning/progressionGates.js';
import { getCurrentLoad } from '../planning/loadCalculator.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// Model config
const HAIKU_MODEL  = 'claude-haiku-4-5-20251001';
const SONNET_MODEL = 'claude-sonnet-4-6';

const HAIKU_INPUT_COST_PER_TOKEN  = 0.80  / 1_000_000;
const HAIKU_OUTPUT_COST_PER_TOKEN = 4.00  / 1_000_000;
const SONNET_INPUT_COST_PER_TOKEN = 3.00  / 1_000_000;
const SONNET_OUTPUT_COST_PER_TOKEN = 15.00 / 1_000_000;

const MAX_TOKENS_HAIKU  = 600;
const MAX_TOKENS_SONNET = 1200;

// ---------------------------------------------------------------------------
// Intent-specific response augmenters
// These run before the Anthropic call to inject structured data into the
// conversation when the intent maps to a deterministic lookup.
// ---------------------------------------------------------------------------

/**
 * Builds a stats preamble injected into the user turn for show_stats intent.
 * Reduces hallucination risk — coach sees real numbers before commenting.
 */
async function buildStatsPreamble() {
  try {
    const [load, snapshot] = await Promise.all([
      getCurrentLoad(),
      apiClient.get('/fitness/snapshot'),
    ]);
    const parts = ['[Current training data]'];
    if (load?.ctl != null) parts.push(`CTL ${load.ctl.toFixed(1)}, ATL ${load.atl.toFixed(1)}, TSB ${load.tsb.toFixed(1)}`);
    if (snapshot?.ftp_current) parts.push(`FTP ${snapshot.ftp_current}W`);
    if (snapshot?.vdot_current) parts.push(`VDOT ${snapshot.vdot_current}`);
    if (snapshot?.readiness_score) parts.push(`Readiness ${snapshot.readiness_score}/100`);
    return parts.join(' | ');
  } catch {
    return null;
  }
}

/**
 * Builds a gate check preamble injected into the user turn for run_gate_check.
 */
async function buildGatePreamble(period) {
  if (!period) return null;
  const fromType = period.period_type;
  const toMap = { base: 'build', build: 'peak', peak: 'race' };
  const toType = toMap[fromType];
  if (!toType) return `[Currently in ${fromType} period — no gate applies]`;

  try {
    const gateResult = await checkProgressionGate(fromType, period);
    const lines = [`[Gate check: ${fromType} → ${toType}]`];
    lines.push(`Passed: ${gateResult.passed ? 'YES' : 'NO'} (${gateResult.failed_count} condition(s) failed)`);
    for (const c of gateResult.conditions) {
      lines.push(`  ${c.passed ? '✓' : '✗'} ${c.name}: ${c.actual ?? 'no data'} (required: ${c.required})`);
    }
    return lines.join('\n');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Message storage
// ---------------------------------------------------------------------------

async function saveMessage(role, content) {
  try {
    await apiClient.post('/conversations', { role, content });
  } catch (err) {
    log.warn({ err: err.message }, 'failed to save conversation message');
  }
}

async function getConversationHistory() {
  try {
    const result = await apiClient.get('/conversations?limit=40');
    const raw = result?.data ?? [];
    // API returns newest-first; reverse for chronological order
    return raw.reverse().map(m => ({ role: m.role, content: m.content }));
  } catch {
    return [];
  }
}

async function getMessageCount() {
  try {
    const result = await apiClient.get('/conversations?limit=1');
    return result?.total ?? result?.data?.length ?? 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * Handles an inbound athlete message end-to-end.
 *
 * @param {string} message   - raw text from WhatsApp
 * @param {string} athleteId - used for usage logging and context
 * @param {object} [options]
 * @param {string} [options.engineMode='guided']  - structured|guided|adaptive
 * @param {string} [options.contextMode='balanced'] - lean|balanced|full
 * @returns {{ reply: string, intent: object, tokens: object, cost_usd: number }}
 */
export async function handleMessage(message, athleteId, {
  engineMode  = 'guided',
  contextMode = 'balanced',
} = {}) {
  const startMs = Date.now();

  // 1. Classify intent
  const intent = await classifyIntent(message, athleteId);
  log.info({ intent: intent.intent, source: intent.source, confidence: intent.confidence }, 'intent classified');

  // 2. Save inbound message
  await saveMessage('user', message);

  // 3. Load conversation history
  const history = await getConversationHistory();

  // 4. Select model
  const useComplex = isComplexIntent(intent.intent) || engineMode === 'adaptive';
  const model      = useComplex ? SONNET_MODEL : HAIKU_MODEL;
  const maxTokens  = useComplex ? MAX_TOKENS_SONNET : MAX_TOKENS_HAIKU;

  // 5. Build context (inject intent-specific data if relevant)
  const [ctx, period] = await Promise.all([
    buildContext(contextMode, history),
    apiClient.get('/periods/current').catch(() => null),
  ]);

  // 6. Optionally prepend structured data to the user message
  let augmentedMessage = message;

  if (intent.intent === 'show_stats') {
    const preamble = await buildStatsPreamble();
    if (preamble) augmentedMessage = `${preamble}\n\n${message}`;
  }

  if (intent.intent === 'run_gate_check') {
    const preamble = await buildGatePreamble(period);
    if (preamble) augmentedMessage = `${preamble}\n\n${message}`;
  }

  // 7. Build messages array: context history + augmented current message
  // Replace the last user message (already in history) with the augmented version
  const contextMessages = [
    ...ctx.messages,
    { role: 'user', content: augmentedMessage },
  ];

  // 8. Call Anthropic
  log.info({ model, intent: intent.intent, contextMode, engineMode }, 'calling Anthropic');

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system:     ctx.system,
    messages:   contextMessages,
  });

  const reply        = response.content[0]?.text?.trim() ?? '';
  const inputTokens  = response.usage?.input_tokens  ?? 0;
  const outTokens    = response.usage?.output_tokens ?? 0;
  const isHaiku      = model === HAIKU_MODEL;
  const costUsd      = isHaiku
    ? inputTokens * HAIKU_INPUT_COST_PER_TOKEN  + outTokens * HAIKU_OUTPUT_COST_PER_TOKEN
    : inputTokens * SONNET_INPUT_COST_PER_TOKEN + outTokens * SONNET_OUTPUT_COST_PER_TOKEN;

  const durationMs = Date.now() - startMs;

  log.info({
    model, inputTokens, outTokens,
    costUsd: costUsd.toFixed(6),
    durationMs,
  }, 'Anthropic call complete');

  // 9. Save coach reply
  await saveMessage('assistant', reply);

  // 10. Log usage
  await logUsage(athleteId, {
    model,
    call_type:     'coach_response',
    input_tokens:  inputTokens,
    output_tokens: outTokens,
    cost_usd:      costUsd,
    context_mode:  contextMode,
    engine_mode:   engineMode,
    metadata: {
      intent:       intent.intent,
      intent_source: intent.source,
      duration_ms:  durationMs,
    },
  });

  // 11. Trigger summarisation if needed
  const totalMessages = await getMessageCount();
  if (shouldSummarise(totalMessages)) {
    // Fire-and-forget — don't block the response
    updateConversationSummary(athleteId).catch(err =>
      log.warn({ err: err.message }, 'background summarisation failed')
    );
  }

  return {
    reply,
    intent,
    tokens:   { input: inputTokens, output: outTokens },
    cost_usd: costUsd,
    model,
    duration_ms: durationMs,
  };
}

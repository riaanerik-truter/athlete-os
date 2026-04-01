// Intent Classifier
// Determines the athlete's intent from a WhatsApp message.
//
// Two-tier approach:
//   1. Rule-based: slash commands and high-confidence keywords → instant, zero cost
//   2. AI fallback: ambiguous messages → Haiku call, returns structured intent
//
// Intent types (maps to coachHandler routing):
//   coach_chat     — general coaching conversation (default)
//   log_session    — athlete wants to log a completed workout
//   view_plan      — "what's on this week", "show my plan"
//   update_diary   — RPE, wellness, notes for today
//   run_gate_check — "am I ready to build?", progression check
//   import_plan    — ATP/TP plan import request
//   show_stats     — fitness, form, CTL/ATL/TSB
//   onboarding     — intake questions / setup
//   help           — list commands

import Anthropic from '@anthropic-ai/sdk';
import pino from 'pino';
import { logUsage } from './conversationSummary.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const HAIKU_INPUT_COST_PER_TOKEN  = 0.80 / 1_000_000;
const HAIKU_OUTPUT_COST_PER_TOKEN = 4.00 / 1_000_000;
const INTENT_MODEL = 'claude-haiku-4-5-20251001';

// ---------------------------------------------------------------------------
// Rule-based intent map
// Slash commands → exact intent
// ---------------------------------------------------------------------------

const SLASH_COMMANDS = {
  '/log':    'log_session',
  '/plan':   'view_plan',
  '/week':   'view_plan',
  '/diary':  'update_diary',
  '/stats':  'show_stats',
  '/fitness':'show_stats',
  '/gate':   'run_gate_check',
  '/ready':  'run_gate_check',
  '/import': 'import_plan',
  '/help':   'help',
  '/start':  'onboarding',
};

// Keyword patterns → intent (order matters, first match wins)
// Each entry: { pattern: RegExp, intent: string, confidence: number }
const KEYWORD_RULES = [
  // Logging a session
  { pattern: /\b(i did|just (did|finished|completed)|completed|done with|rode|ran|swam|swum|cycled)\b/i, intent: 'log_session',   confidence: 0.85 },
  { pattern: /\b(log|record|add)\b.*(session|ride|run|swim|workout|brick)/i,                              intent: 'log_session',   confidence: 0.90 },

  // Diary / wellness
  { pattern: /\b(rpe|how i feel|feeling|wellness|sore|tired|fatigue|sleep)\b/i,                          intent: 'update_diary',  confidence: 0.80 },
  { pattern: /\b(rate|score|today was|this morning)\b/i,                                                  intent: 'update_diary',  confidence: 0.70 },

  // View plan
  { pattern: /\b(what('s| is) (on|planned|scheduled)|my (plan|schedule|week|sessions))\b/i,               intent: 'view_plan',     confidence: 0.90 },
  { pattern: /\b(show me|what do i (do|have)|tomorrow|next session)\b/i,                                  intent: 'view_plan',     confidence: 0.75 },

  // Stats / fitness
  { pattern: /\b(ctl|atl|tsb|form|fitness|fatigue|load|ftp|vdot|readiness)\b/i,                          intent: 'show_stats',    confidence: 0.85 },
  { pattern: /\b(how (fit|fresh) am i|training load|numbers)\b/i,                                         intent: 'show_stats',    confidence: 0.80 },

  // Progression gate
  { pattern: /\b(ready (for|to|to move)|move (to|into)|progress to|advance|am i ready)\b/i,              intent: 'run_gate_check',confidence: 0.85 },
  { pattern: /\b(base to build|build to peak|peak to race)\b/i,                                           intent: 'run_gate_check',confidence: 0.95 },

  // Import
  { pattern: /\b(import|upload|load).*(plan|atp|trainingpeaks|tp|csv)\b/i,                                intent: 'import_plan',   confidence: 0.90 },

  // Help
  { pattern: /\b(help|commands|what can you do|\/\?)\b/i,                                                 intent: 'help',          confidence: 0.90 },
];

// ---------------------------------------------------------------------------
// AI fallback prompt
// ---------------------------------------------------------------------------

const CLASSIFY_PROMPT = `You are classifying a WhatsApp message from an athlete to their AI coach.
Return a JSON object with exactly these fields:
  intent: one of [coach_chat, log_session, view_plan, update_diary, run_gate_check, import_plan, show_stats, onboarding, help]
  confidence: number 0.0–1.0
  reasoning: one short sentence

Intent definitions:
- coach_chat: general coaching question or conversation
- log_session: athlete reporting a completed workout
- view_plan: asking what training is planned
- update_diary: recording RPE, wellness, notes
- run_gate_check: asking if ready to progress to next training period
- import_plan: requesting to import a training plan
- show_stats: asking about fitness numbers (CTL, ATL, FTP, etc.)
- onboarding: new athlete setup questions
- help: asking what the system can do

Return only the JSON object. No explanation.`;

// ---------------------------------------------------------------------------
// Rule-based classifier
// ---------------------------------------------------------------------------

/**
 * @param {string} message - raw WhatsApp message
 * @returns {{ intent: string, confidence: number, source: 'slash'|'keyword'|null } | null}
 */
function classifyByRules(message) {
  const trimmed = message.trim();

  // Slash command (exact prefix match, case-insensitive)
  const firstWord = trimmed.split(/\s+/)[0].toLowerCase();
  if (SLASH_COMMANDS[firstWord]) {
    return { intent: SLASH_COMMANDS[firstWord], confidence: 1.0, source: 'slash' };
  }

  // Keyword rules (first match wins)
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(trimmed)) {
      return { intent: rule.intent, confidence: rule.confidence, source: 'keyword' };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// AI fallback classifier
// ---------------------------------------------------------------------------

/**
 * @param {string} message
 * @param {string} athleteId - for usage logging
 * @returns {{ intent: string, confidence: number, source: 'ai' }}
 */
async function classifyByAI(message, athleteId) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: INTENT_MODEL,
    max_tokens: 150,
    messages: [
      {
        role: 'user',
        content: `${CLASSIFY_PROMPT}\n\nMessage: "${message}"`,
      }
    ]
  });

  const rawText = response.content[0]?.text?.trim() ?? '{}';
  // Strip markdown code fences if present (e.g. ```json ... ```)
  const raw = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const inputTokens = response.usage?.input_tokens  ?? 0;
  const outTokens   = response.usage?.output_tokens ?? 0;
  const costUsd     = inputTokens * HAIKU_INPUT_COST_PER_TOKEN + outTokens * HAIKU_OUTPUT_COST_PER_TOKEN;

  await logUsage(athleteId, {
    model:         INTENT_MODEL,
    call_type:     'intent_classify',
    input_tokens:  inputTokens,
    output_tokens: outTokens,
    cost_usd:      costUsd,
  });

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    log.warn({ raw }, 'intent classifier returned invalid JSON — defaulting to coach_chat');
    return { intent: 'coach_chat', confidence: 0.5, source: 'ai' };
  }

  return {
    intent:     parsed.intent     ?? 'coach_chat',
    confidence: parsed.confidence ?? 0.5,
    reasoning:  parsed.reasoning  ?? null,
    source:     'ai',
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Classifies a message into an intent.
 * Uses rule-based matching first; falls back to Haiku if below confidence threshold.
 *
 * @param {string} message - raw athlete message
 * @param {string} athleteId - for usage logging on AI fallback
 * @param {object} [options]
 * @param {number} [options.aiThreshold=0.70] - min confidence before skipping AI fallback
 * @returns {{ intent: string, confidence: number, source: 'slash'|'keyword'|'ai' }}
 */
export async function classifyIntent(message, athleteId, { aiThreshold = 0.70 } = {}) {
  if (!message?.trim()) {
    return { intent: 'coach_chat', confidence: 1.0, source: 'keyword' };
  }

  const ruleResult = classifyByRules(message);

  if (ruleResult && ruleResult.confidence >= aiThreshold) {
    log.debug({ intent: ruleResult.intent, source: ruleResult.source, confidence: ruleResult.confidence }, 'intent classified by rules');
    return ruleResult;
  }

  // AI fallback (ambiguous or low-confidence rule match)
  log.debug({ message: message.slice(0, 50) }, 'intent ambiguous — calling Haiku');
  const aiResult = await classifyByAI(message, athleteId);
  log.debug({ intent: aiResult.intent, confidence: aiResult.confidence }, 'intent classified by AI');
  return aiResult;
}

// ---------------------------------------------------------------------------
// Convenience: is this a complex intent needing Sonnet (not Haiku)?
// ---------------------------------------------------------------------------

const COMPLEX_INTENTS = new Set(['run_gate_check', 'import_plan', 'onboarding']);

/**
 * Returns true if the intent warrants a Sonnet call in coachHandler.
 */
export function isComplexIntent(intent) {
  return COMPLEX_INTENTS.has(intent);
}

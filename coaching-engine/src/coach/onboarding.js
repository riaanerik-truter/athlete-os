// Onboarding Manager
// Drives new athletes through a 5-stage intake process.
//
// Stages (stored in athlete.onboarding_stage):
//   1  welcome          — introduce system, confirm sport(s)
//   2  fitness_anchors  — collect FTP/VDOT/CSS and FTHR values
//   3  history          — training background, injury history, time available
//   4  goals            — A-race, B-races, season objectives
//   5  methodology      — explain Friel, confirm methodology selection
//   complete            — onboarding done, hand off to normal coaching
//
// Each stage:
//   - Returns a structured prompt for the AI to deliver to the athlete
//   - Checks what data has been collected to decide if the stage is done
//   - Advances the stage when complete
//
// The messaging service calls getOnboardingReply() instead of coachHandler
// when athlete.onboarding_stage is not 'complete'.

import Anthropic from '@anthropic-ai/sdk';
import pino from 'pino';
import { apiClient } from '../api/client.js';
import { logUsage } from './conversationSummary.js';
import { SYSTEM_PROMPT } from './systemPrompt.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const ONBOARDING_MODEL = 'claude-haiku-4-5-20251001';
const HAIKU_INPUT_COST_PER_TOKEN  = 0.80 / 1_000_000;
const HAIKU_OUTPUT_COST_PER_TOKEN = 4.00 / 1_000_000;
const MAX_TOKENS = 500;

// ---------------------------------------------------------------------------
// Stage definitions
// ---------------------------------------------------------------------------

const STAGES = {
  1: {
    name: 'welcome',
    system_addendum: `You are beginning onboarding for a new athlete. Your goal in this message:
1. Welcome them warmly but briefly
2. Explain what Athlete OS does in 2–3 sentences
3. Ask them which sport(s) they train for (cycling, running, swimming, triathlon, or a combination)
4. Ask how many hours per week they typically train

Keep it short. WhatsApp tone. One or two questions max.`,
    completion_check: async (athlete) => {
      return !!(athlete.primary_sport && athlete.training_hours_per_week);
    },
  },
  2: {
    name: 'fitness_anchors',
    system_addendum: `You are in stage 2 of onboarding. The athlete has told you their sport(s).
Your goal:
- For cycling: ask for their current FTP (watts) and FTHR (cycling HR at threshold)
- For running: ask for their current VDOT score or recent 5K/10K time, and FTHR (running)
- For swimming: ask for their CSS (critical swim speed) — time to swim 100m at threshold pace
- For triathlon: ask for all three relevant anchors

Explain briefly why you need these (zone calculation, session targeting). If they don't know, offer to use a field test later and set provisional values.
Ask one sport at a time if triathlete to avoid overwhelming.`,
    completion_check: async (athlete) => {
      const sport = athlete.primary_sport ?? '';
      if (sport === 'cycling')   return !!(athlete.ftp_watts);
      if (sport === 'running')   return !!(athlete.vdot);
      if (sport === 'swimming')  return !!(athlete.css_per_100m_sec);
      if (sport === 'triathlon') return !!(athlete.ftp_watts && athlete.vdot);
      return !!(athlete.ftp_watts || athlete.vdot); // multi-sport
    },
  },
  3: {
    name: 'history',
    system_addendum: `You are in stage 3 of onboarding. You have the athlete's fitness anchors.
Your goal:
- Ask about their training background (how many years, highest volume year)
- Ask about any recurring injuries or physical limiters (e.g. bad knee, hip flexor)
- Confirm their weekly training availability (days available, any fixed constraints)
- Ask what their biggest training limiter is (e.g. time, heat tolerance, climbing, swim technique)

Two to three questions. Keep it conversational. This is not a medical form.`,
    completion_check: async (athlete) => {
      return !!(athlete.limiter);
    },
  },
  4: {
    name: 'goals',
    system_addendum: `You are in stage 4 of onboarding. You know the athlete's background.
Your goal:
- Ask about their A-race (the most important race of the season): event name, date, distance
- Ask about any B or C races they have planned
- Ask what their performance goal is for the A-race (finish, podium, personal best, specific time)

This information will seed their season plan. Be encouraging. Make them excited about the plan you'll build together.`,
    completion_check: async (athlete) => {
      // Check if there is at least one goal in the system
      try {
        const goals = await apiClient.get('/goals');
        return Array.isArray(goals) && goals.length > 0;
      } catch {
        return false;
      }
    },
  },
  5: {
    name: 'methodology',
    system_addendum: `You are in stage 5 of onboarding — the final stage.
Your goal:
- Explain the Friel periodisation methodology in plain language (3 sentences max)
- Mention that you also apply Seiler's polarised model in build and peak periods
- Confirm that you'll structure their training around base → build → peak → race
- Ask if they have any questions, or if they're ready to begin
- If they're ready: congratulate them and tell them their first week plan will be ready shortly

Once they confirm they're ready, the onboarding is complete.`,
    completion_check: async (athlete) => {
      return athlete.onboarding_stage === 'complete';
    },
  },
};

const STAGE_ORDER = [1, 2, 3, 4, 5, 'complete'];

// ---------------------------------------------------------------------------
// Stage detection
// ---------------------------------------------------------------------------

/**
 * Returns the current onboarding stage number (1–5) or 'complete'.
 * Reads from athlete.onboarding_stage. Defaults to 1 if not set.
 */
export function getCurrentStage(athlete) {
  const raw = athlete?.onboarding_stage;
  if (!raw || raw === '1' || raw === 1) return 1;
  if (raw === 'complete') return 'complete';
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) ? 1 : parsed;
}

/**
 * Advances the stage by updating the athlete record.
 */
async function advanceStage(currentStage) {
  const idx = STAGE_ORDER.indexOf(currentStage);
  if (idx === -1 || idx >= STAGE_ORDER.length - 1) return;
  const nextStage = STAGE_ORDER[idx + 1];
  await apiClient.patch('/athlete', { onboarding_stage: String(nextStage) });
  log.info({ from: currentStage, to: nextStage }, 'onboarding stage advanced');
  return nextStage;
}

// ---------------------------------------------------------------------------
// Onboarding reply generator
// ---------------------------------------------------------------------------

/**
 * Generates the coach's next onboarding message for the athlete.
 *
 * @param {string} message   - athlete's latest message
 * @param {string} athleteId - for usage logging
 * @param {Array}  history   - recent conversation history (chronological)
 * @returns {{ reply: string, stage: number|string, advanced: boolean }}
 */
export async function getOnboardingReply(message, athleteId, history = []) {
  // Load current athlete state
  const athlete = await apiClient.get('/athlete');
  let stage = getCurrentStage(athlete);

  if (stage === 'complete') {
    return {
      reply:    null,
      stage:    'complete',
      advanced: false,
    };
  }

  const stageDef = STAGES[stage];
  if (!stageDef) {
    log.error({ stage }, 'unknown onboarding stage — resetting to 1');
    stage = 1;
  }

  // Check if current stage is already complete (athlete may have provided info)
  const stageComplete = await STAGES[stage].completion_check(athlete);
  if (stageComplete) {
    const next = await advanceStage(stage);
    stage = next ?? stage;
  }

  // Build system prompt with stage-specific addendum
  const system = [
    SYSTEM_PROMPT,
    '\n---\nONBOARDING MODE\n',
    STAGES[stage]?.system_addendum ?? '',
    athlete.name ? `\nAthlete name: ${athlete.name}` : '',
    athlete.primary_sport ? `\nSport: ${athlete.primary_sport}` : '',
  ].join('\n');

  // Save inbound message
  try {
    await apiClient.post('/conversations', { role: 'user', content: message });
  } catch { /* non-fatal */ }

  // Build messages array
  const messages = [
    ...history.slice(-6).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ];

  // Call Haiku
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model:      ONBOARDING_MODEL,
    max_tokens: MAX_TOKENS,
    system,
    messages,
  });

  const reply       = response.content[0]?.text?.trim() ?? '';
  const inputTokens = response.usage?.input_tokens  ?? 0;
  const outTokens   = response.usage?.output_tokens ?? 0;
  const costUsd     = inputTokens * HAIKU_INPUT_COST_PER_TOKEN + outTokens * HAIKU_OUTPUT_COST_PER_TOKEN;

  // Save reply
  try {
    await apiClient.post('/conversations', { role: 'assistant', content: reply });
  } catch { /* non-fatal */ }

  await logUsage(athleteId, {
    model:         ONBOARDING_MODEL,
    call_type:     'onboarding',
    input_tokens:  inputTokens,
    output_tokens: outTokens,
    cost_usd:      costUsd,
    metadata:      { stage },
  });

  // Check if this reply completes the current stage
  // (e.g. stage 5 always completes after first reply — coach says goodbye)
  let advanced = false;
  if (stage === 5) {
    // Heuristic: if reply contains completion signal words, advance
    const lower = reply.toLowerCase();
    if (lower.includes('ready') && (lower.includes('begin') || lower.includes('start') || lower.includes('first week'))) {
      await advanceStage(5);
      advanced = true;
    }
  }

  return { reply, stage, advanced, cost_usd: costUsd };
}

// ---------------------------------------------------------------------------
// Utility: is onboarding complete?
// ---------------------------------------------------------------------------

export function isOnboardingComplete(athlete) {
  return athlete?.onboarding_stage === 'complete';
}

// ---------------------------------------------------------------------------
// Stage 1 opener — called on first contact (no prior message)
// ---------------------------------------------------------------------------

/**
 * Generates the initial welcome message for a brand-new athlete.
 * Called when the system detects no onboarding_stage is set.
 */
export async function sendWelcome(athleteId) {
  return getOnboardingReply('Hello', athleteId, []);
}

// Classifier
// Auto-classifies evidence level and topic/sport tags for a resource.
// Uses Haiku — cheap, runs once per resource on ingestion.
//
// Evidence levels (same scale as the resource table):
//   A — systematic review / RCT
//   B — controlled study / cohort
//   C — case study / expert consensus
//   D — anecdotal / personal experience
//   expert_opinion — practitioner recommendations without study data
//   anecdotal — athlete stories, blog posts

import Anthropic from '@anthropic-ai/sdk';
import pino from 'pino';
import { logUsage } from '../notes/usageLogger.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const MODEL = 'claude-haiku-4-5-20251001';
const HAIKU_INPUT_COST_PER_TOKEN  = 0.80 / 1_000_000;
const HAIKU_OUTPUT_COST_PER_TOKEN = 4.00 / 1_000_000;
const MAX_TOKENS = 200;

// ---------------------------------------------------------------------------
// Known tags for suggestion (classifier may add others)
// ---------------------------------------------------------------------------

const SPORT_TAGS  = ['cycling', 'running', 'swimming', 'triathlon', 'mtb', 'strength', 'general'];
const TOPIC_TAGS  = [
  'periodisation', 'base_training', 'build_training', 'peak', 'taper', 'recovery',
  'threshold', 'vo2max', 'aerobic_endurance', 'ftp', 'vdot', 'css',
  'hrv', 'sleep', 'nutrition', 'hydration', 'heat_adaptation',
  'strength_training', 'injury_prevention', 'technique', 'pacing',
  'race_strategy', 'mental_training', 'biomechanics', 'altitude',
  'overtraining', 'ctl_atl_tsb', 'polarised_training', 'zone2',
];

const CLASSIFY_PROMPT = `You are classifying a sports science document for an endurance athlete's knowledge library.

Analyse the document excerpt and return a JSON object with exactly these fields:
{
  "evidence_level": one of ["A","B","C","D","expert_opinion","anecdotal"],
  "sport_tags": array of relevant sports from ["cycling","running","swimming","triathlon","mtb","strength","general"],
  "topic_tags": array of 2-6 relevant topic tags (use the list below or add specific ones),
  "confidence": number 0.0-1.0
}

Evidence level guide:
- A: systematic review or randomised controlled trial
- B: controlled study, cohort study, or well-designed experiment
- C: case study, expert consensus, or practitioner guideline
- D: anecdotal evidence or personal experience
- expert_opinion: practitioner recommendations without formal study
- anecdotal: athlete stories, blog posts, training logs

Common topic tags: ${TOPIC_TAGS.join(', ')}

Return only the JSON object. No explanation.`;

// ---------------------------------------------------------------------------
// Main classifier
// ---------------------------------------------------------------------------

/**
 * Auto-classifies evidence level and tags for a resource using its first chunk.
 *
 * @param {string} resourceId - for usage logging
 * @param {string} title
 * @param {string} author
 * @param {string} sampleText - first 1000 words of content
 * @returns {{ evidence_level: string, sport_tags: string[], topic_tags: string[], confidence: number }}
 */
export async function classifyResource(resourceId, title, author, sampleText) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const excerpt = sampleText.split(/\s+/).slice(0, 600).join(' ');
  const prompt  = `${CLASSIFY_PROMPT}\n\nTitle: "${title}"\nAuthor: "${author ?? 'Unknown'}"\n\nExcerpt:\n${excerpt}`;

  const response = await client.messages.create({
    model:      MODEL,
    max_tokens: MAX_TOKENS,
    messages:   [{ role: 'user', content: prompt }],
  });

  const raw         = response.content[0]?.text?.trim() ?? '{}';
  const inputTokens = response.usage?.input_tokens  ?? 0;
  const outTokens   = response.usage?.output_tokens ?? 0;
  const costUsd     = inputTokens * HAIKU_INPUT_COST_PER_TOKEN + outTokens * HAIKU_OUTPUT_COST_PER_TOKEN;

  await logUsage(resourceId, {
    model:         MODEL,
    call_type:     'classify',
    input_tokens:  inputTokens,
    output_tokens: outTokens,
    cost_usd:      costUsd,
  });

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    log.warn({ resourceId, raw }, 'classifier returned invalid JSON — using defaults');
    return {
      evidence_level: 'C',
      sport_tags:     ['general'],
      topic_tags:     [],
      confidence:     0.3,
    };
  }

  log.info({ resourceId, evidence_level: parsed.evidence_level, confidence: parsed.confidence }, 'classification complete');

  return {
    evidence_level: parsed.evidence_level ?? 'C',
    sport_tags:     parsed.sport_tags     ?? ['general'],
    topic_tags:     parsed.topic_tags     ?? [],
    confidence:     parsed.confidence     ?? 0.5,
  };
}

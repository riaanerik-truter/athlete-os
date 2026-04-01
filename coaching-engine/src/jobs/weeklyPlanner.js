// Weekly Planner Job
// Cron: Monday 06:00 (configurable in user_settings.json)
//
// Flow:
//   1. Fetch current period — skip if none
//   2. Determine engine_mode from period or user_settings.json
//   3. structured: call blockPlanner directly → post sessions
//   4. guided/adaptive: blockPlanner draft → coachHandler AI review → post sessions
//
// The blockPlanner already handles week-within-period numbering internally.
// This job's role is to trigger it at the right time and handle mode routing.

import pino from 'pino';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { apiClient } from '../api/client.js';
import { generateBlock } from '../planning/blockPlanner.js';
import { handleMessage } from '../coach/coachHandler.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const __dir = dirname(fileURLToPath(import.meta.url));

async function loadSettings() {
  try {
    const raw = await readFile(join(__dir, '../../user_settings.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return { engine_mode: 'guided', context_mode: 'balanced' };
  }
}

// ---------------------------------------------------------------------------
// Guided/adaptive: AI review of draft block
// ---------------------------------------------------------------------------

async function reviewDraftWithAI(draft, athlete, settings) {
  const draftSummary = draft.sessions
    .map(s => `${s.scheduled_date} ${s.sport} ${s.session_type_code} ${s.target_duration_min}min`)
    .join('\n');

  const prompt = `[Weekly plan draft for your review]\n${draftSummary}\n\nIs this week's plan appropriate given the athlete's current state? Flag any concerns or suggest adjustments. Then confirm "Plan approved" if no changes needed, or provide the adjusted plan as a JSON array of sessions.`;

  const result = await handleMessage(prompt, athlete?.id ?? 'system', {
    engineMode:  settings.engine_mode,
    contextMode: settings.context_mode ?? 'balanced',
  });

  return result.reply;
}

// ---------------------------------------------------------------------------
// Post sessions to API
// ---------------------------------------------------------------------------

async function postSessions(sessions) {
  let created = 0;
  let failed  = 0;
  for (const session of sessions) {
    try {
      await apiClient.post('/sessions/planned', session);
      created++;
    } catch (err) {
      log.error({ date: session.scheduled_date, err: err.message }, 'failed to post planned session');
      failed++;
    }
  }
  return { created, failed };
}

// ---------------------------------------------------------------------------
// Main job
// ---------------------------------------------------------------------------

/**
 * Runs the weekly planning job.
 *
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false] - preview only; no API writes
 * @returns {object} job result summary
 */
export async function runWeeklyPlanner({ dryRun = false } = {}) {
  log.info({ dryRun }, 'weekly planner starting');

  const settings = await loadSettings();
  const engineMode = settings.engine_mode ?? 'guided';

  // 1. Check for active period
  const period = await apiClient.get('/periods/current');
  if (!period) {
    log.warn('no active period — weekly planner skipped');
    return { skipped: true, reason: 'no_active_period' };
  }

  // Use period's engine_mode if set, otherwise fall back to user_settings
  const activeMode = period.engine_mode ?? engineMode;
  log.info({ periodType: period.period_type, engineMode: activeMode }, 'planning week');

  // 2. Fetch athlete
  const athlete = await apiClient.get('/athlete');

  // 3. Generate block draft (always dry-run first)
  const draft = await generateBlock(period, athlete, { dryRun: true });

  if (!draft.sessions?.length) {
    log.warn({ period: period.period_type }, 'blockPlanner returned no sessions');
    return { skipped: true, reason: 'no_sessions_generated', draft };
  }

  log.info({ sessionCount: draft.sessions.length, weekType: draft.week_type }, 'draft block generated');

  // 4. Dry-run mode: return preview only
  if (dryRun) {
    return {
      dry_run:      true,
      engine_mode:  activeMode,
      period_type:  period.period_type,
      week_type:    draft.week_type,
      session_count: draft.sessions.length,
      sessions:     draft.sessions,
      volume_hrs:   draft.volume_hrs,
      tss_target:   draft.tss_target,
    };
  }

  // 5. Live run
  let aiReview = null;

  if (activeMode === 'guided' || activeMode === 'adaptive') {
    // AI reviews the draft and may suggest changes
    aiReview = await reviewDraftWithAI(draft, athlete, settings);
    log.info({ aiReview: aiReview?.slice(0, 100) }, 'AI review complete');

    // Adaptive mode: if AI flagged changes, parse and apply them
    // For now we post the original draft — a full adaptive revision engine
    // would parse the AI's JSON response here. Marked as future work.
    if (activeMode === 'adaptive') {
      log.info('adaptive mode: applying original draft (AI override parsing not yet implemented)');
    }
  }

  // 6. Post sessions
  const { created, failed } = await postSessions(draft.sessions);

  // 7. Post a coach message summarising the week
  const weekSummary = `Your week is planned. ${draft.sessions.length} sessions, ${draft.volume_hrs?.toFixed(1) ?? '?'}hrs, ~${draft.tss_target ?? '?'} TSS. ${draft.week_type === 'recovery' ? 'Recovery week — keep it easy.' : 'Key sessions: ' + draft.sessions.filter(s => s.priority === 'key').map(s => s.scheduled_date + ' ' + s.session_type_code).join(', ')}`;

  try {
    await apiClient.post('/conversations', { role: 'assistant', content: weekSummary });
  } catch { /* non-fatal */ }

  log.info({ created, failed, engineMode: activeMode }, 'weekly planner complete');

  return {
    dry_run:      false,
    engine_mode:  activeMode,
    period_type:  period.period_type,
    week_type:    draft.week_type,
    sessions_created: created,
    sessions_failed:  failed,
    volume_hrs:   draft.volume_hrs,
    tss_target:   draft.tss_target,
    ai_review:    aiReview,
  };
}

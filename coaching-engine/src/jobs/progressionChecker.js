// Progression Checker Job
// Cron: Sunday 21:00 (configurable in user_settings.json)
//
// Flow:
//   1. Get current period
//   2. Check if in the final week of the period
//   3. If yes, run appropriate gate check
//   4. Gate passed → post coach message + flag period notes
//   5. Gate failed → log which conditions failed, optionally extend period one week

import pino from 'pino';
import { apiClient } from '../api/client.js';
import { checkProgressionGate } from '../planning/progressionGates.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// How many days before period end to trigger the gate check
const DAYS_BEFORE_END = 7;

// Period type → next period label
const NEXT_PERIOD_LABEL = {
  base:  'Build',
  build: 'Peak',
  peak:  'Race',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysBetween(a, b) {
  return Math.round(
    (new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000
  );
}

function isInFinalWeek(period, today) {
  if (!period?.end_date) return false;
  const daysLeft = daysBetween(today, period.end_date);
  return daysLeft >= 0 && daysLeft <= DAYS_BEFORE_END;
}

// ---------------------------------------------------------------------------
// Gate passed: notify + flag period
// ---------------------------------------------------------------------------

async function handleGatePassed(period, gateResult) {
  const nextLabel = NEXT_PERIOD_LABEL[period.period_type] ?? 'next phase';

  const message = [
    `Gate check: ${period.period_type} → ${nextLabel.toLowerCase()}.`,
    `All ${gateResult.conditions.length} conditions passed.`,
    `You're ready to begin ${nextLabel}. I'll generate your ${nextLabel} block plan at your next weekly planning run.`,
  ].join(' ');

  log.info({ gate: gateResult.gate, message }, 'gate passed — notifying athlete');

  try {
    await apiClient.post('/conversations', { role: 'assistant', content: message });
  } catch (err) {
    log.warn({ err: err.message }, 'failed to post gate notification');
  }

  // Flag period as gate-passed in notes (via PATCH period if endpoint supports it)
  // This is a best-effort write — the API may not expose PATCH /periods/:id yet
  try {
    await apiClient.patch(`/periods/${period.id}`, {
      progression_gate: 'passed',
      notes: `Gate passed ${new Date().toISOString().slice(0, 10)}: ${gateResult.summary}`,
    });
  } catch { /* non-fatal — endpoint may not exist yet */ }

  return { action: 'notified', message };
}

// ---------------------------------------------------------------------------
// Gate failed: log failures, optionally extend period
// ---------------------------------------------------------------------------

async function handleGateFailed(period, gateResult, { extendPeriod = false } = {}) {
  const failedConditions = gateResult.conditions.filter(c => !c.passed);
  const nextLabel = NEXT_PERIOD_LABEL[period.period_type] ?? 'next phase';

  const conditionLines = failedConditions.map(c =>
    `• ${c.name}: ${c.actual ?? 'no data'} (needs ${c.required})${c.note ? ' — ' + c.note : ''}`
  ).join('\n');

  log.info({ gate: gateResult.gate, failedCount: failedConditions.length }, 'gate failed');
  log.info({ conditions: conditionLines }, 'failed conditions');

  let extensionNote = '';
  if (extendPeriod && period.end_date) {
    const newEnd = new Date(period.end_date + 'T00:00:00Z');
    newEnd.setUTCDate(newEnd.getUTCDate() + 7);
    const newEndStr = newEnd.toISOString().slice(0, 10);

    try {
      await apiClient.patch(`/periods/${period.id}`, { end_date: newEndStr });
      extensionNote = ` I've extended your ${period.period_type} period by one week to ${newEndStr}.`;
      log.info({ newEnd: newEndStr }, 'period extended by one week');
    } catch { /* non-fatal */ }
  }

  const message = [
    `Gate check: ${period.period_type} → ${nextLabel.toLowerCase()}.`,
    `${failedConditions.length} condition(s) not yet met:`,
    conditionLines,
    `\nKeep training — I'll re-check next Sunday.${extensionNote}`,
  ].join('\n');

  try {
    await apiClient.post('/conversations', { role: 'assistant', content: message });
  } catch (err) {
    log.warn({ err: err.message }, 'failed to post gate failure notification');
  }

  return { action: 'logged', failedConditions, message };
}

// ---------------------------------------------------------------------------
// Main job
// ---------------------------------------------------------------------------

/**
 * Runs the progression checker.
 *
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false]       - preview only; no API writes
 * @param {boolean} [options.extendPeriod=false]  - extend period by 1 week if gate fails
 * @param {boolean} [options.forceCheck=false]    - run gate even if not in final week
 * @returns {object} job result
 */
export async function runProgressionChecker({
  dryRun = false,
  extendPeriod = false,
  forceCheck = false,
} = {}) {
  log.info({ dryRun, extendPeriod, forceCheck }, 'progression checker starting');

  const today  = new Date().toISOString().slice(0, 10);
  const period = await apiClient.get('/periods/current');

  if (!period) {
    log.info('no active period — progression checker skipped');
    return { skipped: true, reason: 'no_active_period' };
  }

  const { period_type } = period;

  // Only base/build/peak have forward gates
  if (!NEXT_PERIOD_LABEL[period_type]) {
    log.info({ period_type }, 'period type has no gate — skipped');
    return { skipped: true, reason: 'no_gate_for_period_type', period_type };
  }

  // Check if in final week (or force)
  const inFinalWeek = isInFinalWeek(period, today);
  if (!inFinalWeek && !forceCheck) {
    const daysLeft = daysBetween(today, period.end_date);
    log.info({ daysLeft, period_type }, 'not in final week — skipped');
    return { skipped: true, reason: 'not_final_week', days_left: daysLeft };
  }

  log.info({ period_type, periodEnd: period.end_date }, 'running gate check');

  // Run gate
  const gateResult = await checkProgressionGate(period_type, period);

  log.info({
    gate:    gateResult.gate,
    passed:  gateResult.passed,
    failed:  gateResult.failed_count,
  }, 'gate check complete');

  if (dryRun) {
    return {
      dry_run:    true,
      period_type,
      period_end: period.end_date,
      in_final_week: inFinalWeek,
      gate:       gateResult,
      would_action: gateResult.passed ? 'notify_athlete' : 'log_failures',
    };
  }

  // Handle result
  let actionResult;
  if (gateResult.passed) {
    actionResult = await handleGatePassed(period, gateResult);
  } else {
    actionResult = await handleGateFailed(period, gateResult, { extendPeriod });
  }

  return {
    dry_run:      false,
    period_type,
    period_end:   period.end_date,
    in_final_week: inFinalWeek,
    gate_passed:  gateResult.passed,
    failed_count: gateResult.failed_count,
    action:       actionResult.action,
    message:      actionResult.message,
  };
}

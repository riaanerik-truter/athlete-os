// Plan Revision Engine
// Runs daily after diary entry processing and after each sync.
// Compares actual vs planned training load and triggers revision actions.
//
// Three-tier action hierarchy:
//   minor    — engine acts autonomously, notifies athlete
//   moderate — engine proposes, athlete confirms
//   major    — engine flags, recommends manual TP update
//
// Each check returns:
//   { triggered: bool, severity, action, message, data }
//
// checkAll() returns all triggered revisions sorted by severity.

import { REVISION_TRIGGERS, REVISION_ACTIONS } from './ruleEngine.js';

// ---------------------------------------------------------------------------
// Individual trigger checks
// Pure functions — take pre-fetched data, return trigger results.
// No API calls here; callers fetch data and pass it in.
// ---------------------------------------------------------------------------

/**
 * Check: missed sessions this week.
 *
 * @param {Array} plannedSessions  - planned sessions for the current week
 * @param {Array} completedSessions - completed sessions for the current week
 */
export function checkMissedSessions(plannedSessions, completedSessions) {
  const completedDates = new Set(completedSessions.map(s => s.activity_date));
  const missed = plannedSessions.filter(s => {
    // A session is missed if its date has passed and no completed session on that date
    const sessionDate = s.scheduled_date;
    const today = new Date().toISOString().slice(0, 10);
    return sessionDate < today && !completedDates.has(sessionDate);
  });

  const triggered = missed.length >= REVISION_TRIGGERS.missed_sessions;
  return {
    triggered,
    check:    'missed_sessions',
    severity: REVISION_ACTIONS.swap_session.severity,
    action:   triggered ? 'swap_session' : null,
    value:    missed.length,
    threshold:REVISION_TRIGGERS.missed_sessions,
    message:  triggered
      ? `${missed.length} sessions missed this week. I've adjusted the remaining sessions to keep you on track.`
      : null,
    data:     { missed_dates: missed.map(s => s.scheduled_date) },
  };
}

/**
 * Check: readiness score below threshold for consecutive days.
 *
 * @param {Array<{date: string, readiness_score: number|null}>} readinessDays
 *   Array of recent daily_metrics rows, newest-first or oldest-first — order does not matter.
 */
export function checkLowReadiness(readinessDays) {
  // Sort oldest-first to detect consecutive runs
  const sorted = [...readinessDays]
    .filter(r => r.readiness_score !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Find longest consecutive run of days below threshold
  let maxRun = 0;
  let curRun = 0;
  let runDates = [];
  let longestRunDates = [];

  for (const row of sorted) {
    if (row.readiness_score < REVISION_TRIGGERS.readiness_score_low) {
      curRun++;
      runDates.push({ date: row.date, score: row.readiness_score });
      if (curRun > maxRun) {
        maxRun = curRun;
        longestRunDates = [...runDates];
      }
    } else {
      curRun = 0;
      runDates = [];
    }
  }

  const triggered = maxRun >= REVISION_TRIGGERS.readiness_low_days;

  // Severity escalates if run is long
  let action = null;
  let severity = null;
  if (triggered) {
    if (maxRun >= 5) {
      action   = 'reduce_week_load';
      severity = 'moderate';
    } else {
      action   = 'swap_session';
      severity = 'minor';
    }
  }

  const latest = longestRunDates[longestRunDates.length - 1];

  return {
    triggered,
    check:     'low_readiness',
    severity,
    action,
    value:     maxRun,
    threshold: REVISION_TRIGGERS.readiness_low_days,
    message:   triggered
      ? `Your readiness score has been below ${REVISION_TRIGGERS.readiness_score_low} for ${maxRun} days (current: ${latest?.score ?? '?'}). ${
          action === 'reduce_week_load'
            ? "I've reduced this week's load by 25%."
            : "I've swapped your next hard session for an easy AE1 ride."
        }`
      : null,
    data: { consecutive_low_days: maxRun, low_dates: longestRunDates },
  };
}

/**
 * Check: decoupling > threshold on the most recent long ride (base period only).
 *
 * @param {number|null} decouplingPct - from fitness_snapshot.decoupling_last_long
 * @param {string} periodType
 */
export function checkHighDecoupling(decouplingPct, periodType) {
  if (periodType !== 'base' || decouplingPct === null) {
    return { triggered: false, check: 'high_decoupling', severity: null, action: null, value: decouplingPct, threshold: REVISION_TRIGGERS.decoupling_high, message: null, data: {} };
  }

  const triggered = decouplingPct > REVISION_TRIGGERS.decoupling_high;
  return {
    triggered,
    check:     'high_decoupling',
    severity:  REVISION_ACTIONS.reduce_duration.severity,
    action:    triggered ? 'reduce_duration' : null,
    value:     decouplingPct,
    threshold: REVISION_TRIGGERS.decoupling_high,
    message:   triggered
      ? `Aerobic decoupling on your last long ride was ${decouplingPct.toFixed(1)}% (target: < ${REVISION_TRIGGERS.decoupling_high}%). I've shortened the next two sessions by 15% to allow better aerobic adaptation.`
      : null,
    data: { decoupling_pct: decouplingPct, period_type: periodType },
  };
}

/**
 * Check: HRV declining for 4+ consecutive days.
 *
 * @param {Array<{date: string, hrv_nightly_avg: number|null}>} recentMetrics
 */
export function checkHrvDecline(recentMetrics) {
  const sorted = [...recentMetrics]
    .filter(r => r.hrv_nightly_avg !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (sorted.length < 2) {
    return { triggered: false, check: 'hrv_decline', severity: null, action: null, value: 0, threshold: REVISION_TRIGGERS.hrv_declining_days, message: null, data: {} };
  }

  // Count consecutive declining days (each day lower than previous)
  let maxRun = 0;
  let curRun = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].hrv_nightly_avg < sorted[i - 1].hrv_nightly_avg) {
      curRun++;
      maxRun = Math.max(maxRun, curRun);
    } else {
      curRun = 1;
    }
  }

  const triggered = maxRun >= REVISION_TRIGGERS.hrv_declining_days;
  return {
    triggered,
    check:     'hrv_decline',
    severity:  triggered ? REVISION_ACTIONS.extend_recovery.severity : null,
    action:    triggered ? 'extend_recovery' : null,
    value:     maxRun,
    threshold: REVISION_TRIGGERS.hrv_declining_days,
    message:   triggered
      ? `HRV has been declining for ${maxRun} consecutive days. I'm proposing an extra recovery day this week — confirm to apply.`
      : null,
    data: { consecutive_decline_days: maxRun },
  };
}

/**
 * Check: actual TSS deficit or excess vs planned.
 *
 * @param {number|null} plannedTss  - planned TSS for the current week
 * @param {number}      actualTss   - actual TSS accumulated this week so far
 * @param {boolean}     weekComplete - true if the week has ended (Sunday)
 */
export function checkTssDeviation(plannedTss, actualTss, weekComplete = false) {
  if (plannedTss == null || plannedTss === 0) {
    return { triggered: false, check: 'tss_deviation', severity: null, action: null, message: null, data: {} };
  }

  const deviation = ((actualTss - plannedTss) / plannedTss) * 100;
  const deficit   = deviation < -REVISION_TRIGGERS.tss_deficit_pct;
  const excess    = deviation >  REVISION_TRIGGERS.tss_excess_pct;
  const triggered = weekComplete && (deficit || excess);

  let action = null;
  let severity = null;
  let message = null;

  if (triggered) {
    if (deficit) {
      action   = 'delay_progression';
      severity = 'moderate';
      message  = `This week's TSS (${Math.round(actualTss)}) was ${Math.abs(Math.round(deviation))}% below planned (${Math.round(plannedTss)}). I'm proposing to delay next week's progression — confirm to apply.`;
    } else {
      action   = 'reduce_week_load';
      severity = 'moderate';
      message  = `This week's TSS (${Math.round(actualTss)}) was ${Math.round(deviation)}% above planned (${Math.round(plannedTss)}). Next week's load will be reduced to prevent excessive fatigue accumulation.`;
    }
  }

  return {
    triggered,
    check:     'tss_deviation',
    severity,
    action,
    value:     round2(deviation),
    threshold: deficit ? `-${REVISION_TRIGGERS.tss_deficit_pct}%` : `+${REVISION_TRIGGERS.tss_excess_pct}%`,
    message,
    data:      { planned_tss: plannedTss, actual_tss: actualTss, deviation_pct: round2(deviation), direction: deficit ? 'deficit' : excess ? 'excess' : 'ok' },
  };
}

// ---------------------------------------------------------------------------
// Aggregate checker
// ---------------------------------------------------------------------------

const SEVERITY_ORDER = { major: 0, moderate: 1, minor: 2 };

/**
 * Runs all revision checks and returns triggered actions sorted by severity.
 *
 * @param {object} inputs
 * @param {Array}        inputs.plannedSessions
 * @param {Array}        inputs.completedSessions
 * @param {Array}        inputs.readinessDays
 * @param {Array}        inputs.recentMetrics
 * @param {number|null}  inputs.decouplingPct
 * @param {string}       inputs.periodType
 * @param {number|null}  inputs.plannedWeekTss
 * @param {number}       inputs.actualWeekTss
 * @param {boolean}      inputs.weekComplete
 * @returns {object} { triggered: [], not_triggered: [], highest_severity }
 */
export function checkAll(inputs) {
  const {
    plannedSessions   = [],
    completedSessions = [],
    readinessDays     = [],
    recentMetrics     = [],
    decouplingPct     = null,
    periodType        = 'base',
    plannedWeekTss    = null,
    actualWeekTss     = 0,
    weekComplete      = false,
  } = inputs;

  const results = [
    checkMissedSessions(plannedSessions, completedSessions),
    checkLowReadiness(readinessDays),
    checkHighDecoupling(decouplingPct, periodType),
    checkHrvDecline(recentMetrics),
    checkTssDeviation(plannedWeekTss, actualWeekTss, weekComplete),
  ];

  const triggered    = results
    .filter(r => r.triggered)
    .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));

  const notTriggered = results.filter(r => !r.triggered);

  const highestSeverity = triggered.length
    ? triggered[0].severity
    : null;

  return {
    triggered,
    not_triggered:    notTriggered,
    highest_severity: highestSeverity,
    action_count:     triggered.length,
    summary: triggered.length === 0
      ? 'No revision triggers fired — plan is on track'
      : `${triggered.length} trigger(s): ${triggered.map(r => `${r.action}(${r.severity})`).join(', ')}`,
  };
}

// ---------------------------------------------------------------------------
// Message formatter
// ---------------------------------------------------------------------------

/**
 * Formats all triggered revisions into a single coach message.
 * Minor actions are stated as done. Moderate actions are proposals.
 * Major actions are flags with a recommendation.
 *
 * @param {Array} triggered - from checkAll().triggered
 * @returns {string}
 */
export function formatRevisionMessage(triggered) {
  if (!triggered.length) return null;

  const lines = [];
  for (const t of triggered) {
    if (t.message) lines.push(t.message);
  }

  const moderateCount = triggered.filter(r => r.severity === 'moderate').length;
  if (moderateCount > 0) {
    lines.push(`Reply YES to confirm the proposed change${moderateCount > 1 ? 's' : ''}, or NO to keep the current plan.`);
  }

  return lines.join('\n\n');
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

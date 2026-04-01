// Progression Gates
// Checks whether the athlete is ready to advance to the next training period.
// Run in the final week of each period by the progressionChecker job.
//
// Each gate returns:
//   { passed: bool, gate: string, conditions: [{ name, passed, actual, required }] }
//
// If a gate fails, the coaching engine extends the current period by 1 week
// and re-checks. After two extensions it proposes a major plan revision.

import { apiClient } from '../api/client.js';
import { PROGRESSION_GATES } from './ruleEngine.js';

// ---------------------------------------------------------------------------
// Data fetchers — thin wrappers over the API
// ---------------------------------------------------------------------------

async function fetchSnapshot() {
  return apiClient.get('/fitness/snapshot');
}

async function fetchCurrentPeriod() {
  return apiClient.get('/periods/current');
}

async function fetchRecentSessions(days = 30) {
  const from = offsetDate(new Date(), -days);
  return apiClient.get(`/sessions?from=${from}&limit=100`);
}

async function fetchRecentFieldTests(sport = 'cycling') {
  return apiClient.get(`/fitness/tests?sport=${sport}`);
}

async function fetchRecentReadiness(days = 7) {
  const from = offsetDate(new Date(), -days);
  return apiClient.get(`/health/daily?from=${from}`);
}

// ---------------------------------------------------------------------------
// Gate: base → build
// ---------------------------------------------------------------------------
// Requirements (from PROGRESSION_GATES.base_to_build):
//   1. Decoupling < 5% on the most recent long Z2 ride
//   2. EF trend positive over last 4 weeks (from fitness_snapshot.ef_trend)
//   3. At least 10 weeks in base period
//   4. Average readiness > 60 in the final week

export async function checkBaseToBuild(period) {
  const criteria = PROGRESSION_GATES.base_to_build;
  const conditions = [];

  // --- 1. Decoupling ---
  const snapshot = await fetchSnapshot();
  const decoupling = snapshot?.decoupling_last_long ?? null;
  conditions.push({
    name:     'decoupling_pct',
    passed:   decoupling !== null && decoupling < criteria.decoupling_pct_max,
    actual:   decoupling,
    required: `< ${criteria.decoupling_pct_max}%`,
    note:     decoupling === null ? 'No long ride decoupling data available' : null,
  });

  // --- 2. EF trend ---
  const efTrend = snapshot?.ef_trend ?? null;
  conditions.push({
    name:     'ef_trend',
    passed:   efTrend === 'improving',
    actual:   efTrend,
    required: 'improving',
    note:     efTrend === null ? 'No EF trend data — run snapshotWriter first' : null,
  });

  // --- 3. Weeks in base ---
  const weeksInBase = period ? weeksBetween(period.start_date, new Date()) : 0;
  conditions.push({
    name:     'weeks_in_base',
    passed:   weeksInBase >= criteria.weeks_minimum,
    actual:   weeksInBase,
    required: `>= ${criteria.weeks_minimum}`,
  });

  // --- 4. Readiness average (final week) ---
  const readinessData = await fetchRecentReadiness(7);
  const readinessRows = readinessData?.data ?? [];
  const readinessScores = readinessRows
    .map(r => r.readiness_score)
    .filter(s => s !== null && s !== undefined);
  const readinessAvg = readinessScores.length
    ? Math.round(readinessScores.reduce((a, b) => a + b, 0) / readinessScores.length)
    : null;
  conditions.push({
    name:     'readiness_avg',
    passed:   readinessAvg !== null && readinessAvg >= criteria.readiness_avg_min,
    actual:   readinessAvg,
    required: `>= ${criteria.readiness_avg_min}`,
    note:     readinessAvg === null ? 'No readiness data for the final week' : null,
  });

  return buildResult('base_to_build', conditions);
}

// ---------------------------------------------------------------------------
// Gate: build → peak
// ---------------------------------------------------------------------------
// Requirements:
//   1. FTP field test completed since build started
//   2. At least 4 limiter-focused sessions completed
//   3. TSB trend recovering toward positive (from snapshot)
//   4. Average readiness > 65 in final week

export async function checkBuildToPeak(period) {
  const criteria = PROGRESSION_GATES.build_to_peak;
  const conditions = [];

  // --- 1. Field test completed ---
  const tests = await fetchRecentFieldTests('cycling');
  const buildStart = period?.start_date ?? null;
  const recentTest = (tests?.data ?? []).find(t =>
    buildStart ? t.test_date >= buildStart : true
  );
  conditions.push({
    name:     'field_test_completed',
    passed:   !!recentTest,
    actual:   recentTest ? recentTest.test_date : null,
    required: 'FTP test since build start',
    note:     !recentTest ? 'No field test found since build period started' : null,
  });

  // --- 2. Limiter sessions ---
  const sessionsResult = await fetchRecentSessions(90);
  const sessions = sessionsResult?.data ?? [];
  const LIMITER_TYPES = new Set(['ME1','ME2','ME3','ME4','AC1','AC2','AC3']);
  const limiterCount = sessions.filter(s => LIMITER_TYPES.has(s.title)).length;
  conditions.push({
    name:     'limiter_sessions_completed',
    passed:   limiterCount >= criteria.limiter_sessions_completed,
    actual:   limiterCount,
    required: `>= ${criteria.limiter_sessions_completed}`,
  });

  // --- 3. TSB trend ---
  const snapshot = await fetchSnapshot();
  const tsb = snapshot?.tsb ?? null;
  // TSB "recovering" = improving over last week — use tsb > -10 as proxy
  // since we don't have tsb history here (snapshotWriter provides that)
  const tsbRecovering = tsb !== null && tsb > -10;
  conditions.push({
    name:     'tsb_recovering',
    passed:   tsbRecovering,
    actual:   tsb,
    required: '> -10 (trend toward positive)',
    note:     tsb === null ? 'No TSB data in snapshot' : null,
  });

  // --- 4. Readiness average ---
  const readinessData = await fetchRecentReadiness(7);
  const readinessRows = readinessData?.data ?? [];
  const readinessScores = readinessRows
    .map(r => r.readiness_score)
    .filter(s => s !== null && s !== undefined);
  const readinessAvg = readinessScores.length
    ? Math.round(readinessScores.reduce((a, b) => a + b, 0) / readinessScores.length)
    : null;
  conditions.push({
    name:     'readiness_avg',
    passed:   readinessAvg !== null && readinessAvg >= criteria.readiness_avg_min,
    actual:   readinessAvg,
    required: `>= ${criteria.readiness_avg_min}`,
    note:     readinessAvg === null ? 'No readiness data for the final week' : null,
  });

  return buildResult('build_to_peak', conditions);
}

// ---------------------------------------------------------------------------
// Gate: peak → race
// ---------------------------------------------------------------------------
// Requirements:
//   1. TSB positive (> 0)
//   2. Volume at target (current week hrs ~= 0.7 × base3 — approximated from snapshot)
//   3. No readiness score < 50 in the last 5 days

export async function checkPeakToRace(period) {
  const criteria = PROGRESSION_GATES.peak_to_race;
  const conditions = [];

  // --- 1. TSB positive ---
  const snapshot = await fetchSnapshot();
  const tsb = snapshot?.tsb ?? null;
  conditions.push({
    name:     'tsb_positive',
    passed:   tsb !== null && tsb > 0,
    actual:   tsb,
    required: '> 0',
    note:     tsb === null ? 'No TSB in snapshot' : null,
  });

  // --- 2. Volume at target ---
  // We check whether this week's volume is <= planned (taper is holding)
  const weeklyVol    = snapshot?.weekly_volume_hrs ?? null;
  const plannedHrs   = period?.planned_weekly_hrs ?? null;
  const volumeTarget = plannedHrs ? round2(plannedHrs * 0.7) : null;
  const volAtTarget  = weeklyVol !== null && volumeTarget !== null
    ? weeklyVol <= volumeTarget * 1.1   // 10% tolerance
    : null;
  conditions.push({
    name:     'volume_at_target',
    passed:   volAtTarget === true,
    actual:   weeklyVol !== null ? `${weeklyVol}hrs` : null,
    required: volumeTarget !== null ? `<= ${volumeTarget}hrs (0.7 × base3 est.)` : 'planned_weekly_hrs required',
    note:     volAtTarget === null ? 'Insufficient data to check volume target' : null,
  });

  // --- 3. No low readiness in last 5 days ---
  const readinessData = await fetchRecentReadiness(5);
  const readinessRows = readinessData?.data ?? [];
  const lowReadiness  = readinessRows.filter(r =>
    r.readiness_score !== null && r.readiness_score < 50
  );
  conditions.push({
    name:     'no_fatigue_flags',
    passed:   lowReadiness.length === 0,
    actual:   lowReadiness.length === 0
      ? 'No low readiness days'
      : `${lowReadiness.length} day(s) below 50 (${lowReadiness.map(r => `${r.date}:${r.readiness_score}`).join(', ')})`,
    required: 'No readiness < 50 in last 5 days',
  });

  return buildResult('peak_to_race', conditions);
}

// ---------------------------------------------------------------------------
// Gate router
// ---------------------------------------------------------------------------

/**
 * Runs the appropriate gate for the current period transition.
 * Determines which gate to run from the current period type.
 *
 * @param {string} fromPeriodType - 'base' | 'build' | 'peak'
 * @param {object|null} period    - current period record
 * @returns {object} gate result
 */
export async function checkProgressionGate(fromPeriodType, period = null) {
  switch (fromPeriodType) {
    case 'base':  return checkBaseToBuild(period);
    case 'build': return checkBuildToPeak(period);
    case 'peak':  return checkPeakToRace(period);
    default:
      return {
        passed: true,
        gate: `${fromPeriodType}_progression`,
        conditions: [],
        note: `No gate defined for transition from ${fromPeriodType}`
      };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildResult(gate, conditions) {
  const passed = conditions.every(c => c.passed);
  const failedConditions = conditions.filter(c => !c.passed);

  return {
    passed,
    gate,
    conditions,
    failed_count:   failedConditions.length,
    total_checked:  conditions.length,
    summary: passed
      ? `All ${conditions.length} conditions met — ready to progress`
      : `${failedConditions.length} of ${conditions.length} conditions not met: ${failedConditions.map(c => c.name).join(', ')}`,
  };
}

function weeksBetween(startDateStr, endDate) {
  const start = new Date(startDateStr + 'T00:00:00Z');
  const end   = endDate instanceof Date ? endDate : new Date(endDate + 'T00:00:00Z');
  return Math.floor((end - start) / (7 * 24 * 60 * 60 * 1000));
}

function offsetDate(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

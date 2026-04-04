// Snapshot Writer Job
// Cron: Sunday 20:30 (configurable in user_settings.json)
//
// Flow:
//   1. Fetch full TSS history via loadCalculator
//   2. Calculate readiness from latest daily_metrics
//   3. Fetch current fitness anchors from athlete record
//   4. Fetch most recent completed long ride for decoupling
//   5. Write fitness_snapshot via POST /fitness/snapshot
//
// Also exports backfillSnapshots() — calls POST /fitness/backfill on the API
// layer to generate weekly snapshots from all historical session data.

import pino from 'pino';
import { apiClient } from '../api/client.js';
import { calculateLoadHistory, calculateReadiness } from '../planning/loadCalculator.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the 3-day average resting HR from daily_metrics.
 */
async function getAvgRestingHr(days = 3) {
  try {
    const result = await apiClient.get(`/health/daily?limit=${days}`);
    const rows = result?.data ?? result ?? [];
    const hrs = rows.map(r => r.resting_hr_bpm).filter(v => v != null);
    if (!hrs.length) return null;
    return hrs.reduce((a, b) => a + b, 0) / hrs.length;
  } catch {
    return null;
  }
}

/**
 * Returns the latest readiness-relevant health metrics.
 */
async function getLatestMetrics() {
  try {
    const result = await apiClient.get('/health/daily?limit=7');
    return result?.data ?? result ?? [];
  } catch {
    return [];
  }
}

/**
 * Returns most recent decoupling value from completed sessions.
 */
async function getLatestDecoupling() {
  try {
    const result = await apiClient.get('/sessions?limit=20&sport=cycling');
    const sessions = result?.data ?? [];
    const longRides = sessions.filter(s => s.duration_sec >= 5400 && s.ef_decoupling_pct != null);
    return longRides[0]?.ef_decoupling_pct ?? null;
  } catch {
    return null;
  }
}

/**
 * Derives EF trend from recent sessions (positive / flat / negative).
 */
async function getEFTrend() {
  try {
    const result = await apiClient.get('/sessions?limit=10&sport=cycling');
    const sessions = result?.data ?? [];
    const efs = sessions
      .filter(s => s.ef_garmin_calculated != null)
      .map(s => s.ef_garmin_calculated)
      .reverse(); // oldest first
    if (efs.length < 3) return null;
    const first = efs.slice(0, Math.floor(efs.length / 2)).reduce((a, b) => a + b, 0) / Math.floor(efs.length / 2);
    const last  = efs.slice(Math.ceil(efs.length / 2)).reduce((a, b) => a + b, 0)  / Math.ceil(efs.length / 2);
    const delta = last - first;
    if (delta > 0.002) return 'improving';
    if (delta < -0.002) return 'declining';
    return 'stable';
  } catch {
    return null;
  }
}

/**
 * Gets weekly volume and TSS for the current week.
 */
async function getCurrentWeekActuals() {
  try {
    const week = await apiClient.get('/weeks/current');
    return {
      weekly_volume_hrs: week?.actual_volume_hrs ?? null,
      weekly_tss:        week?.actual_tss        ?? null,
    };
  } catch {
    return { weekly_volume_hrs: null, weekly_tss: null };
  }
}

// ---------------------------------------------------------------------------
// Main job
// ---------------------------------------------------------------------------

/**
 * Calculates and writes the fitness snapshot.
 *
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false] - preview only; no API writes
 * @returns {object} the snapshot that was (or would be) written
 */
export async function runSnapshotWriter({ dryRun = false } = {}) {
  log.info({ dryRun }, 'snapshot writer starting');

  // 1. Full load history → terminal CTL/ATL/TSB
  const today    = new Date().toISOString().slice(0, 10);
  const fromDate = new Date(Date.now() - 180 * 86400_000).toISOString().slice(0, 10); // 6 months

  const loadHistory = await calculateLoadHistory(fromDate, today);
  const terminal    = loadHistory[loadHistory.length - 1];

  if (!terminal) {
    log.warn('no load history data — snapshot skipped');
    return { skipped: true, reason: 'no_load_data' };
  }

  const { ctl, atl, tsb } = terminal;

  // 2. Readiness score
  const [metrics, avgRestingHr] = await Promise.all([
    getLatestMetrics(),
    getAvgRestingHr(3),
  ]);

  const readinessScore = calculateReadiness(metrics[0] ?? {}, tsb, avgRestingHr);

  // 3. Fitness anchors from athlete record
  const athlete = await apiClient.get('/athlete');
  const ftpCurrent  = athlete?.ftp_watts  ?? null;
  const vdotCurrent = athlete?.vdot       ?? null;
  const cssCurrent  = athlete?.css_per_100m_sec ?? null;

  // 4. Supplementary metrics
  const [decoupling, efTrend, weekActuals] = await Promise.all([
    getLatestDecoupling(),
    getEFTrend(),
    getCurrentWeekActuals(),
  ]);

  // 5. Build snapshot payload
  const snapshot = {
    snapshot_date:         today,
    ctl:                   parseFloat(ctl.toFixed(1)),
    atl:                   parseFloat(atl.toFixed(1)),
    tsb:                   parseFloat(tsb.toFixed(1)),
    ftp_current:           ftpCurrent,
    vdot_current:          vdotCurrent,
    css_current_sec:       cssCurrent,
    readiness_score:       readinessScore != null ? parseFloat(readinessScore.toFixed(1)) : null,
    ef_trend:              efTrend,
    decoupling_last_long:  decoupling != null ? parseFloat(decoupling.toFixed(2)) : null,
    weekly_volume_hrs:     weekActuals.weekly_volume_hrs,
    weekly_tss:            weekActuals.weekly_tss,
  };

  log.info({ ctl: snapshot.ctl, atl: snapshot.atl, tsb: snapshot.tsb, readiness: snapshot.readiness_score }, 'snapshot calculated');

  if (dryRun) {
    return { dry_run: true, snapshot };
  }

  // 6. Write to API — strip null/undefined so strict schema doesn't reject absent optionals
  const payload = Object.fromEntries(Object.entries(snapshot).filter(([, v]) => v != null));
  const written = await apiClient.post('/fitness/snapshot', payload);
  log.info('snapshot written to DB');

  return { dry_run: false, snapshot, written };
}

// ---------------------------------------------------------------------------
// Backfill job
// ---------------------------------------------------------------------------

/**
 * Triggers the API layer to backfill weekly fitness snapshots from all historical
 * session data. Idempotent — weeks that already have a snapshot are skipped.
 *
 * @returns {{ created: number, skipped: number, total_weeks: number }}
 */
export async function backfillSnapshots() {
  log.info('snapshot backfill starting');
  const result = await apiClient.post('/fitness/backfill', {});
  log.info(
    { created: result?.created, skipped: result?.skipped, total_weeks: result?.total_weeks },
    'snapshot backfill complete'
  );
  return result;
}

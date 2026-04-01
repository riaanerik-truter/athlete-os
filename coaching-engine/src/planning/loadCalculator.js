// Load Calculator
// Computes CTL, ATL, TSB (training stress balance / form) and readiness score.
//
// CTL (Chronic Training Load) = fitness, 42-day exponential weighted average
// ATL (Acute Training Load)   = fatigue, 7-day exponential weighted average
// TSB (Training Stress Balance) = form = CTL_yesterday - ATL_yesterday
//
// Algorithm: Coggan exponential moving average applied day-by-day over all
// calendar days from first activity to today.

import { apiClient } from '../api/client.js';

const CTL_CONSTANT = 42;
const ATL_CONSTANT = 7;

// ---------------------------------------------------------------------------
// CTL / ATL / TSB
// ---------------------------------------------------------------------------

/**
 * Fetches TSS history from the API and computes daily CTL/ATL/TSB.
 *
 * Returns an array of daily snapshots in chronological order:
 *   { date, tss, ctl, atl, tsb, ctl_source, atl_source }
 *
 * ctl_source / atl_source: 'calculated' or 'trainingpeaks'
 * When TP provides values they override the calculated ones for that day.
 * Subsequent days continue from whichever value was used.
 */
export async function calculateLoadHistory(fromDate = null, toDate = null) {
  const params = [];
  if (fromDate) params.push(`from=${fromDate}`);
  if (toDate)   params.push(`to=${toDate}`);
  const query = params.length ? `?${params.join('&')}` : '';

  const result = await apiClient.get(`/fitness/ctlatl${query}`);
  if (!result?.data?.length) return [];

  // Build a Map of date → row for O(1) lookup
  const byDate = new Map();
  for (const row of result.data) {
    const date = toDateStr(row.activity_date);
    byDate.set(date, row);
  }

  // Walk every calendar day from first activity to today
  const firstDate = toDateStr(result.data[0].activity_date);
  const lastDate  = toDateStr(new Date().toISOString());
  const days      = allDaysBetween(firstDate, lastDate);

  let ctl = 0;
  let atl = 0;

  const snapshots = [];

  for (const date of days) {
    const row       = byDate.get(date);
    const tss       = row ? Number(row.tss) : 0;

    // TSB is fitness - fatigue from the *previous* day (before today's load)
    const tsb = ctl - atl;

    // Exponential moving average update
    ctl = ctl + (tss - ctl) / CTL_CONSTANT;
    atl = atl + (tss - atl) / ATL_CONSTANT;

    // TP override: if TP supplied authoritative CTL/ATL for this day, use them
    // and re-anchor our running values so subsequent calculations stay aligned.
    let ctlFinal   = ctl;
    let atlFinal   = atl;
    let ctlSource  = 'calculated';
    let atlSource  = 'calculated';

    if (row?.ctl_at_completion !== null && row?.ctl_at_completion !== undefined) {
      ctlFinal  = Number(row.ctl_at_completion);
      ctl       = ctlFinal;
      ctlSource = 'trainingpeaks';
    }
    if (row?.atl_at_completion !== null && row?.atl_at_completion !== undefined) {
      atlFinal  = Number(row.atl_at_completion);
      atl       = atlFinal;
      atlSource = 'trainingpeaks';
    }

    snapshots.push({
      date,
      tss:        round2(tss),
      ctl:        round2(ctlFinal),
      atl:        round2(atlFinal),
      tsb:        round2(tsb),
      ctl_source: ctlSource,
      atl_source: atlSource
    });
  }

  return snapshots;
}

/**
 * Returns just today's CTL/ATL/TSB — the terminal values from the full history walk.
 */
export async function getCurrentLoad() {
  const history = await calculateLoadHistory();
  if (!history.length) return { ctl: 0, atl: 0, tsb: 0 };
  return history[history.length - 1];
}

// ---------------------------------------------------------------------------
// Readiness score composite
// Weights from design doc: HRV 35%, TSB 25%, Sleep 20%, Wellness 10%, HR trend 10%
// ---------------------------------------------------------------------------

const HRV_SCORE = {
  balanced:   100,
  unbalanced:  60,
  low:         30,
  poor:         0,
};

function mapHrvStatus(status) {
  return HRV_SCORE[status] ?? 50; // null/unknown → neutral
}

function mapTsb(tsb) {
  if (tsb > 10)  return 100;
  if (tsb > 0)   return 80;
  if (tsb > -10) return 60;
  if (tsb > -20) return 40;
  return 20;
}

/**
 * Calculates HR trend score from today's resting_hr vs the 3-day average.
 * Rising > 5bpm → 30, rising 2-5bpm → 60, stable (±2bpm) → 80, falling → 100.
 *
 * @param {number|null} todayHr   - today's resting HR
 * @param {number|null} avg3dayHr - 3-day average resting HR (prior 3 days)
 */
function calcHrTrendScore(todayHr, avg3dayHr) {
  if (!todayHr || !avg3dayHr) return 80; // unknown → slightly positive default
  const diff = todayHr - avg3dayHr;
  if (diff > 5)  return 30;
  if (diff > 2)  return 60;
  if (diff >= 0) return 80;
  return 100; // falling — good sign
}

/**
 * Calculates the readiness score composite from daily metrics.
 *
 * @param {object} metrics - row from daily_metrics (or GET /health/daily)
 * @param {number} tsb     - current TSB from load calculator
 * @param {number|null} avg3dayRestingHr - 3-day prior average resting HR
 * @returns {number} readiness score 0–100
 */
export function calculateReadiness(metrics, tsb, avg3dayRestingHr = null) {
  const hrv      = mapHrvStatus(metrics.hrv_status);
  const tsbScore = mapTsb(tsb);
  const sleep    = metrics.sleep_score    ?? 50;
  const wellness = (metrics.wellness_score ?? 5) * 10;
  const hrTrend  = calcHrTrendScore(metrics.resting_hr ?? null, avg3dayRestingHr);

  const score = Math.round(
    hrv      * 0.35 +
    tsbScore * 0.25 +
    sleep    * 0.20 +
    wellness * 0.10 +
    hrTrend  * 0.10
  );

  return Math.max(0, Math.min(100, score));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round2(n) {
  return Math.round(n * 100) / 100;
}

function toDateStr(dateish) {
  return new Date(dateish).toISOString().slice(0, 10);
}

/**
 * Returns every YYYY-MM-DD string from start to end inclusive.
 */
function allDaysBetween(start, end) {
  const days = [];
  const cur  = new Date(start + 'T00:00:00Z');
  const last = new Date(end   + 'T00:00:00Z');
  while (cur <= last) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

/**
 * Group: Fitness and Testing
 * Endpoints: GET /fitness/snapshot, GET /fitness/snapshots, POST /fitness/snapshot,
 *            GET /fitness/tests, POST /fitness/tests, GET /fitness/labs, POST /fitness/labs,
 *            GET /health/daily, POST /health/daily
 *
 * Manual verification:
 * - GET /fitness/snapshot returns latest snapshot with all KPIs; 404 when none exists
 * - GET /fitness/snapshots?from=2026-01-01&to=2026-03-30 returns ordered array for charting
 * - POST /fitness/snapshot creates snapshot (201)
 * - POST /fitness/snapshot missing snapshot_date returns 422 VALIDATION_ERROR
 * - GET /fitness/tests returns all tests ordered by date DESC
 * - GET /fitness/tests?sport=cycling returns only cycling tests
 * - GET /fitness/tests?type=T1_ftp_fthr returns only FTP tests
 * - POST /fitness/tests with ftp_watts returns zones_updated: true in response
 * - POST /fitness/tests without any anchor metric returns zones_updated: false
 * - GET /fitness/labs returns all lab results ordered by date DESC
 * - POST /fitness/labs creates lab result (201); structured_data accepts arbitrary JSON
 * - GET /health/daily?from=2026-03-23&to=2026-03-30 returns 7 records ordered ASC
 * - POST /health/daily creates daily metrics record (201)
 * - POST /health/daily with duplicate date returns 409 CONFLICT
 */

import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { getAthleteId } from '../db/sync.js';
import { replaceZoneModel, updateAthlete, getAthlete } from '../db/athlete.js';
import {
  getLatestSnapshot,
  getSnapshotHistory,
  createSnapshot,
  getExistingSnapshotDates,
  getFieldTests,
  createFieldTest,
  markZonesUpdated,
  getLabResults,
  createLabResult,
  getDailyMetrics,
  createDailyMetrics,
  getTssHistory
} from '../db/fitness.js';

const router = Router();

// ---------------------------------------------------------------------------
// Zone calculators (inline — same logic as routes/zones.js, pure functions)
// Duplicated here to avoid importing from a route file.
// If a third caller emerges, extract to src/lib/zones.js at that point.
// ---------------------------------------------------------------------------

function buildCyclingZones(ftp) {
  return {
    anchor_metric: 'ftp_watts',
    anchor_value:  ftp,
    zones: [
      { zone: 'Z1',  label: 'Recovery',         min_pct: 0,   max_pct: 55,   min_value: 0,                    max_value: Math.floor(ftp * 0.55), unit: 'watts' },
      { zone: 'Z2',  label: 'Aerobic endurance', min_pct: 56,  max_pct: 75,   min_value: Math.ceil(ftp * 0.56), max_value: Math.floor(ftp * 0.75), unit: 'watts' },
      { zone: 'Z3',  label: 'Tempo',             min_pct: 76,  max_pct: 90,   min_value: Math.ceil(ftp * 0.76), max_value: Math.floor(ftp * 0.90), unit: 'watts' },
      { zone: 'Z4',  label: 'Sub-threshold',     min_pct: 91,  max_pct: 105,  min_value: Math.ceil(ftp * 0.91), max_value: Math.floor(ftp * 1.05), unit: 'watts' },
      { zone: 'Z5a', label: 'Threshold',         min_pct: 106, max_pct: 120,  min_value: Math.ceil(ftp * 1.06), max_value: Math.floor(ftp * 1.20), unit: 'watts' },
      { zone: 'Z5b', label: 'Aerobic capacity',  min_pct: 121, max_pct: 150,  min_value: Math.ceil(ftp * 1.21), max_value: Math.floor(ftp * 1.50), unit: 'watts' },
      { zone: 'Z5c', label: 'Sprint',            min_pct: 151, max_pct: null, min_value: Math.ceil(ftp * 1.51), max_value: null,                   unit: 'watts' }
    ]
  };
}

function buildRunningZones(vdot) {
  return {
    anchor_metric: 'vdot',
    anchor_value:  vdot,
    vdot_score:    vdot,
    zones:         [],
    pace_zones:    null
  };
}

function buildSwimmingZones(css) {
  return {
    anchor_metric:    'css_per_100m_sec',
    anchor_value:     css,
    css_per_100m_sec: css,
    zones:            [],
    pace_zones: [
      { zone: 'Z1',  label: 'Recovery',         min_pace_sec: Math.round(css + 20), max_pace_sec: null },
      { zone: 'Z2',  label: 'Aerobic endurance', min_pace_sec: Math.round(css + 10), max_pace_sec: Math.round(css + 19) },
      { zone: 'Z3',  label: 'Tempo',             min_pace_sec: Math.round(css + 5),  max_pace_sec: Math.round(css + 9)  },
      { zone: 'Z4',  label: 'Threshold',         min_pace_sec: Math.round(css),      max_pace_sec: Math.round(css + 4)  },
      { zone: 'Z5a', label: 'Aerobic capacity',  min_pace_sec: Math.round(css - 6),  max_pace_sec: Math.round(css - 1)  },
      { zone: 'Z5b', label: 'Max',               min_pace_sec: null,                 max_pace_sec: Math.round(css - 7)  }
    ]
  };
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const snapshotCreateSchema = z.object({
  snapshot_date:        z.string().date(),
  week_id:              z.string().uuid().optional(),
  ctl:                  z.number().optional(),
  atl:                  z.number().optional(),
  tsb:                  z.number().optional(),
  ftp_current:          z.number().int().positive().optional(),
  w_per_kg:             z.number().positive().optional(),
  vdot_current:         z.number().positive().optional(),
  css_current_sec:      z.number().positive().optional(),
  ef_7day_avg:          z.number().optional(),
  ef_trend:             z.enum(['improving', 'stable', 'declining']).optional(),
  decoupling_last_long: z.number().optional(),
  resting_hr_avg:       z.number().int().positive().optional(),
  hrv_7day_avg:         z.number().optional(),
  readiness_score:      z.number().int().min(0).max(100).optional(),
  weekly_volume_hrs:    z.number().nonnegative().optional(),
  weekly_tss:           z.number().nonnegative().optional(),
  ytd_volume_hrs:       z.number().nonnegative().optional()
}).strict();

const fieldTestCreateSchema = z.object({
  test_date:           z.string().date(),
  test_type:           z.string().min(1),
  sport:               z.enum(['cycling', 'running', 'swimming', 'mtb']),
  methodology_id:      z.string().uuid().optional(),
  ftp_watts:           z.number().int().positive().optional(),
  fthr_bpm:            z.number().int().positive().optional(),
  avg_power_20min:     z.number().int().positive().optional(),
  avg_hr_20min:        z.number().int().positive().optional(),
  vo2max_power_w:      z.number().int().positive().optional(),
  stamina_if:          z.number().optional(),
  sprint_5s_peak_w:    z.number().int().positive().optional(),
  sprint_20s_avg_w:    z.number().int().positive().optional(),
  vdot_score:          z.number().positive().optional(),
  race_distance_m:     z.number().int().positive().optional(),
  race_time_sec:       z.number().int().positive().optional(),
  css_per_100m_sec:    z.number().positive().optional(),
  css_400m_time_sec:   z.number().positive().optional(),
  css_200m_time_sec:   z.number().positive().optional(),
  notes:               z.string().optional(),
  garmin_activity_id:  z.string().optional()
}).strict();

const labResultCreateSchema = z.object({
  test_date:       z.string().date(),
  test_type:       z.string().min(1),
  performed_by:    z.string().optional(),
  report_file_url: z.string().optional(),
  structured_data: z.record(z.unknown()).optional(),
  source:          z.string().optional(),
  notes:           z.string().optional()
}).strict();

const dailyMetricsCreateSchema = z.object({
  date:                    z.string().date(),
  hrv_nightly_avg:         z.number().optional(),
  hrv_7day_avg:            z.number().optional(),
  hrv_status:              z.string().optional(),
  resting_hr:              z.number().int().positive().optional(),
  body_battery_morning:    z.number().int().min(0).max(100).optional(),
  body_battery_min:        z.number().int().min(0).max(100).optional(),
  body_battery_max:        z.number().int().min(0).max(100).optional(),
  sleep_duration_hrs:      z.number().nonnegative().optional(),
  sleep_score:             z.number().int().min(0).max(100).optional(),
  sleep_deep_hrs:          z.number().nonnegative().optional(),
  sleep_rem_hrs:           z.number().nonnegative().optional(),
  sleep_light_hrs:         z.number().nonnegative().optional(),
  sleep_awake_hrs:         z.number().nonnegative().optional(),
  sleep_respiration_avg:   z.number().optional(),
  spo2_avg:                z.number().optional(),
  spo2_min:                z.number().optional(),
  stress_avg:              z.number().optional(),
  stress_rest_avg:         z.number().optional(),
  skin_temp_deviation:     z.number().optional(),
  readiness_score:         z.number().int().min(0).max(100).optional()
}).strict();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validationError(res, issue) {
  return res.status(422).json({
    error: {
      code:    'VALIDATION_ERROR',
      message: issue.message,
      field:   issue.path.join('.') || null
    }
  });
}

function notFound(res, message) {
  return res.status(404).json({ error: { code: 'NOT_FOUND', message, field: null } });
}

function num(v) {
  return v !== null && v !== undefined ? Number(v) : null;
}

// ---------------------------------------------------------------------------
// GET /fitness/ctlatl
// ---------------------------------------------------------------------------

router.get('/fitness/ctlatl', async (req, res, next) => {
  try {
    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const limitRaw = parseInt(req.query.limit, 10);
    const limit    = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 5000) : 1000;

    const rows = await getTssHistory(pool, athleteId, {
      from:  req.query.from,
      to:    req.query.to,
      limit
    });

    res.json({
      data: rows.map(r => ({
        activity_date:     r.activity_date,
        tss:               num(r.tss),
        ctl_at_completion: num(r.ctl_at_completion),
        atl_at_completion: num(r.atl_at_completion),
        tsb_at_completion: num(r.tsb_at_completion),
        sport:             r.sport,
        duration_sec:      r.duration_sec
      }))
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /fitness/snapshot
// ---------------------------------------------------------------------------

router.get('/fitness/snapshot', async (req, res, next) => {
  try {
    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const snap = await getLatestSnapshot(pool, athleteId);
    if (!snap) return notFound(res, 'No fitness snapshot found');

    res.json({
      snapshot_date:        snap.snapshot_date,
      ctl:                  num(snap.ctl),
      atl:                  num(snap.atl),
      tsb:                  num(snap.tsb),
      ftp_current:          snap.ftp_current,
      w_per_kg:             num(snap.w_per_kg),
      vdot_current:         num(snap.vdot_current),
      css_current_sec:      num(snap.css_current_sec),
      ef_7day_avg:          num(snap.ef_7day_avg),
      ef_trend:             snap.ef_trend,
      decoupling_last_long: num(snap.decoupling_last_long),
      resting_hr_avg:       snap.resting_hr_avg,
      hrv_7day_avg:         num(snap.hrv_7day_avg),
      readiness_score:      snap.readiness_score,
      weekly_volume_hrs:    num(snap.weekly_volume_hrs),
      weekly_tss:           num(snap.weekly_tss),
      ytd_volume_hrs:       num(snap.ytd_volume_hrs)
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /fitness/snapshots
// ---------------------------------------------------------------------------

router.get('/fitness/snapshots', async (req, res, next) => {
  try {
    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const snaps = await getSnapshotHistory(pool, athleteId, {
      from: req.query.from,
      to:   req.query.to
    });

    res.json({
      data: snaps.map(s => ({
        snapshot_date:     s.snapshot_date,
        ctl:               num(s.ctl),
        atl:               num(s.atl),
        tsb:               num(s.tsb),
        ftp_current:       s.ftp_current,
        vdot_current:      num(s.vdot_current),
        readiness_score:   s.readiness_score,
        weekly_volume_hrs: num(s.weekly_volume_hrs),
        weekly_tss:        num(s.weekly_tss)
      }))
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /fitness/snapshot
// ---------------------------------------------------------------------------

router.post('/fitness/snapshot', async (req, res, next) => {
  try {
    const parsed = snapshotCreateSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues[0]);

    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const snap = await createSnapshot(pool, athleteId, parsed.data);
    res.status(201).json(snap);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /fitness/tests
// ---------------------------------------------------------------------------

router.get('/fitness/tests', async (req, res, next) => {
  try {
    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const tests = await getFieldTests(pool, athleteId, {
      sport: req.query.sport,
      type:  req.query.type
    });

    res.json({ data: tests });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /fitness/tests
// ---------------------------------------------------------------------------

router.post('/fitness/tests', async (req, res, next) => {
  try {
    const parsed = fieldTestCreateSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues[0]);

    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const test = await createFieldTest(pool, athleteId, parsed.data);

    // Trigger zone recalculation if the test contains an anchor metric value.
    // Mirrors the logic in POST /zones/recalculate — zone builders duplicated
    // here to avoid importing from a route file.
    let zonesUpdated = false;

    if (parsed.data.ftp_watts && parsed.data.sport === 'cycling') {
      const ftp = Number(parsed.data.ftp_watts);
      await replaceZoneModel(pool, athleteId, 'cycling', {
        methodology_id: parsed.data.methodology_id ?? null,
        ...buildCyclingZones(ftp)
      });
      await updateAthlete(pool, { ftp_watts: Math.round(ftp) });
      await markZonesUpdated(pool, test.id);
      zonesUpdated = true;
    } else if (parsed.data.vdot_score && parsed.data.sport === 'running') {
      const vdot = Number(parsed.data.vdot_score);
      await replaceZoneModel(pool, athleteId, 'running', {
        methodology_id: parsed.data.methodology_id ?? null,
        ...buildRunningZones(vdot)
      });
      await updateAthlete(pool, { vdot: vdot });
      await markZonesUpdated(pool, test.id);
      zonesUpdated = true;
    } else if (parsed.data.css_per_100m_sec && parsed.data.sport === 'swimming') {
      const css = Number(parsed.data.css_per_100m_sec);
      await replaceZoneModel(pool, athleteId, 'swimming', {
        methodology_id: parsed.data.methodology_id ?? null,
        ...buildSwimmingZones(css)
      });
      await updateAthlete(pool, { css_per_100m_sec: css });
      await markZonesUpdated(pool, test.id);
      zonesUpdated = true;
    }

    res.status(201).json({ ...test, zones_updated: zonesUpdated });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /fitness/labs
// ---------------------------------------------------------------------------

router.get('/fitness/labs', async (req, res, next) => {
  try {
    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const labs = await getLabResults(pool, athleteId);
    res.json({ data: labs });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /fitness/labs
// ---------------------------------------------------------------------------

router.post('/fitness/labs', async (req, res, next) => {
  try {
    const parsed = labResultCreateSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues[0]);

    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const lab = await createLabResult(pool, athleteId, parsed.data);
    res.status(201).json(lab);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /health/daily
// ---------------------------------------------------------------------------

router.get('/health/daily', async (req, res, next) => {
  try {
    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const metrics = await getDailyMetrics(pool, athleteId, {
      from: req.query.from,
      to:   req.query.to
    });

    res.json({
      data: metrics.map(m => ({
        date:                 m.date,
        hrv_nightly_avg:      num(m.hrv_nightly_avg),
        hrv_status:           m.hrv_status,
        resting_hr:           m.resting_hr,
        body_battery_morning: m.body_battery_morning,
        sleep_duration_hrs:   num(m.sleep_duration_hrs),
        sleep_score:          m.sleep_score,
        sleep_deep_hrs:       num(m.sleep_deep_hrs),
        sleep_rem_hrs:        num(m.sleep_rem_hrs),
        spo2_avg:             num(m.spo2_avg),
        stress_avg:           num(m.stress_avg),
        readiness_score:      m.readiness_score
      }))
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /health/daily
// ---------------------------------------------------------------------------

router.post('/health/daily', async (req, res, next) => {
  try {
    const parsed = dailyMetricsCreateSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues[0]);

    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const record = await createDailyMetrics(pool, athleteId, parsed.data);
    res.status(201).json(record);
  } catch (err) {
    // TimescaleDB unique constraint violation on (athlete_id, date)
    if (err.code === '23505') {
      return res.status(409).json({
        error: {
          code:    'CONFLICT',
          message: 'A daily metrics record for this date already exists',
          field:   'date'
        }
      });
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /fitness/backfill
// Calculates and writes weekly CTL/ATL/TSB snapshots for all historical sessions.
// Idempotent — skips weeks where a snapshot already exists.
// ---------------------------------------------------------------------------

// EMA constants (Coggan)
const CTL_K = 42;
const ATL_K = 7;

function bfToDateStr(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function bfAllDaysBetween(start, end) {
  const days = [];
  const cur  = new Date(start + 'T00:00:00Z');
  const last = new Date(end   + 'T00:00:00Z');
  while (cur <= last) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

// Returns the Sunday of the ISO week containing the given YYYY-MM-DD date.
function bfWeekSunday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const dow = d.getUTCDay(); // 0=Sun, 1=Mon, …
  const sunday = new Date(d);
  if (dow !== 0) sunday.setUTCDate(d.getUTCDate() + (7 - dow));
  return sunday.toISOString().slice(0, 10);
}

function bfOffsetDate(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function bfCalcReadiness(metrics, tsb, avg3dayHr) {
  const HRV_SCORE = { balanced: 100, unbalanced: 60, low: 30, poor: 0 };
  const hrv = HRV_SCORE[metrics?.hrv_status] ?? 50;

  let tsbScore;
  if (tsb > 10)  tsbScore = 100;
  else if (tsb > 0)   tsbScore = 80;
  else if (tsb > -10) tsbScore = 60;
  else if (tsb > -20) tsbScore = 40;
  else tsbScore = 20;

  const sleep    = metrics?.sleep_score  ?? 50;
  const wellness = (metrics?.wellness_score ?? 5) * 10;

  let hrTrend = 80;
  if (metrics?.resting_hr && avg3dayHr) {
    const diff = metrics.resting_hr - avg3dayHr;
    if (diff > 5)  hrTrend = 30;
    else if (diff > 2) hrTrend = 60;
    else if (diff >= 0) hrTrend = 80;
    else hrTrend = 100;
  }

  return Math.max(0, Math.min(100, Math.round(
    hrv      * 0.35 +
    tsbScore * 0.25 +
    sleep    * 0.20 +
    wellness * 0.10 +
    hrTrend  * 0.10
  )));
}

router.post('/fitness/backfill', async (req, res, next) => {
  try {
    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    // 1. Full TSS history (all time)
    const tssRows = await getTssHistory(pool, athleteId, { limit: 10000 });
    if (!tssRows.length) {
      return res.json({ created: 0, skipped: 0, total_weeks: 0, message: 'No session TSS data found' });
    }

    // 2. Skip weeks that already have a snapshot
    const existingDates = await getExistingSnapshotDates(pool, athleteId);

    // 3. Athlete anchors (current values — best we have for historical snapshots)
    const athlete = await getAthlete(pool);

    // 4. Build per-date TSS + duration map (multiple sessions on same day sum together)
    const byDate = new Map();
    for (const row of tssRows) {
      const d = bfToDateStr(row.activity_date);
      const prev = byDate.get(d) ?? { tss: 0, duration_sec: 0 };
      byDate.set(d, {
        tss:         prev.tss          + Number(row.tss),
        duration_sec: prev.duration_sec + (Number(row.duration_sec) || 0),
      });
    }

    // 5. Walk every calendar day from first session to today, building CTL/ATL/TSB
    const firstDate = bfToDateStr(tssRows[0].activity_date);
    const today     = new Date().toISOString().slice(0, 10);
    const days      = bfAllDaysBetween(firstDate, today);

    let ctl = 0, atl = 0;
    const dailyLoad = []; // { date, tss, duration_sec, ctl, atl, tsb }

    for (const date of days) {
      const entry = byDate.get(date) ?? { tss: 0, duration_sec: 0 };
      const tsb   = ctl - atl; // TSB is yesterday's CTL - ATL
      ctl = ctl + (entry.tss - ctl) / CTL_K;
      atl = atl + (entry.tss - atl) / ATL_K;
      dailyLoad.push({ date, tss: entry.tss, duration_sec: entry.duration_sec, ctl, atl, tsb });
    }

    // 6. Group daily entries by ISO week, keyed on that week's Sunday
    const weekMap = new Map(); // sundayDate → dailyLoad entries[]
    for (const entry of dailyLoad) {
      const sunday = bfWeekSunday(entry.date);
      if (!weekMap.has(sunday)) weekMap.set(sunday, []);
      weekMap.get(sunday).push(entry);
    }

    // 7. Fetch all daily_metrics once, index by date
    const metricsRows = await getDailyMetrics(pool, athleteId, { from: firstDate, to: today });
    const metricsByDate = new Map();
    for (const m of metricsRows) {
      metricsByDate.set(bfToDateStr(m.date), m);
    }

    // 8. Write one snapshot per week
    let created = 0, skipped = 0;

    for (const [sunday, entries] of weekMap) {
      // Skip future weeks (Sunday hasn't arrived yet)
      if (sunday > today) continue;

      if (existingDates.has(sunday)) { skipped++; continue; }

      // Use the last day in the week that had actual data (or Sunday itself)
      const lastEntry = entries[entries.length - 1];

      // CTL/ATL/TSB from Sunday's final state
      const sundayEntry = entries.find(e => e.date === sunday) ?? lastEntry;

      // Readiness — prefer Sunday metrics, fall back to last day with data
      const metrics = metricsByDate.get(sunday) ?? metricsByDate.get(lastEntry.date) ?? {};

      // 3-day avg resting HR prior to Sunday
      const hrValues = [];
      for (let i = 1; i <= 3; i++) {
        const m = metricsByDate.get(bfOffsetDate(sunday, -i));
        if (m?.resting_hr) hrValues.push(Number(m.resting_hr));
      }
      const avg3dayHr = hrValues.length
        ? hrValues.reduce((a, b) => a + b, 0) / hrValues.length
        : null;

      const readiness = bfCalcReadiness(metrics, sundayEntry.tsb, avg3dayHr);

      // Weekly totals
      const weeklyTss = Math.round(entries.reduce((s, e) => s + e.tss, 0) * 10) / 10;
      const weeklyVolHrs = Math.round(entries.reduce((s, e) => s + e.duration_sec, 0) / 3600 * 100) / 100;

      const payload = {
        snapshot_date:     sunday,
        ctl:               Math.round(sundayEntry.ctl * 10) / 10,
        atl:               Math.round(sundayEntry.atl * 10) / 10,
        tsb:               Math.round(sundayEntry.tsb * 10) / 10,
        readiness_score:   readiness,
        weekly_tss:        weeklyTss || undefined,
        weekly_volume_hrs: weeklyVolHrs || undefined,
        ftp_current:       athlete?.ftp_watts        ?? undefined,
        vdot_current:      athlete?.vdot             ?? undefined,
        css_current_sec:   athlete?.css_per_100m_sec ?? undefined,
      };

      // Strip undefined/null so strict schema accepts it
      const clean = Object.fromEntries(Object.entries(payload).filter(([, v]) => v != null));
      await createSnapshot(pool, athleteId, clean);
      created++;
    }

    res.json({ created, skipped, total_weeks: weekMap.size });
  } catch (err) { next(err); }
});

export default router;

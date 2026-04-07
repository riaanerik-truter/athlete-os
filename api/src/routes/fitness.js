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
  getTssHistory,
  getAbilitiesData,
  getZoneDistribution
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
      readiness_score:      num(snap.readiness_score),
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
      from:  req.query.from,
      to:    req.query.to,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });

    res.json({
      data: snaps.map(s => ({
        snapshot_date:     s.snapshot_date instanceof Date
          ? [
              s.snapshot_date.getFullYear(),
              String(s.snapshot_date.getMonth() + 1).padStart(2, '0'),
              String(s.snapshot_date.getDate()).padStart(2, '0')
            ].join('-')
          : String(s.snapshot_date).slice(0, 10),
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
      from:  req.query.from,
      to:    req.query.to,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
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

// ---------------------------------------------------------------------------
// GET /fitness/abilities
// Returns six Friel ability scores with metric values and 7-week history.
// ---------------------------------------------------------------------------

const ABILITY_DEFS = [
  {
    key: 'aerobic_endurance', name: 'Aerobic Endurance', subLabel: 'Base fitness foundation',
    blockNotes: {
      base:        'Primary focus — expect steady EF and decoupling improvement week-on-week',
      build:       'Maintenance phase — monitor decoupling before advancing to Build',
      peak:        'Slight dip is normal — volume is reduced for race taper',
      race:        'Expected low — training load is minimal for race freshness',
      preparation: 'Building aerobic base — frequency before duration',
      default:     'Track EF trend and decoupling % to gauge readiness to progress',
    },
    metrics: [
      { key: 'ef_7day_avg',    label: 'EF 7-day avg',              weight: 'high', unit: '',  decimals: 2, range: [0.8, 2.0] },
      { key: 'decoupling_pct', label: 'Decoupling last long ride', weight: 'high', unit: '%', decimals: 1, range: [15, 0]    },
      { key: 'z1z2_share',     label: 'Z1-Z2 volume share 4wk',   weight: 'med',  unit: '%', decimals: 0, range: [0, 85]    },
      { key: 'long_ride_count',label: 'Long rides >90min 4wk',    weight: 'low',  unit: '',  decimals: 0, range: [0, 4]     },
    ]
  },
  {
    key: 'muscular_force', name: 'Muscular Force', subLabel: 'Strength and force application',
    blockNotes: {
      base:        'Primary development window — MF sessions are the training priority',
      build:       'Transitioning to muscular endurance — MF sessions become less frequent',
      peak:        'Minimal MF work — neural maintenance patterns only',
      race:        'No MF sessions — focused on race execution',
      preparation: 'AA/MT gym strength phase underway — foundation for MF rides',
      default:     'Peak 5s and 20s power reflect neuromuscular and force recruitment capacity',
    },
    metrics: [
      { key: 'peak_5s_power',  label: 'Peak 5s power',          weight: 'high', unit: 'W',  decimals: 0, range: [300, 1200] },
      { key: 'peak_20s_power', label: 'Peak 20s power',         weight: 'high', unit: 'W',  decimals: 0, range: [200, 900]  },
      { key: 'mf_count',       label: 'MF sessions 4wk',        weight: 'med',  unit: '',   decimals: 0, range: [0, 6]      },
      { key: 'avg_gradient',   label: 'Avg climb gradient 4wk', weight: 'low',  unit: '%',  decimals: 1, range: [0, 8]      },
    ]
  },
  {
    key: 'speed_skills', name: 'Speed Skills', subLabel: 'Pedalling efficiency and form',
    blockNotes: {
      base:        'Good period to develop cadence habits — spin-ups and isolated leg drills',
      build:       'SS sessions maintain neuromuscular sharpness alongside ME work',
      peak:        'Form drills keep fast-twitch recruitment patterns active',
      race:        'Keep legs turning over — short cadence drills are fine',
      preparation: 'Focus on pedalling mechanics before adding training load',
      default:     'Avg cadence and variability index reflect pedalling efficiency',
    },
    metrics: [
      { key: 'avg_cadence', label: 'Avg cadence',              weight: 'high', unit: 'rpm', decimals: 0, range: [70, 100]   },
      { key: 'vi_avg',      label: 'Variability index avg',    weight: 'high', unit: '',    decimals: 2, range: [1.20, 1.00] },
      { key: 'ss_count',    label: 'SS sessions 4wk',          weight: 'med',  unit: '',    decimals: 0, range: [0, 4]       },
      { key: 'hc_time_hrs', label: 'High cadence >100rpm 4wk', weight: 'low',  unit: 'hrs', decimals: 1, range: [0, 2]      },
    ]
  },
  {
    key: 'muscular_endurance', name: 'Muscular Endurance', subLabel: 'Sustained power at threshold',
    blockNotes: {
      base:        'Not the focus yet — a small ME stimulus primes the neuromuscular system',
      build:       'Primary development window — ME sessions dominate the week structure',
      peak:        'Sharpening phase — reduced ME volume, maintained intensity',
      race:        'No new ME stimulus — legs are primed for race output',
      preparation: 'Build aerobic base first — ME work starts in Base',
      default:     'Track intensity factor on long efforts and time above threshold',
    },
    metrics: [
      { key: 'if_long',       label: 'IF on long efforts',     weight: 'high', unit: '',    decimals: 2, range: [0.5, 0.9] },
      { key: 'threshold_min', label: 'Threshold time 4wk',     weight: 'med',  unit: 'min', decimals: 0, range: [0, 120]   },
      { key: 'me_count',      label: 'ME sessions 4wk',        weight: 'med',  unit: '',    decimals: 0, range: [0, 8]     },
      { key: 'z4_power',      label: 'Avg power ME sessions',  weight: 'low',  unit: 'W',   decimals: 0, range: [150, 350] },
    ]
  },
  {
    key: 'aerobic_capacity', name: 'Aerobic Capacity', subLabel: 'VO₂max and high-intensity ceiling',
    blockNotes: {
      base:        'Not the focus — occasional AC work maintains the ceiling without disrupting base',
      build:       'AC sessions are secondary to ME — one per week maximum',
      peak:        'AC sessions sharpen the top end — critical before the race',
      race:        'No new AC work — peak aerobic capacity should already be banked',
      preparation: 'No AC work yet — base fitness comes first',
      default:     'VO₂max estimate and Z5 time reflect the high-intensity ceiling',
    },
    metrics: [
      { key: 'vo2max',      label: 'VO₂max estimate',  weight: 'high', unit: 'ml/kg/min', decimals: 1, range: [30, 70] },
      { key: 'ac_count',    label: 'AC sessions 4wk',  weight: 'med',  unit: '',          decimals: 0, range: [0, 6]   },
      { key: 'z5_time_min', label: 'Time at Z5+ 4wk',  weight: 'med',  unit: 'min',       decimals: 0, range: [0, 90]  },
      { key: 'peak_3min_w', label: 'Peak 3min power',  weight: 'low',  unit: 'W',         decimals: 0, range: [200, 600] },
    ]
  },
  {
    key: 'sprint_power', name: 'Sprint Power', subLabel: 'Explosive short-duration power',
    blockNotes: {
      base:        'Low priority — form sprints once a week keep neural recruitment sharp',
      build:       'Low priority unless sprint finishes are on the race schedule',
      peak:        'One short SP session per week activates fast-twitch fibres',
      race:        'A short sprint set in the final days keeps the recruitment pattern primed',
      preparation: 'No sprint work yet',
      default:     'Peak 5s and 10s power reflect the anaerobic ceiling',
    },
    metrics: [
      { key: 'peak_5s_power',  label: 'Peak 5s power',          weight: 'high', unit: 'W', decimals: 0, range: [300, 1200] },
      { key: 'peak_10s_power', label: 'Peak 10s power',         weight: 'high', unit: 'W', decimals: 0, range: [250, 1000] },
      { key: 'sp_count',       label: 'SP sessions 4wk',        weight: 'med',  unit: '',  decimals: 0, range: [0, 4]      },
      { key: 'fs_count',       label: 'Form sprint count 4wk',  weight: 'low',  unit: '',  decimals: 0, range: [0, 8]      },
    ]
  },
];

// Normalize a value to 0–100 using [worst, best] range.
function abNorm(value, [low, high]) {
  if (value == null || !isFinite(value)) return null;
  const range = high - low;
  if (Math.abs(range) < 0.0001) return 0;
  return Math.max(0, Math.min(100, Math.round((value - low) / range * 100)));
}

// Weighted average of normalized scores; redistributes weight across available metrics only.
function calcAbilityScore(normalizedMap, abilityDef) {
  const TIER = { high: 0.5, med: 0.35, low: 0.15 };
  const tierCounts = { high: 0, med: 0, low: 0 };
  for (const m of abilityDef.metrics) tierCounts[m.weight]++;

  let totalScore = 0, totalWeight = 0;
  for (const m of abilityDef.metrics) {
    const ns = normalizedMap[m.key];
    if (ns == null) continue;
    const w = TIER[m.weight] / tierCounts[m.weight];
    totalScore += ns * w;
    totalWeight += w;
  }
  return totalWeight > 0 ? Math.round(totalScore / totalWeight) : null;
}

// Returns ISO Monday date for a given YYYY-MM-DD string.
function toMonday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const dow = d.getUTCDay(); // 0=Sun
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return d.toISOString().slice(0, 10);
}

// Returns the last 7 ISO week Mondays (oldest first, current week last).
function getLast7Mondays() {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const dow = today.getUTCDay();
  const thisMonday = new Date(today);
  thisMonday.setUTCDate(today.getUTCDate() - (dow === 0 ? 6 : dow - 1));

  const mondays = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(thisMonday);
    d.setUTCDate(thisMonday.getUTCDate() - i * 7);
    mondays.push(d.toISOString().slice(0, 10));
  }
  return mondays;
}

function weekLabel(monday) {
  const d = new Date(monday + 'T00:00:00Z');
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

// Returns the snapshot entry whose date is closest to (and ≤) the given Sunday of a week.
function nearestSnapshot(snapshotHistory, monday) {
  const sunday = new Date(monday + 'T00:00:00Z');
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  const sundayStr = sunday.toISOString().slice(0, 10);
  // Snapshot history is DESC, so find the first one ≤ sunday
  return snapshotHistory.find(s => s.snapshot_date <= sundayStr) ?? null;
}

// Extract VO2max: prefer lab result, fall back to VDOT (which approximates VO2max).
function extractVo2max(raw) {
  if (raw.lab?.structured_data) {
    const sd = typeof raw.lab.structured_data === 'string'
      ? JSON.parse(raw.lab.structured_data)
      : raw.lab.structured_data;
    const v = sd?.vo2max ?? sd?.VO2max ?? sd?.vo2_max;
    if (v != null && isFinite(Number(v))) return Number(v);
  }
  if (raw.athlete?.vdot != null) return Number(raw.athlete.vdot); // VDOT ≈ VO2max
  return null;
}

// Calculate per-week metrics from a slice of sessions plus snapshot/field-test data.
function calcWeekMetrics(weekSessions, snap, latestTest, vo2max, maxPower1s) {
  const cycling = weekSessions.filter(s => ['cycling', 'mtb'].includes(s.sport));

  // --- Aerobic endurance ---
  const ef_7day_avg    = snap ? num(snap.ef_7day_avg)       : null;
  const decoupling_pct = snap ? num(snap.decoupling_last_long) : null;

  let z1z2_share = null, z5_time_min = null, threshold_min = null;
  let totalZoneSec = 0, z1z2Sec = 0, z5Sec = 0, z4z5Sec = 0;
  for (const s of weekSessions) {
    if (!s.zone_distribution) continue;
    const zd = typeof s.zone_distribution === 'string'
      ? JSON.parse(s.zone_distribution)
      : s.zone_distribution;
    const z1 = Number(zd.Z1 || 0), z2 = Number(zd.Z2 || 0);
    const z3 = Number(zd.Z3 || 0), z4 = Number(zd.Z4 || 0);
    const z5a = Number(zd.Z5a || 0), z5b = Number(zd.Z5b || 0), z5c = Number(zd.Z5c || 0);
    const total = z1 + z2 + z3 + z4 + z5a + z5b + z5c;
    totalZoneSec += total;
    z1z2Sec += z1 + z2;
    z5Sec   += z5a + z5b + z5c;
    z4z5Sec += z4 + z5a + z5b + z5c;
  }
  if (totalZoneSec > 0) {
    z1z2_share    = Math.round(z1z2Sec / totalZoneSec * 100);
    z5_time_min   = Math.round(z5Sec   / 60);
    threshold_min = Math.round(z4z5Sec / 60);
  }

  const long_ride_count = weekSessions.filter(s => (s.duration_sec || 0) > 90 * 60).length;

  // --- Muscular force / sprint power (from field test or stream max) ---
  const peak_5s_power  = latestTest?.sprint_5s_peak_w
    ? num(latestTest.sprint_5s_peak_w)
    : (maxPower1s ? num(maxPower1s) : null);
  const peak_20s_power = latestTest?.sprint_20s_avg_w ? num(latestTest.sprint_20s_avg_w) : null;
  const peak_10s_power = peak_5s_power ? Math.round(peak_5s_power * 0.90) : null;
  const peak_3min_w    = latestTest?.vo2max_power_w
    ? num(latestTest.vo2max_power_w)
    : (latestTest?.avg_power_20min ? Math.round(num(latestTest.avg_power_20min) * 1.06) : null);

  // --- Session type counts ---
  const mf_count = weekSessions.filter(s => s.session_type_code?.startsWith('MF')).length;
  const ss_count = weekSessions.filter(s => s.session_type_code?.startsWith('SS')).length;
  const me_count = weekSessions.filter(s => s.session_type_code?.startsWith('ME')).length;
  const ac_count = weekSessions.filter(s => s.session_type_code?.startsWith('AC')).length;
  const sp_count = weekSessions.filter(s => s.session_type_code?.startsWith('SP')).length;
  const fs_count = weekSessions.filter(s => s.session_type_code === 'SS1').length;

  // --- Speed skills ---
  const cadSessions = cycling.filter(s => s.avg_cadence != null);
  const avg_cadence = cadSessions.length
    ? Math.round(cadSessions.reduce((s, r) => s + num(r.avg_cadence), 0) / cadSessions.length)
    : null;

  const viSessions = cycling.filter(s => s.variability_index != null);
  const vi_avg = viSessions.length
    ? Math.round(viSessions.reduce((s, r) => s + num(r.variability_index), 0) / viSessions.length * 100) / 100
    : null;

  const hc_time_hrs = Math.round(ss_count * 0.25 * 10) / 10;

  // --- Climb gradient ---
  let avg_gradient = null;
  const climbSess = cycling.filter(s => s.elevation_gain_m != null && s.distance_m > 0);
  if (climbSess.length) {
    const gain = climbSess.reduce((s, r) => s + num(r.elevation_gain_m), 0);
    const dist = climbSess.reduce((s, r) => s + num(r.distance_m), 0);
    if (dist > 0) avg_gradient = Math.round(gain / dist * 1000) / 10;
  }

  // --- Muscular endurance ---
  const longIf = cycling.filter(s => (s.duration_sec || 0) > 90 * 60 && s.intensity_factor_garmin != null);
  const if_long = longIf.length
    ? Math.round(longIf.reduce((s, r) => s + num(r.intensity_factor_garmin), 0) / longIf.length * 100) / 100
    : null;

  const meSess = weekSessions.filter(s => s.session_type_code?.startsWith('ME') && s.avg_power_w != null);
  const z4_power = meSess.length
    ? Math.round(meSess.reduce((s, r) => s + num(r.avg_power_w), 0) / meSess.length)
    : null;

  return {
    ef_7day_avg, decoupling_pct, z1z2_share, long_ride_count,
    peak_5s_power, peak_20s_power, mf_count, avg_gradient,
    avg_cadence, vi_avg, ss_count, hc_time_hrs,
    if_long, threshold_min, me_count, z4_power,
    vo2max, ac_count, z5_time_min, peak_3min_w,
    peak_10s_power, sp_count, fs_count,
  };
}

router.get('/fitness/abilities', async (req, res, next) => {
  try {
    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const raw = await getAbilitiesData(pool, athleteId);
    const mondays = getLast7Mondays();

    // Group sessions by ISO week Monday
    const weekMap = new Map(); // monday → sessions[]
    for (const s of raw.sessions) {
      const m = toMonday(s.activity_date);
      if (!weekMap.has(m)) weekMap.set(m, []);
      weekMap.get(m).push(s);
    }

    const latestTest = raw.fieldTests[0] ?? null;
    const vo2max     = extractVo2max(raw);

    // Per-week metrics for each of the 7 weeks
    const weeklyMetrics = mondays.map(monday => {
      const sessions = weekMap.get(monday) ?? [];
      const snap     = nearestSnapshot(raw.snapshotHistory, monday);
      return { ...calcWeekMetrics(sessions, snap, latestTest, vo2max, raw.maxPower1s), _sessionCount: sessions.length };
    });

    // "Current" = most recent week with sessions; fall back to last week if this week just started
    const currentIdx = (() => {
      for (let i = weeklyMetrics.length - 1; i >= 0; i--) {
        if (weeklyMetrics[i]._sessionCount > 0) return i;
      }
      return weeklyMetrics.length - 1; // all empty — use last
    })();

    // Build abilities response
    const abilities = ABILITY_DEFS.map(def => {
      // Normalize each week's metrics
      const weeklyNorm = weeklyMetrics.map(wm => {
        const n = {};
        for (const m of def.metrics) n[m.key] = abNorm(wm[m.key], m.range);
        return n;
      });
      const weeklyScores = weeklyNorm.map(n => calcAbilityScore(n, def));

      // Current = most recent week with data
      const currentWm   = weeklyMetrics[currentIdx];
      const currentNorm = weeklyNorm[currentIdx];
      const score       = weeklyScores[currentIdx];

      // Trend: avg of last 2 vs prior 2 weeks
      const recent = weeklyScores.slice(-2).filter(s => s != null);
      const prior  = weeklyScores.slice(-4, -2).filter(s => s != null);
      let trend = 'stable';
      if (recent.length && prior.length) {
        const diff = (recent.reduce((a, b) => a + b, 0) / recent.length)
                   - (prior.reduce((a, b) => a + b, 0) / prior.length);
        if (diff > 3) trend = 'improving';
        else if (diff < -3) trend = 'declining';
      }

      const metrics = def.metrics.map(mDef => {
        const value   = currentWm[mDef.key];
        const prevVal = weeklyMetrics[weeklyMetrics.length - 2]?.[mDef.key];
        let metricTrend = 'stable';
        if (value != null && prevVal != null && prevVal !== 0) {
          const diff = (value - prevVal) / Math.abs(prevVal) * 100;
          if (diff > 3) metricTrend = 'up';
          else if (diff < -3) metricTrend = 'down';
        }
        const rounded = value != null
          ? Math.round(value * 10 ** mDef.decimals) / 10 ** mDef.decimals
          : null;
        return {
          key:             mDef.key,
          label:           mDef.label,
          weight:          mDef.weight,
          unit:            mDef.unit,
          decimals:        mDef.decimals,
          value:           rounded,
          normalizedScore: currentNorm[mDef.key],
          trend:           metricTrend,
        };
      });

      const history = mondays.map((monday, i) => ({
        weekLabel:  weekLabel(monday),
        weekDate:   monday,
        score:      weeklyScores[i],
        metrics:    def.metrics.reduce((acc, mDef) => {
          acc[mDef.key] = weeklyMetrics[i][mDef.key];
          return acc;
        }, {}),
      }));

      return {
        key:        def.key,
        name:       def.name,
        subLabel:   def.subLabel,
        blockNotes: def.blockNotes,
        score,
        trend,
        metrics,
        history,
      };
    });

    res.json({ abilities });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /fitness/zone-distribution
// ---------------------------------------------------------------------------

router.get('/fitness/zone-distribution', async (req, res, next) => {
  try {
    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const sportsParam = req.query.sports;
    const sports = sportsParam
      ? sportsParam.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    const data = await getZoneDistribution(pool, athleteId, {
      sports,
      from: req.query.from,
      to:   req.query.to,
    });

    const toSec = v => Math.round(Number(v || 0));
    const zones = {
      // HR zones (Friel Z1-Z5c)
      Z1:  toSec(data.z1_sec),
      Z2:  toSec(data.z2_sec),
      Z3:  toSec(data.z3_sec),
      Z4:  toSec(data.z4_sec),
      Z5a: toSec(data.z5a_sec),
      Z5b: toSec(data.z5b_sec),
      Z5c: toSec(data.z5c_sec),
      // Power zones (Garmin pZ1-pZ6, Coggan-aligned)
      pZ1: toSec(data.pz1_sec),
      pZ2: toSec(data.pz2_sec),
      pZ3: toSec(data.pz3_sec),
      pZ4: toSec(data.pz4_sec),
      pZ5: toSec(data.pz5_sec),
      pZ6: toSec(data.pz6_sec),
      // Daniels pace zones (running)
      E:   toSec(data.e_sec),
      M:   toSec(data.m_sec),
      T:   toSec(data.t_sec),
      I:   toSec(data.i_sec),
      R:   toSec(data.r_sec),
    };

    const totalZoneSec = Object.values(zones).reduce((a, b) => a + b, 0);

    res.json({
      zones,
      total_zone_sec:     totalZoneSec,
      total_duration_sec: toSec(data.total_duration_sec),
      total_sessions:     Number(data.total_sessions ?? 0),
      sessions_with_zones: Number(data.sessions_with_zones ?? 0),
    });
  } catch (err) { next(err); }
});

export default router;

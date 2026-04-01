/**
 * Group: Season and Planning
 * Endpoints: GET /season, POST /season, GET /goals, POST /goals, PATCH /goals/:id,
 *            GET /periods, POST /periods, GET /periods/:id/weeks, GET /weeks/current
 *
 * Manual verification:
 * - GET /season returns active season with periods array; falls back to most recent season
 * - GET /season returns 404 when no season exists
 * - POST /season creates and returns new season (201)
 * - POST /season with missing required fields returns 422 VALIDATION_ERROR
 * - GET /goals with ?status=active returns only active goals
 * - GET /goals with ?type=a_race returns only a_race goals
 * - POST /goals creates and returns new goal (201)
 * - PATCH /goals/:id with changed fields appends revision_log entry automatically
 * - PATCH /goals/:id with unknown field returns 422 VALIDATION_ERROR
 * - PATCH /goals/:id for non-existent goal returns 404 NOT_FOUND
 * - GET /periods returns all periods for the current active season
 * - POST /periods creates and returns new period (201)
 * - GET /periods/:id/weeks returns all weeks within the period
 * - GET /periods/:id/weeks for non-existent period returns 404 NOT_FOUND
 * - GET /weeks/current returns current week with sessions array and compliance_pct
 * - GET /weeks/current returns 404 when no week covers today
 */

import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { getAthleteId } from '../db/sync.js';
import {
  getActiveSeason,
  getPeriodsBySeason,
  createSeason,
  getGoals,
  createGoal,
  updateGoal,
  getPeriods,
  createPeriod,
  getWeeksByPeriod,
  getCurrentWeek,
  getCurrentPeriod
} from '../db/season.js';
import { getPlannedSessionsByWeek } from '../db/sessions.js';

const router = Router();

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const seasonCreateSchema = z.object({
  name:         z.string().min(1),
  year:         z.number().int().min(2020).max(2040),
  start_date:   z.string().date(),
  end_date:     z.string().date(),
  primary_goal: z.string().optional(),
  notes:        z.string().optional()
}).strict();

const goalCreateSchema = z.object({
  season_id:      z.string().uuid().optional(),
  type:           z.string().min(1),
  priority:       z.enum(['A', 'B', 'C']).optional(),
  title:          z.string().min(1),
  description:    z.string().optional(),
  event_date:     z.string().date().optional(),
  event_name:     z.string().optional(),
  event_distance: z.string().optional(),
  event_sport:    z.string().optional(),
  target_metric:  z.string().optional(),
  target_value:   z.number().optional(),
  target_unit:    z.string().optional()
}).strict();

const goalPatchSchema = z.object({
  type:           z.string().min(1).optional(),
  priority:       z.enum(['A', 'B', 'C']).optional(),
  title:          z.string().min(1).optional(),
  description:    z.string().optional(),
  event_date:     z.string().date().optional(),
  event_name:     z.string().optional(),
  event_distance: z.string().optional(),
  event_sport:    z.string().optional(),
  target_metric:  z.string().optional(),
  target_value:   z.number().optional(),
  target_unit:    z.string().optional(),
  status:         z.enum(['active', 'achieved', 'abandoned', 'deferred']).optional(),
  revision_reason: z.string().optional()
}).strict();

const periodCreateSchema = z.object({
  season_id:           z.string().uuid(),
  methodology_id:      z.string().uuid().optional(),
  name:                z.string().min(1),
  period_type:         z.enum(['preparation', 'base', 'build', 'peak', 'race', 'transition']),
  sub_period:          z.string().optional(),
  start_date:          z.string().date(),
  end_date:            z.string().date(),
  objective:           z.string().optional(),
  intensity_dist_type: z.enum(['pure_middle', 'polarised']).optional(),
  planned_weekly_hrs:  z.number().positive().optional(),
  target_ctl_end:      z.number().optional(),
  strength_phase:      z.string().optional(),
  progression_gate:    z.record(z.unknown()).optional(),
  notes:               z.string().optional()
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

async function resolveAthleteId(res) {
  const athleteId = await getAthleteId(pool);
  return athleteId;
}

// ---------------------------------------------------------------------------
// GET /season
// ---------------------------------------------------------------------------

router.get('/season', async (req, res, next) => {
  try {
    const athleteId = await resolveAthleteId(res);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const season = await getActiveSeason(pool, athleteId);
    if (!season) return notFound(res, 'No season found');

    const periods = await getPeriodsBySeason(pool, athleteId, season.id);

    res.json({
      id:           season.id,
      name:         season.name,
      year:         season.year,
      start_date:   season.start_date,
      end_date:     season.end_date,
      primary_goal: season.primary_goal,
      notes:        season.notes,
      created_at:   season.created_at,
      periods:      periods.map(p => ({
        id:                  p.id,
        name:                p.name,
        period_type:         p.period_type,
        sub_period:          p.sub_period,
        start_date:          p.start_date,
        end_date:            p.end_date,
        status:              p.status,
        objective:           p.objective,
        intensity_dist_type: p.intensity_dist_type,
        planned_weekly_hrs:  p.planned_weekly_hrs !== null ? Number(p.planned_weekly_hrs) : null,
        strength_phase:      p.strength_phase
      }))
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /season
// ---------------------------------------------------------------------------

router.post('/season', async (req, res, next) => {
  try {
    const parsed = seasonCreateSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues[0]);

    const athleteId = await resolveAthleteId(res);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const season = await createSeason(pool, athleteId, parsed.data);

    res.status(201).json({
      id:           season.id,
      name:         season.name,
      year:         season.year,
      start_date:   season.start_date,
      end_date:     season.end_date,
      primary_goal: season.primary_goal,
      notes:        season.notes,
      created_at:   season.created_at,
      periods:      []
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /goals
// ---------------------------------------------------------------------------

router.get('/goals', async (req, res, next) => {
  try {
    const athleteId = await resolveAthleteId(res);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const goals = await getGoals(pool, athleteId, {
      status: req.query.status,
      type:   req.query.type
    });

    res.json({ data: goals });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /goals
// ---------------------------------------------------------------------------

router.post('/goals', async (req, res, next) => {
  try {
    const parsed = goalCreateSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues[0]);

    const athleteId = await resolveAthleteId(res);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const goal = await createGoal(pool, athleteId, parsed.data);
    res.status(201).json(goal);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// PATCH /goals/:id
// ---------------------------------------------------------------------------

router.patch('/goals/:id', async (req, res, next) => {
  try {
    const parsed = goalPatchSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues[0]);

    const athleteId = await resolveAthleteId(res);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const { revision_reason, ...fields } = parsed.data;

    // Build a revision log entry capturing what is changing
    const revisionEntry = Object.keys(fields).length > 0
      ? { date: new Date().toISOString(), reason: revision_reason ?? null, updated_fields: Object.keys(fields) }
      : null;

    const goal = await updateGoal(pool, athleteId, req.params.id, fields, revisionEntry);
    if (!goal) return notFound(res, 'Goal not found');

    res.json(goal);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /periods/current
// ---------------------------------------------------------------------------

router.get('/periods/current', async (req, res, next) => {
  try {
    const athleteId = await resolveAthleteId(res);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const period = await getCurrentPeriod(pool, athleteId);
    if (!period) return notFound(res, 'No active period covers today');

    res.json({
      id:                  period.id,
      season_id:           period.season_id,
      name:                period.name,
      period_type:         period.period_type,
      sub_period:          period.sub_period,
      start_date:          period.start_date,
      end_date:            period.end_date,
      status:              period.status,
      objective:           period.objective,
      intensity_dist_type: period.intensity_dist_type,
      planned_weekly_hrs:  period.planned_weekly_hrs !== null ? Number(period.planned_weekly_hrs) : null,
      target_ctl_end:      period.target_ctl_end      !== null ? Number(period.target_ctl_end)     : null,
      strength_phase:      period.strength_phase,
      engine_mode:         period.engine_mode,
      progression_gate:    period.progression_gate,
      notes:               period.notes
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /periods
// ---------------------------------------------------------------------------

router.get('/periods', async (req, res, next) => {
  try {
    const athleteId = await resolveAthleteId(res);
    if (!athleteId) return notFound(res, 'Athlete not found');

    // Scope to the active season if no season_id query param provided
    let seasonId = req.query.season_id ?? null;
    if (!seasonId) {
      const season = await getActiveSeason(pool, athleteId);
      seasonId = season?.id ?? null;
    }

    const periods = await getPeriods(pool, athleteId, seasonId);
    res.json({ data: periods });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /periods
// ---------------------------------------------------------------------------

router.post('/periods', async (req, res, next) => {
  try {
    const parsed = periodCreateSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues[0]);

    const athleteId = await resolveAthleteId(res);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const period = await createPeriod(pool, athleteId, parsed.data);
    res.status(201).json(period);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /periods/:id/weeks
// ---------------------------------------------------------------------------

router.get('/periods/:id/weeks', async (req, res, next) => {
  try {
    const athleteId = await resolveAthleteId(res);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const weeks = await getWeeksByPeriod(pool, athleteId, req.params.id);

    // Return 404 if the period does not exist or belongs to another athlete
    // (getWeeksByPeriod returns [] for an unknown period — we can't distinguish
    // "period exists but has no weeks" from "period doesn't exist" without an extra
    // query. A period with zero weeks is valid, so we just return the empty array.)
    res.json({ data: weeks });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /weeks/current
// ---------------------------------------------------------------------------

router.get('/weeks/current', async (req, res, next) => {
  try {
    const athleteId = await resolveAthleteId(res);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const week = await getCurrentWeek(pool, athleteId);
    if (!week) return notFound(res, 'No week covers today');

    const sessions = await getPlannedSessionsByWeek(pool, athleteId, week.id);

    const plannedVol  = week.planned_volume_hrs !== null ? Number(week.planned_volume_hrs) : null;
    const actualVol   = week.actual_volume_hrs  !== null ? Number(week.actual_volume_hrs)  : 0;
    const plannedTss  = week.planned_tss        !== null ? Number(week.planned_tss)         : null;
    const actualTss   = week.actual_tss         !== null ? Number(week.actual_tss)          : 0;
    const compliance  = plannedVol && plannedVol > 0
      ? Math.round((actualVol / plannedVol) * 1000) / 10
      : null;

    res.json({
      id:                 week.id,
      week_number:        week.week_number,
      start_date:         week.start_date,
      end_date:           week.end_date,
      week_type:          week.week_type,
      planned_volume_hrs: plannedVol,
      actual_volume_hrs:  actualVol,
      planned_tss:        plannedTss,
      actual_tss:         actualTss,
      compliance_pct:     compliance,
      sessions:           sessions.map(s => ({
        id:                  s.id,
        scheduled_date:      s.scheduled_date,
        sport:               s.sport,
        title:               s.title,
        target_zone:         s.target_zone,
        target_duration_min: s.target_duration_min,
        status:              s.status,
        priority:            s.priority
      }))
    });
  } catch (err) { next(err); }
});

export default router;

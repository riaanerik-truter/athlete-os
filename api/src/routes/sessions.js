/**
 * Group: Sessions
 * Endpoints: GET /sessions, GET /sessions/:id, POST /sessions, PATCH /sessions/:id,
 *            GET /sessions/:id/stream, GET /sessions/planned, POST /sessions/planned
 *
 * Manual verification:
 * - GET /sessions returns paginated envelope with data[] and pagination{}
 * - GET /sessions?sport=cycling returns only cycling sessions
 * - GET /sessions?from=2026-01-01&to=2026-03-30 returns date-filtered results
 * - GET /sessions?limit=5&page=2 returns correct page slice
 * - GET /sessions?limit=200 is capped at 100
 * - GET /sessions/:id returns full detail with zone_distribution, score, and planned_session summary
 * - GET /sessions/:id for unknown ID returns 404 NOT_FOUND
 * - POST /sessions creates and returns completed session (201)
 * - POST /sessions with duplicate garmin_activity_id returns 409 CONFLICT
 * - POST /sessions missing garmin_activity_id returns 422 VALIDATION_ERROR
 * - PATCH /sessions/:id writes only UPDATABLE fields; unknown fields return 422
 * - PATCH /sessions/:id for unknown ID returns 404 NOT_FOUND
 * - GET /sessions/:id/stream returns time-series points array
 * - GET /sessions/:id/stream?resolution=10 returns every 10th point
 * - GET /sessions/:id/stream for session with no stream returns empty points array
 * - GET /sessions/planned returns all planned sessions ordered by scheduled_date
 * - GET /sessions/planned?status=scheduled returns only scheduled sessions
 * - POST /sessions/planned creates and returns planned session (201)
 */

import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { getAthleteId } from '../db/sync.js';
import {
  getCompletedSessions,
  getCompletedSessionById,
  createCompletedSession,
  updateCompletedSession,
  getWorkoutStream,
  insertWorkoutStream,
  getSessionScore,
  getPlannedSessions,
  getPlannedSessionById,
  createPlannedSession
} from '../db/sessions.js';

const router = Router();

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const completedSessionCreateSchema = z.object({
  planned_session_id:      z.string().uuid().optional(),
  session_type_id:         z.string().uuid().optional(),
  activity_date:           z.string().date(),
  start_time:              z.string().datetime({ offset: true }),
  end_time:                z.string().datetime({ offset: true }).optional(),
  sport:                   z.enum(['cycling', 'running', 'swimming', 'mtb', 'brick', 'strength', 'other']),
  garmin_activity_id:      z.string().min(1),
  strava_activity_id:      z.string().optional(),
  tp_workout_id:           z.string().optional(),
  data_source_primary:     z.enum(['garmin', 'trainingpeaks', 'strava', 'manual']).optional(),
  duration_sec:            z.number().int().positive(),
  distance_m:              z.number().nonnegative().optional(),
  elevation_gain_m:        z.number().nonnegative().optional(),
  avg_power_w:             z.number().int().nonnegative().optional(),
  normalized_power_w:      z.number().int().nonnegative().optional(),
  avg_hr:                  z.number().int().positive().optional(),
  max_hr:                  z.number().int().positive().optional(),
  avg_cadence:             z.number().int().nonnegative().optional(),
  avg_speed_ms:            z.number().nonnegative().optional(),
  variability_index:       z.number().optional(),
  intensity_factor_garmin: z.number().optional(),
  tss:                     z.number().nonnegative().optional(),
  intensity_factor_tp:     z.number().optional(),
  ef_trainingpeaks:        z.number().optional(),
  ctl_at_completion:       z.number().optional(),
  atl_at_completion:       z.number().optional(),
  tsb_at_completion:       z.number().optional(),
  compliance_score_tp:     z.number().optional(),
  vi_tp:                   z.number().optional(),
  ef_garmin_calculated:    z.number().optional(),
  ef_source_used:          z.enum(['garmin', 'trainingpeaks']).optional(),
  ef_source_reason:        z.string().optional(),
  zone_distribution:       z.record(z.number()).optional(),
  decoupling_pct:          z.number().optional(),
  aerobic_ef:              z.number().optional(),
  strava_suffer_score:     z.number().int().optional(),
  strava_relative_effort:  z.number().optional(),
  segment_prs:             z.array(z.unknown()).optional(),
  rpe_actual:              z.number().min(1).max(10).optional(),
  session_notes:           z.string().optional(),
  goal_achieved:           z.boolean().optional(),
  goal_deviation_notes:    z.string().optional(),
  planned_duration_min:    z.number().int().positive().optional(),
  actual_vs_planned_pct:   z.number().optional()
}).strict();

// Only the fields the ingestion service may send in a PATCH
const completedSessionPatchSchema = z.object({
  tss:                     z.number().nonnegative().optional(),
  intensity_factor_tp:     z.number().optional(),
  ef_trainingpeaks:        z.number().optional(),
  ctl_at_completion:       z.number().optional(),
  atl_at_completion:       z.number().optional(),
  tsb_at_completion:       z.number().optional(),
  compliance_score_tp:     z.number().optional(),
  vi_tp:                   z.number().optional(),
  strava_activity_id:      z.string().optional(),
  strava_suffer_score:     z.number().int().optional(),
  strava_relative_effort:  z.number().optional(),
  segment_prs:             z.array(z.unknown()).optional(),
  ef_garmin_calculated:    z.number().optional(),
  ef_source_used:          z.enum(['garmin', 'trainingpeaks']).optional(),
  ef_source_reason:        z.string().optional(),
  zone_distribution:       z.record(z.number()).optional(),
  decoupling_pct:          z.number().optional(),
  aerobic_ef:              z.number().optional(),
  rpe_actual:              z.number().min(1).max(10).optional(),
  session_notes:           z.string().optional(),
  goal_achieved:           z.boolean().optional(),
  goal_deviation_notes:    z.string().optional(),
  actual_vs_planned_pct:   z.number().optional(),
  planned_duration_min:    z.number().int().positive().optional(),
  planned_session_id:      z.string().uuid().optional(),
  session_type_id:         z.string().uuid().optional()
}).strict();

const plannedSessionCreateSchema = z.object({
  week_id:               z.string().uuid().optional(),
  session_type_id:       z.string().uuid().optional(),
  scheduled_date:        z.string().date(),
  sport:                 z.enum(['cycling', 'running', 'swimming', 'mtb', 'brick', 'strength', 'other']),
  title:                 z.string().min(1),
  description:           z.string().optional(),
  goal:                  z.string().optional(),
  block_objective_link:  z.string().optional(),
  target_zone:           z.string().optional(),
  target_duration_min:   z.number().int().positive().optional(),
  target_tss:            z.number().nonnegative().optional(),
  target_score:          z.number().optional(),
  target_metric:         z.string().optional(),
  target_metric_value:   z.number().optional(),
  intensity_dist_target: z.record(z.number()).optional(),
  tp_workout_id:         z.string().optional(),
  status:                z.enum(['scheduled', 'completed', 'skipped', 'partial', 'moved']).optional(),
  priority:              z.enum(['anchor', 'normal', 'optional']).optional(),
  created_by:            z.enum(['coach', 'athlete', 'system']).optional()
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

function clampLimit(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 20;
  return Math.min(n, 100);
}

// ---------------------------------------------------------------------------
// IMPORTANT: /sessions/planned must be declared before /sessions/:id
// to prevent Express matching "planned" as an :id parameter.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GET /sessions/planned
// ---------------------------------------------------------------------------

router.get('/sessions/planned', async (req, res, next) => {
  try {
    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const sessions = await getPlannedSessions(pool, athleteId, {
      from:   req.query.from,
      to:     req.query.to,
      status: req.query.status
    });

    res.json({ data: sessions });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /sessions/planned
// ---------------------------------------------------------------------------

router.post('/sessions/planned', async (req, res, next) => {
  try {
    const parsed = plannedSessionCreateSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues[0]);

    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const session = await createPlannedSession(pool, athleteId, parsed.data);
    res.status(201).json(session);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /sessions
// ---------------------------------------------------------------------------

router.get('/sessions', async (req, res, next) => {
  try {
    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = clampLimit(req.query.limit);

    const rows = await getCompletedSessions(pool, athleteId, {
      sport: req.query.sport,
      from:  req.query.from,
      to:    req.query.to,
      page,
      limit
    });

    const total = rows.length > 0 ? parseInt(rows[0].total_count, 10) : 0;

    res.json({
      data: rows.map(r => ({
        id:            r.id,
        activity_date: r.activity_date,
        sport:         r.sport,
        title:         r.title,
        duration_sec:  r.duration_sec,
        distance_m:    r.distance_m,
        avg_power_w:   r.avg_power_w,
        avg_hr:        r.avg_hr,
        tss:           r.tss !== null ? Number(r.tss) : null,
        garmin_activity_id: r.garmin_activity_id
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /sessions/:id
// ---------------------------------------------------------------------------

router.get('/sessions/:id', async (req, res, next) => {
  try {
    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const session = await getCompletedSessionById(pool, athleteId, req.params.id);
    if (!session) return notFound(res, 'Session not found');

    // Fetch linked score and planned session in parallel
    const [score, planned] = await Promise.all([
      getSessionScore(pool, session.id),
      session.planned_session_id
        ? getPlannedSessionById(pool, athleteId, session.planned_session_id)
        : Promise.resolve(null)
    ]);

    res.json({
      id:                      session.id,
      activity_date:           session.activity_date,
      sport:                   session.sport,
      title:                   session.title,
      garmin_activity_id:      session.garmin_activity_id,
      strava_activity_id:      session.strava_activity_id,
      tp_workout_id:           session.tp_workout_id,
      data_source_primary:     session.data_source_primary,
      duration_sec:            session.duration_sec,
      distance_m:              session.distance_m,
      elevation_gain_m:        session.elevation_gain_m,
      avg_power_w:             session.avg_power_w,
      normalized_power_w:      session.normalized_power_w,
      avg_hr:                  session.avg_hr,
      max_hr:                  session.max_hr,
      avg_cadence:             session.avg_cadence,
      avg_speed_ms:            session.avg_speed_ms !== null ? Number(session.avg_speed_ms) : null,
      tss:                     session.tss          !== null ? Number(session.tss)          : null,
      intensity_factor_tp:     session.intensity_factor_tp     !== null ? Number(session.intensity_factor_tp)    : null,
      ef_garmin_calculated:    session.ef_garmin_calculated    !== null ? Number(session.ef_garmin_calculated)   : null,
      ef_trainingpeaks:        session.ef_trainingpeaks        !== null ? Number(session.ef_trainingpeaks)       : null,
      ef_source_used:          session.ef_source_used,
      decoupling_pct:          session.decoupling_pct          !== null ? Number(session.decoupling_pct)        : null,
      zone_distribution:       session.zone_distribution ?? null,
      rpe_actual:              session.rpe_actual,
      goal_achieved:           session.goal_achieved,
      session_notes:           session.session_notes,
      score: score ? {
        tss:           score.tss           !== null ? Number(score.tss)           : null,
        friel_score:   score.friel_score   !== null ? Number(score.friel_score)   : null,
        daniels_points: score.daniels_points !== null ? Number(score.daniels_points) : null
      } : null,
      planned_session: planned ? {
        id:                  planned.id,
        title:               planned.title,
        target_zone:         planned.target_zone,
        target_duration_min: planned.target_duration_min
      } : null
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /sessions
// ---------------------------------------------------------------------------

router.post('/sessions', async (req, res, next) => {
  try {
    const parsed = completedSessionCreateSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues[0]);

    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const session = await createCompletedSession(pool, athleteId, parsed.data);
    res.status(201).json(session);
  } catch (err) {
    // PostgreSQL unique violation on garmin_activity_id
    if (err.code === '23505') {
      return res.status(409).json({
        error: {
          code:    'CONFLICT',
          message: 'A session with this garmin_activity_id already exists',
          field:   'garmin_activity_id'
        }
      });
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /sessions/:id
// ---------------------------------------------------------------------------

router.patch('/sessions/:id', async (req, res, next) => {
  try {
    const parsed = completedSessionPatchSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues[0]);

    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const session = await updateCompletedSession(pool, athleteId, req.params.id, parsed.data);
    if (!session) return notFound(res, 'Session not found');

    res.json(session);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /sessions/:id/stream
// ---------------------------------------------------------------------------

router.get('/sessions/:id/stream', async (req, res, next) => {
  try {
    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const session = await getCompletedSessionById(pool, athleteId, req.params.id);
    if (!session) return notFound(res, 'Session not found');

    const resolution = Math.max(1, parseInt(req.query.resolution, 10) || 1);
    const points = await getWorkoutStream(pool, session.garmin_activity_id, resolution);

    res.json({
      garmin_activity_id: session.garmin_activity_id,
      points
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /sessions/:id/stream
// ---------------------------------------------------------------------------
// Bulk-inserts workout_stream rows for a completed session.
// Body: { rows: [{ time, power_w, hr_bpm, cadence_rpm, speed_ms,
//                  elevation_m, latitude, longitude, distance_m }] }
// Returns: { inserted: N }

const streamRowSchema = z.object({
  time:          z.string().datetime({ offset: true }),
  power_w:       z.number().nullable().optional(),
  hr_bpm:        z.number().int().nullable().optional(),
  cadence_rpm:   z.number().nullable().optional(),
  speed_ms:      z.number().nullable().optional(),
  elevation_m:   z.number().nullable().optional(),
  latitude:      z.number().nullable().optional(),
  longitude:     z.number().nullable().optional(),
  distance_m:    z.number().nullable().optional(),
  temperature_c: z.number().nullable().optional(),
});

const streamBodySchema = z.object({
  rows: z.array(streamRowSchema).min(1),
});

router.post('/sessions/:id/stream', async (req, res, next) => {
  try {
    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const session = await getCompletedSessionById(pool, athleteId, req.params.id);
    if (!session) return notFound(res, 'Session not found');

    const parsed = streamBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } });
    }

    const inserted = await insertWorkoutStream(
      pool,
      athleteId,
      session.garmin_activity_id,
      parsed.data.rows
    );

    res.status(201).json({ inserted });
  } catch (err) { next(err); }
});

export default router;

/**
 * Group: Athlete
 * Endpoints: GET /athlete, PATCH /athlete
 *
 * Manual verification:
 * - GET /athlete returns full profile with nested active_methodology object
 * - PATCH /athlete with only ftp_watts updates one field, returns full updated object
 * - PATCH /athlete with unknown field returns 422 VALIDATION_ERROR
 * - PATCH /athlete with invalid email format returns 422 VALIDATION_ERROR
 * - PATCH /athlete with no athlete row in DB returns 404 NOT_FOUND
 */

import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { getAthlete, createAthlete, updateAthlete } from '../db/athlete.js';

const router = Router();

// POST /athlete — name required, all other fields optional.
const athletePostSchema = z.object({
  name:                   z.string().min(1),
  email:                  z.string().email().optional(),
  date_of_birth:          z.string().date().optional(),
  sex:                    z.enum(['male', 'female', 'other']).optional(),
  weight_kg:              z.number().positive().optional(),
  height_cm:              z.number().positive().optional(),
  primary_sport:          z.enum(['cycling', 'triathlon', 'running', 'mtb', 'swimming']).optional(),
  active_sports:          z.array(z.string()).optional(),
  active_methodology_id:  z.string().uuid().optional(),
  ftp_watts:              z.number().int().positive().optional(),
  fthr_cycling:           z.number().int().positive().optional(),
  fthr_running:           z.number().int().positive().optional(),
  css_per_100m_sec:       z.number().positive().optional(),
  vdot:                   z.number().positive().optional(),
  max_hr:                 z.number().int().positive().optional(),
  weekly_run_volume_km:   z.number().nonnegative().optional(),
  limiter:                z.string().optional(),
  strengths:              z.string().optional(),
  known_injuries:         z.string().optional(),
  medications:            z.string().optional(),
  blood_type:             z.string().optional(),
  garmin_user_id:         z.string().optional(),
  strava_athlete_id:      z.string().optional(),
  tp_athlete_id:          z.string().optional(),
  whatsapp_number:        z.string().optional(),
  timezone:               z.string().optional()
}).strict();

// PATCH /athlete — same fields, all optional.
const athletePatchSchema = z.object({
  name:                   z.string().min(1).optional(),
  email:                  z.string().email().optional(),
  date_of_birth:          z.string().date().optional(),
  sex:                    z.enum(['male', 'female', 'other']).optional(),
  weight_kg:              z.number().positive().optional(),
  height_cm:              z.number().positive().optional(),
  primary_sport:          z.enum(['cycling', 'triathlon', 'running', 'mtb', 'swimming']).optional(),
  active_sports:          z.array(z.string()).optional(),
  active_methodology_id:  z.string().uuid().optional(),
  ftp_watts:              z.number().int().positive().optional(),
  fthr_cycling:           z.number().int().positive().optional(),
  fthr_running:           z.number().int().positive().optional(),
  css_per_100m_sec:       z.number().positive().optional(),
  vdot:                   z.number().positive().optional(),
  max_hr:                 z.number().int().positive().optional(),
  weekly_run_volume_km:   z.number().nonnegative().optional(),
  limiter:                z.string().optional(),
  strengths:              z.string().optional(),
  known_injuries:         z.string().optional(),
  medications:            z.string().optional(),
  blood_type:             z.string().optional(),
  garmin_user_id:         z.string().optional(),
  strava_athlete_id:      z.string().optional(),
  tp_athlete_id:          z.string().optional(),
  whatsapp_number:        z.string().optional(),
  timezone:               z.string().optional()
}).strict();

// Formats the raw DB row into the spec response shape.
function formatAthlete(row) {
  return {
    id:               row.id,
    name:             row.name,
    email:            row.email,
    date_of_birth:    row.date_of_birth,
    sex:              row.sex,
    primary_sport:    row.primary_sport,
    active_sports:    row.active_sports,
    active_methodology: row.active_methodology_id ? {
      id:   row.active_methodology_id,
      name: row.methodology_name
    } : null,
    ftp_watts:          row.ftp_watts,
    fthr_cycling:       row.fthr_cycling,
    fthr_running:       row.fthr_running,
    css_per_100m_sec:   row.css_per_100m_sec    !== null ? Number(row.css_per_100m_sec)  : null,
    vdot:               row.vdot                !== null ? Number(row.vdot)              : null,
    weight_kg:          row.weight_kg           !== null ? Number(row.weight_kg)         : null,
    height_cm:          row.height_cm           !== null ? Number(row.height_cm)         : null,
    max_hr:             row.max_hr,
    limiter:            row.limiter,
    strengths:          row.strengths,
    known_injuries:     row.known_injuries,
    timezone:           row.timezone,
    garmin_user_id:     row.garmin_user_id,
    strava_athlete_id:  row.strava_athlete_id,
    tp_athlete_id:      row.tp_athlete_id,
    whatsapp_number:    row.whatsapp_number
  };
}

// ---------------------------------------------------------------------------
// POST /athlete — create the athlete record (single-athlete system, one row only)
// ---------------------------------------------------------------------------

router.post('/athlete', async (req, res, next) => {
  try {
    // Reject if an athlete already exists
    const existing = await getAthlete(pool);
    if (existing) {
      return res.status(409).json({
        error: { code: 'CONFLICT', message: 'Athlete record already exists. Use PATCH /athlete to update.', field: null }
      });
    }

    const parsed = athletePostSchema.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return res.status(422).json({
        error: {
          code:    'VALIDATION_ERROR',
          message: issue.message,
          field:   issue.path.join('.') || null
        }
      });
    }

    const created = await createAthlete(pool, parsed.data);
    const full = await getAthlete(pool);
    res.status(201).json(formatAthlete(full));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /athlete
// ---------------------------------------------------------------------------

router.get('/athlete', async (req, res, next) => {
  try {
    const athlete = await getAthlete(pool);
    if (!athlete) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Athlete not found', field: null }
      });
    }
    res.json(formatAthlete(athlete));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /athlete
// ---------------------------------------------------------------------------

router.patch('/athlete', async (req, res, next) => {
  try {
    const parsed = athletePatchSchema.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return res.status(422).json({
        error: {
          code:    'VALIDATION_ERROR',
          message: issue.message,
          field:   issue.path.join('.') || null
        }
      });
    }

    const updated = await updateAthlete(pool, parsed.data);
    if (!updated) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Athlete not found', field: null }
      });
    }

    // getAthlete for the methodology join — updateAthlete RETURNING * lacks methodology_name
    const full = await getAthlete(pool);
    res.json(formatAthlete(full));
  } catch (err) {
    next(err);
  }
});

export default router;

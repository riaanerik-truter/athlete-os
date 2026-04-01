/**
 * Group: Ingestion and Sync
 * Endpoints: GET /sync/status, POST /sync/trigger, PATCH /sync/status/:source,
 *            GET /methodologies, GET /session-types
 *
 * Manual verification:
 * - GET /sync/status returns all 4 source rows with last_synced_at and sync_status
 * - GET /sync/status with no sync_state rows returns empty sources array (not 404)
 * - POST /sync/trigger with source=garmin_activities returns 202 with job_id
 * - POST /sync/trigger with source=all returns 202 with job_id
 * - POST /sync/trigger with invalid source returns 422 VALIDATION_ERROR
 * - PATCH /sync/status/:source with unknown source returns 404 NOT_FOUND
 * - PATCH /sync/status/:source with invalid sync_status value returns 422 VALIDATION_ERROR
 * - GET /methodologies returns 3 rows (Friel, Daniels VDOT, Seiler Polarised)
 * - GET /session-types with ?sport=cycling returns 22 rows
 * - GET /session-types with ?ability=aerobic_endurance returns all AE sessions across sports
 */

import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { pool } from '../db/pool.js';
import {
  getAthleteId,
  getSyncStatus,
  upsertSyncState,
  getSyncStateBySource,
  getMethodologies,
  getSessionTypes
} from '../db/sync.js';

const router = Router();

const VALID_SOURCES = ['garmin_activities', 'garmin_health', 'trainingpeaks', 'strava', 'all'];

const syncTriggerSchema = z.object({
  source: z.enum(['garmin_activities', 'garmin_health', 'trainingpeaks', 'strava', 'all'])
});

const syncStatusPatchSchema = z.object({
  last_synced_at: z.string().datetime({ offset: true }).optional(),
  last_item_id:   z.string().nullable().optional(),
  sync_status:    z.enum(['pending', 'success', 'error', 'running']).optional(),
  error_message:  z.string().nullable().optional(),
  next_sync_at:   z.string().datetime({ offset: true }).nullable().optional()
}).strict();

// ---------------------------------------------------------------------------
// GET /sync/status
// ---------------------------------------------------------------------------

router.get('/sync/status', async (req, res, next) => {
  try {
    const athleteId = await getAthleteId(pool);
    if (!athleteId) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Athlete not found', field: null }
      });
    }

    const rows = await getSyncStatus(pool, athleteId);
    res.json({ sources: rows });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /sync/trigger
// ---------------------------------------------------------------------------

router.post('/sync/trigger', async (req, res, next) => {
  try {
    const parsed = syncTriggerSchema.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return res.status(422).json({
        error: { code: 'VALIDATION_ERROR', message: issue.message, field: issue.path.join('.') || null }
      });
    }

    const { source } = parsed.data;

    // Ingestion service is not yet built — return 202 with a job_id.
    // The ingestion service will poll or be triggered via this job_id when implemented.
    res.status(202).json({
      message: 'Sync triggered',
      source,
      job_id: randomUUID()
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /sync/status/:source
// ---------------------------------------------------------------------------

router.patch('/sync/status/:source', async (req, res, next) => {
  try {
    const { source } = req.params;

    if (!VALID_SOURCES.includes(source) || source === 'all') {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: `Unknown source: ${source}`, field: null }
      });
    }

    const parsed = syncStatusPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return res.status(422).json({
        error: { code: 'VALIDATION_ERROR', message: issue.message, field: issue.path.join('.') || null }
      });
    }

    const athleteId = await getAthleteId(pool);
    if (!athleteId) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Athlete not found', field: null }
      });
    }

    // Confirm the sync_state row exists before updating
    const existing = await getSyncStateBySource(pool, athleteId, source);
    if (!existing) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: `No sync state found for source: ${source}`, field: null }
      });
    }

    const updated = await upsertSyncState(pool, athleteId, source, parsed.data);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /methodologies
// ---------------------------------------------------------------------------

router.get('/methodologies', async (req, res, next) => {
  try {
    const rows = await getMethodologies(pool);
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /session-types
// ---------------------------------------------------------------------------

router.get('/session-types', async (req, res, next) => {
  try {
    const { sport, methodology_id, ability } = req.query;

    // Validate sport if provided — rejects unknown values before hitting the DB
    const validSports = ['cycling', 'running', 'swimming', 'brick', 'strength'];
    if (sport && !validSports.includes(sport)) {
      return res.status(422).json({
        error: { code: 'VALIDATION_ERROR', message: `Invalid sport: ${sport}`, field: 'sport' }
      });
    }

    const rows = await getSessionTypes(pool, {
      sport:         sport         ?? null,
      methodologyId: methodology_id ?? null,
      ability:       ability        ?? null
    });
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

export default router;

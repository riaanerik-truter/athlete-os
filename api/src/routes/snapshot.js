/**
 * Group: Snapshot Export
 * Endpoints: POST /snapshot/generate, GET /snapshot/status
 *
 * Manual verification:
 * - POST /snapshot/generate returns 202 with job_id immediately (stub — export service not built)
 * - POST /snapshot/generate with invalid destination returns 422 VALIDATION_ERROR
 * - GET /snapshot/status returns last_generated_at, status, destination_url, file_size_kb
 * - GET /snapshot/status returns 404 when no snapshot has been generated yet
 *
 * NOTE — POST /snapshot/generate is a stub:
 * The snapshot export service has not been built yet. The route validates the request
 * and returns the correct 202 shape. Real generation will be implemented in the
 * export service layer.
 *
 * NOTE — GET /snapshot/status storage:
 * There is no dedicated snapshot status table in the schema. Status is stored in
 * sync_state with source='snapshot', written by the export service via the existing
 * PATCH /sync/status/snapshot endpoint. Field mapping:
 *   last_generated_at  ← sync_state.last_synced_at
 *   status             ← sync_state.sync_status
 *   destination_url    ← sync_state.last_item_id  (export service stores URL here)
 *   file_size_kb       ← null (not tracked in sync_state; add a dedicated column in V2)
 */

import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { pool } from '../db/pool.js';
import { getAthleteId } from '../db/sync.js';
import { getSyncStateBySource } from '../db/sync.js';

const router = Router();

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const snapshotGenerateSchema = z.object({
  destination:      z.enum(['github_pages', 'local', 's3']),
  include_sections: z.array(z.enum(['fitness', 'sessions', 'goals', 'health', 'diary'])).optional()
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

// ---------------------------------------------------------------------------
// POST /snapshot/generate  (stub — export service not yet built)
// ---------------------------------------------------------------------------

router.post('/snapshot/generate', async (req, res, next) => {
  try {
    const parsed = snapshotGenerateSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues[0]);

    const jobId = randomUUID();

    res.status(202).json({
      job_id:      jobId,
      status:      'generating',
      destination: parsed.data.destination,
      message:     'Snapshot generation started'
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /snapshot/status
// ---------------------------------------------------------------------------

router.get('/snapshot/status', async (req, res, next) => {
  try {
    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    // Read from sync_state where source='snapshot'.
    // The export service writes this row via PATCH /sync/status/snapshot
    // after each successful generation run.
    const row = await getSyncStateBySource(pool, athleteId, 'snapshot');
    if (!row) return notFound(res, 'No snapshot has been generated yet');

    res.json({
      last_generated_at: row.last_synced_at,
      status:            row.sync_status,
      destination_url:   row.last_item_id ?? null,  // export service stores URL in last_item_id
      file_size_kb:      null                        // not tracked in sync_state; V2 addition
    });
  } catch (err) { next(err); }
});

export default router;

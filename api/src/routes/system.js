/**
 * Group: System
 * Endpoints: GET /health, GET /config
 *
 * Manual verification:
 * - GET /health returns 200 with status, version, database, extensions, timestamp — no API key needed
 * - GET /health with DB down returns status: "degraded", database: "disconnected" — still 200
 * - GET /config returns athlete_id, methodology, connected_sources, last_sync — requires API key
 * - GET /config with no sync_state rows returns empty connected_sources and null last_sync values
 */

import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireApiKey } from '../middleware/auth.js';
import { getAthlete, updateAthlete } from '../db/athlete.js';
import { getSyncStatus } from '../db/sync.js';

const router = Router();

// ---------------------------------------------------------------------------
// GET /health — no auth
// ---------------------------------------------------------------------------

router.get('/health', async (req, res, next) => {
  try {
    let dbStatus = 'disconnected';
    let extensions = {};

    try {
      const result = await pool.query(`
        SELECT
          (SELECT extversion FROM pg_extension WHERE extname = 'timescaledb') AS timescaledb,
          (SELECT extversion FROM pg_extension WHERE extname = 'vector')      AS pgvector
      `);
      dbStatus = 'connected';
      extensions = {
        timescaledb: result.rows[0].timescaledb ?? 'not installed',
        pgvector:    result.rows[0].pgvector    ?? 'not installed'
      };
    } catch (_) {
      // DB unreachable — return degraded status, not 500
    }

    res.json({
      status:    dbStatus === 'connected' ? 'ok' : 'degraded',
      version:   '1.0.0',
      database:  dbStatus,
      extensions,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /config — requires auth
// ---------------------------------------------------------------------------

router.get('/config', requireApiKey, async (req, res, next) => {
  try {
    const athlete = await getAthlete(pool);
    if (!athlete) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Athlete not found', field: null }
      });
    }

    const syncRows = await getSyncStatus(pool, athlete.id);

    // Build last_sync map keyed by source name
    const last_sync = {};
    for (const row of syncRows) {
      last_sync[row.source] = row.last_synced_at ?? null;
    }

    // connected_sources: deduplicate garmin_activities / garmin_health → 'garmin'
    const sourceSet = new Set();
    for (const row of syncRows) {
      if (row.source.startsWith('garmin')) sourceSet.add('garmin');
      else sourceSet.add(row.source);
    }

    res.json({
      athlete_id:         athlete.id,
      active_methodology: athlete.methodology_name ?? null,
      connected_sources:  [...sourceSet],
      last_sync
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /config — update athlete-level settings fields
// Service-level settings (engine_mode, context_mode, proactive_scale) are
// stored client-side in localStorage; only DB-backed fields accepted here.
// ---------------------------------------------------------------------------

const configPatchSchema = z.object({
  timezone:        z.string().optional(),
  whatsapp_number: z.string().optional(),
}).strict();

router.patch('/config', requireApiKey, async (req, res, next) => {
  try {
    const parsed = configPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return res.status(422).json({
        error: { code: 'VALIDATION_ERROR', message: issue.message, field: issue.path.join('.') || null }
      });
    }

    const update = parsed.data;
    const keys   = Object.keys(update);

    if (keys.length === 0) {
      return res.json({ updated: [] });
    }

    const updated = await updateAthlete(pool, update);
    if (!updated) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Athlete not found', field: null }
      });
    }

    res.json({ updated: keys });
  } catch (err) {
    next(err);
  }
});

export default router;

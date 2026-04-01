/**
 * Group: Zone Model
 * Endpoints: GET /zones, POST /zones/recalculate
 *
 * Manual verification:
 * - GET /zones returns an object keyed by sport (cycling, running, swimming)
 * - GET /zones returns only sports with an active zone model — omits sports with no row
 * - POST /zones/recalculate with sport=cycling finds latest FTP test, computes 7 power zones, stores them
 * - POST /zones/recalculate with no field test for that sport returns 404 NOT_FOUND
 * - POST /zones/recalculate with invalid sport returns 422 VALIDATION_ERROR
 * - After recalculate, GET /zones returns updated anchor_value for that sport
 */

import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { getActiveZones, replaceZoneModel, updateAthlete } from '../db/athlete.js';
import { getFieldTests, markZonesUpdated } from '../db/fitness.js';
import { getAthleteId } from '../db/sync.js';

const router = Router();

const recalculateSchema = z.object({
  sport: z.enum(['cycling', 'running', 'swimming'])
});

// ---------------------------------------------------------------------------
// Zone calculators
// Each returns a { anchor_metric, anchor_value, zones, pace_zones? } object
// ready for replaceZoneModel.
//
// Cycling: Coggan 7-zone power model anchored to FTP (CLAUDE.md)
// Running: Daniels VDOT — pace zones require a lookup table; stored with anchor only for now
// Swimming: CSS-based pace zones (sec/100m)
// ---------------------------------------------------------------------------

function buildCyclingZones(ftpWatts) {
  const f = ftpWatts;
  return {
    anchor_metric: 'ftp_watts',
    anchor_value:  f,
    zones: [
      { zone: 'Z1',  label: 'Recovery',         min_pct: 0,   max_pct: 55,   min_value: 0,                      max_value: Math.floor(f * 0.55), unit: 'watts' },
      { zone: 'Z2',  label: 'Aerobic endurance', min_pct: 56,  max_pct: 75,   min_value: Math.ceil(f * 0.56),    max_value: Math.floor(f * 0.75), unit: 'watts' },
      { zone: 'Z3',  label: 'Tempo',             min_pct: 76,  max_pct: 90,   min_value: Math.ceil(f * 0.76),    max_value: Math.floor(f * 0.90), unit: 'watts' },
      { zone: 'Z4',  label: 'Sub-threshold',     min_pct: 91,  max_pct: 105,  min_value: Math.ceil(f * 0.91),    max_value: Math.floor(f * 1.05), unit: 'watts' },
      { zone: 'Z5a', label: 'Threshold',         min_pct: 106, max_pct: 120,  min_value: Math.ceil(f * 1.06),    max_value: Math.floor(f * 1.20), unit: 'watts' },
      { zone: 'Z5b', label: 'Aerobic capacity',  min_pct: 121, max_pct: 150,  min_value: Math.ceil(f * 1.21),    max_value: Math.floor(f * 1.50), unit: 'watts' },
      { zone: 'Z5c', label: 'Sprint',            min_pct: 151, max_pct: null, min_value: Math.ceil(f * 1.51),    max_value: null,                  unit: 'watts' }
    ]
  };
}

function buildRunningZones(vdot) {
  // Daniels pace zones require a full VDOT-to-pace lookup table.
  // The coaching engine will populate precise pace values when it is built.
  // For now we store the VDOT anchor so the zone_model row exists with a valid anchor_value.
  // pace_zones is left null — the GET /zones response omits it when null.
  return {
    anchor_metric: 'vdot',
    anchor_value:  vdot,
    vdot_score:    vdot,
    zones:         [],  // computed by coaching engine
    pace_zones:    null // TODO: add Daniels VDOT lookup table in coaching engine layer
  };
}

function buildSwimmingZones(cssSec) {
  // CSS zones expressed as seconds per 100m relative to CSS anchor
  const c = cssSec;
  return {
    anchor_metric:    'css_per_100m_sec',
    anchor_value:     c,
    css_per_100m_sec: c,
    zones:            [],
    pace_zones: [
      { zone: 'Z1',  label: 'Recovery',         min_pace_sec: Math.round(c + 20), max_pace_sec: null },
      { zone: 'Z2',  label: 'Aerobic endurance', min_pace_sec: Math.round(c + 10), max_pace_sec: Math.round(c + 19) },
      { zone: 'Z3',  label: 'Tempo',             min_pace_sec: Math.round(c + 5),  max_pace_sec: Math.round(c + 9)  },
      { zone: 'Z4',  label: 'Threshold',         min_pace_sec: Math.round(c),      max_pace_sec: Math.round(c + 4)  },
      { zone: 'Z5a', label: 'Aerobic capacity',  min_pace_sec: Math.round(c - 6),  max_pace_sec: Math.round(c - 1)  },
      { zone: 'Z5b', label: 'Max',               min_pace_sec: null,               max_pace_sec: Math.round(c - 7)  }
    ]
  };
}

// ---------------------------------------------------------------------------
// GET /zones
// ---------------------------------------------------------------------------

router.get('/zones', async (req, res, next) => {
  try {
    const athleteId = await getAthleteId(pool);
    if (!athleteId) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Athlete not found', field: null }
      });
    }

    const rows = await getActiveZones(pool, athleteId);

    // Group by sport — only include sports with an active zone model
    const response = {};
    for (const row of rows) {
      const entry = {
        anchor_metric:  row.anchor_metric,
        anchor_value:   Number(row.anchor_value),
        effective_from: row.effective_from,
        zones:          row.zones ?? []
      };
      if (row.pace_zones)       entry.pace_zones       = row.pace_zones;
      if (row.css_per_100m_sec) entry.css_per_100m_sec = Number(row.css_per_100m_sec);
      if (row.vdot_score)       entry.vdot_score       = Number(row.vdot_score);
      response[row.sport] = entry;
    }

    res.json(response);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /zones/recalculate
// ---------------------------------------------------------------------------

router.post('/zones/recalculate', async (req, res, next) => {
  try {
    const parsed = recalculateSchema.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return res.status(422).json({
        error: { code: 'VALIDATION_ERROR', message: issue.message, field: issue.path.join('.') || null }
      });
    }

    const { sport } = parsed.data;
    const athleteId = await getAthleteId(pool);
    if (!athleteId) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Athlete not found', field: null }
      });
    }

    // Get latest field test for this sport that has the relevant anchor metric
    const testTypeFilter = sport === 'cycling' ? 'T1_ftp_fthr'
                         : sport === 'running' ? 'vdot_time_trial'
                         : 'css_broken_km';

    const tests = await getFieldTests(pool, athleteId, { sport, type: testTypeFilter });
    if (!tests.length) {
      return res.status(404).json({
        error: {
          code:    'NOT_FOUND',
          message: `No ${testTypeFilter} test found for sport: ${sport}`,
          field:   null
        }
      });
    }

    const latestTest = tests[0]; // already ordered DESC by test_date

    let zoneData;
    let athleteUpdate = {};

    if (sport === 'cycling') {
      const ftp = Number(latestTest.ftp_watts);
      zoneData = buildCyclingZones(ftp);
      athleteUpdate.ftp_watts = Math.round(ftp);
    } else if (sport === 'running') {
      const vdot = Number(latestTest.vdot_score);
      zoneData = buildRunningZones(vdot);
      athleteUpdate.vdot = vdot;
    } else {
      const css = Number(latestTest.css_per_100m_sec);
      zoneData = buildSwimmingZones(css);
      athleteUpdate.css_per_100m_sec = css;
    }

    // methodolgy_id from the test row (nullable — zone_model also allows null)
    const newRow = await replaceZoneModel(pool, athleteId, sport, {
      methodology_id: latestTest.methodology_id ?? null,
      ...zoneData
    });

    // Update athlete profile with new anchor value
    await updateAthlete(pool, athleteUpdate);

    // Mark the test as having triggered zone recalculation
    await markZonesUpdated(pool, latestTest.id);

    res.json({
      message:          'Zones recalculated',
      new_anchor_value: Number(newRow.anchor_value),
      effective_from:   newRow.effective_from
    });
  } catch (err) {
    next(err);
  }
});

export default router;

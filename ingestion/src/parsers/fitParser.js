/**
 * FIT file parser
 *
 * Decodes binary .fit files using fit-file-parser (cascade mode — records nested under laps).
 * Returns the same session shape as garminActivityParser.js plus a streamRows array
 * for POST /sessions/:id/stream.
 *
 * Unit notes (with speedUnit:'m/s', lengthUnit:'m' parser options):
 * - distance:        already in metres
 * - speed:           already in m/s (use enhanced_speed/enhanced_avg_speed)
 * - elevation:       already in metres (use enhanced_altitude)
 * - total_ascent:    in metres
 * - timestamps:      Date objects (or ISO strings) in UTC
 *
 * garmin_activity_id is derived from the filename (e.g. "21127767705_ACTIVITY.fit" → "21127767705").
 */

import FitParser from 'fit-file-parser';
import { readFileSync } from 'fs';
import { basename, extname } from 'path';
import { mapSport } from '../utils/sportMapper.js';
import pino from 'pino';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

/**
 * Parses a .fit file.
 *
 * @param {string} filePath - Absolute path to the .fit file
 * @returns {Promise<{ session: object|null, streamRows: object[] }>}
 *   session — completed_session payload (same shape as garminActivityParser), or null if sport skipped
 *   streamRows — array of workout_stream row payloads
 */
export async function parseFitFile(filePath) {
  const buffer = readFileSync(filePath);

  return new Promise((resolve, reject) => {
    const parser = new FitParser({
      force: true,
      speedUnit: 'm/s',
      lengthUnit: 'm',
      temperatureUnit: 'celsius',
      elapsedRecordField: true,
      mode: 'cascade',  // records nested under laps → data.activity.sessions[].laps[].records[]
    });

    parser.parse(buffer, (error, data) => {
      if (error) { reject(new Error(`fit-file-parser: ${error}`)); return; }
      try {
        resolve(extractFromFit(filePath, data));
      } catch (err) {
        reject(err);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Internal extraction
// ---------------------------------------------------------------------------

function toIso(val) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'string') return val;
  return null;
}

function extractFromFit(filePath, data) {
  const sessions = data?.activity?.sessions;
  if (!sessions?.length) {
    log.warn({ filePath }, 'fit parser: no sessions block found in file');
    return { session: null, streamRows: [] };
  }

  const sess = sessions[0]; // One session per activity .fit file

  // Sport mapping
  const sport = mapSport(sess.sport ?? '');
  if (sport === null) {
    log.info({ filePath, fitSport: sess.sport }, 'fit parser: sport skipped');
    return { session: null, streamRows: [] };
  }

  // Derive garmin_activity_id from filename
  // Garmin exports as "<id>_ACTIVITY.fit" — strip the suffix and use the numeric prefix.
  const fname = basename(filePath, extname(filePath));
  const garminActivityId = fname.replace(/_ACTIVITY$/i, '');

  // Timestamps
  const startTime = toIso(sess.start_time);
  const durationSec = sess.total_timer_time != null ? Math.round(sess.total_timer_time) : null;
  const endTime = startTime && durationSec != null
    ? new Date(new Date(startTime).getTime() + durationSec * 1000).toISOString()
    : null;
  const activityDate = startTime ? startTime.split('T')[0] : null;

  // Speed: enhanced_avg_speed is populated when avg_speed is absent
  const avgSpeedMs = sess.enhanced_avg_speed ?? sess.avg_speed ?? null;

  // Power & HR
  const avgHr = sess.avg_heart_rate ?? null;
  const avgPowerW = sess.avg_power ?? null;
  const normalizedPowerW = sess.normalized_power ?? null;

  // EF: prefer NP when available (consistent with garminActivityParser)
  const efPower = (normalizedPowerW != null && normalizedPowerW > 0) ? normalizedPowerW : avgPowerW;
  const efGarmin = efPower != null && avgHr != null && avgHr > 0
    ? Math.round((efPower / avgHr) * 10000) / 10000
    : null;

  const session = {
    garmin_activity_id:   garminActivityId,
    sport,
    activity_date:        activityDate,
    start_time:           startTime,
    end_time:             endTime,
    duration_sec:         durationSec,
    distance_m:           sess.total_distance != null ? Math.round(sess.total_distance) : null,
    avg_speed_ms:         avgSpeedMs,
    elevation_gain_m:     sess.total_ascent ?? null,
    avg_hr:               avgHr,
    max_hr:               sess.max_heart_rate ?? null,
    avg_power_w:          avgPowerW,
    normalized_power_w:   normalizedPowerW,
    avg_cadence:          sess.avg_cadence ?? null,
    tss:                  sess.training_stress_score ?? null,
    ef_garmin_calculated: efGarmin,
    ef_source_used:       efGarmin != null ? 'garmin' : null,
    data_source_primary:  'garmin',
  };

  // ---------------------------------------------------------------------------
  // Stream rows — flatten laps → records
  // ---------------------------------------------------------------------------
  const streamRows = [];
  const startMs = startTime ? new Date(startTime).getTime() : null;

  for (const lap of (sess.laps ?? [])) {
    for (const rec of (lap.records ?? [])) {
      const recTime = toIso(rec.timestamp);

      streamRows.push({
        time:         recTime,
        power_w:      rec.power       ?? null,
        hr_bpm:       rec.heart_rate  ?? null,
        cadence_rpm:  rec.cadence     ?? null,
        speed_ms:     rec.enhanced_speed  ?? rec.speed    ?? null,
        elevation_m:  rec.enhanced_altitude ?? rec.altitude ?? null,
        latitude:     rec.position_lat  ?? null,
        longitude:    rec.position_long ?? null,
        distance_m:   rec.distance     ?? null,
        temperature_c: rec.temperature  ?? null,
      });
    }
  }

  log.info(
    { filePath, sport, garminActivityId, durationSec, streamRows: streamRows.length },
    'fit parser: parsed successfully'
  );

  return { session, streamRows };
}

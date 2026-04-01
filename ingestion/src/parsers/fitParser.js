/**
 * FIT file parser — STUB
 *
 * FIT (Flexible and Interoperable Data Transfer) files contain raw sensor streams
 * (GPS, HR, power, cadence per second) that map to the workout_stream hypertable.
 *
 * This parser is deferred to Layer 3 (workout stream ingestion). Parsing FIT files
 * requires a FIT SDK decoder (e.g. @garmin/fitsdk or fit-file-parser npm packages).
 *
 * When implemented, this parser will:
 * - Decode binary FIT to record messages
 * - Map each record to a workout_stream row: { time, hr, power, cadence, speed, lat, lng, altitude }
 * - POST in batches to POST /sessions/:id/stream
 *
 * Current status: returns empty array. File watcher skips .fit files at this stage.
 */

import pino from 'pino';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

/**
 * @param {string} filePath
 * @returns {Promise<Array>}
 */
export async function parseFitFile(filePath) {
  log.debug({ filePath }, 'fit parser: stub — skipping (not yet implemented)');
  return [];
}

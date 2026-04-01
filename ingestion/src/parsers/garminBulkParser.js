import { readFile } from 'fs/promises';
import { extname } from 'path';
import { parseGarminActivity } from './garminActivityParser.js';
import pino from 'pino';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

/**
 * Parses a Garmin bulk export JSON file.
 *
 * Garmin bulk exports come in two shapes:
 * 1. summarizedActivities.json — top-level array of activity objects
 * 2. Wrapped format — { summarizedActivitiesExport: [...] }
 *
 * Returns an array of parsed activity payloads (nulls filtered out).
 *
 * @param {string} filePath - Absolute path to the JSON file
 * @returns {Promise<Array>}
 */
export async function parseGarminBulkFile(filePath) {
  if (extname(filePath).toLowerCase() !== '.json') {
    log.warn({ filePath }, 'bulk parser: not a JSON file, skipping');
    return [];
  }

  let raw;
  try {
    const text = await readFile(filePath, 'utf8');
    raw = JSON.parse(text);
  } catch (err) {
    log.error({ filePath, err: err.message }, 'bulk parser: failed to read/parse file');
    return [];
  }

  // Normalise to array.
  // Actual Garmin export shape: [ { summarizedActivitiesExport: [...] } ]
  // Also handle: { summarizedActivitiesExport: [...] }, { summarizedActivities: [...] }, plain array.
  let activities;
  if (Array.isArray(raw) && raw.length > 0 && raw[0]?.summarizedActivitiesExport) {
    activities = raw[0].summarizedActivitiesExport;
  } else if (Array.isArray(raw) && raw.length > 0 && raw[0]?.summarizedActivities) {
    activities = raw[0].summarizedActivities;
  } else if (Array.isArray(raw)) {
    activities = raw;
  } else if (Array.isArray(raw?.summarizedActivitiesExport)) {
    activities = raw.summarizedActivitiesExport;
  } else if (Array.isArray(raw?.summarizedActivities)) {
    activities = raw.summarizedActivities;
  } else {
    log.warn({ filePath }, 'bulk parser: unrecognised JSON shape, skipping');
    return [];
  }

  const parsed = [];
  for (const entry of activities) {
    try {
      const result = parseGarminActivity(entry);
      if (result !== null) parsed.push(result);
    } catch (err) {
      log.warn({ activityId: entry?.activityId, err: err.message }, 'bulk parser: skipped malformed entry');
    }
  }

  log.info({ filePath, total: activities.length, parsed: parsed.length }, 'bulk parse complete');
  return parsed;
}

import { parse } from 'csv-parse/sync';
import { readFile } from 'fs/promises';
import pino from 'pino';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// TrainingPeaks CSV column → AthleteOS field mapping
// Header names as they appear in a TP workout export CSV
const COLUMN_MAP = {
  'WorkoutId':         'tp_workout_id',
  'Date':              'date',
  'Title':             'title',
  'WorkoutType':       'workout_type',
  'TSS':               'tss',
  'IF':                'intensity_factor',
  'VI':                'variability_index',
  'EF':                'ef',
  'Duration':          'duration_hms',   // HH:MM:SS — converted below
  'Distance':          'distance_km',    // km — converted to metres below
  'Compliance':        'compliance_score',
  'PlannedDuration':   'planned_duration_hms',
  'PlannedTSS':        'planned_tss',
};

/**
 * Converts HH:MM:SS string to seconds.
 * Returns null for empty or malformed values.
 */
function hmsToSeconds(hms) {
  if (!hms || typeof hms !== 'string') return null;
  const parts = hms.trim().split(':').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

/**
 * Parses a TrainingPeaks workout CSV export.
 * Returns an array of parsed row objects.
 *
 * @param {string} filePath - Absolute path to CSV file
 * @returns {Promise<Array>}
 */
export async function parseTpCsv(filePath) {
  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (err) {
    log.error({ filePath, err: err.message }, 'tp csv: failed to read file');
    return [];
  }

  let records;
  try {
    records = parse(text, { columns: true, skip_empty_lines: true, trim: true });
  } catch (err) {
    log.error({ filePath, err: err.message }, 'tp csv: failed to parse CSV');
    return [];
  }

  const results = [];
  for (const row of records) {
    const mapped = {};
    for (const [csvCol, field] of Object.entries(COLUMN_MAP)) {
      const val = row[csvCol];
      if (val !== undefined && val !== '') {
        mapped[field] = val;
      }
    }

    if (!mapped.date) continue; // skip rows without a date

    // Type conversions
    const numericFields = ['tss', 'intensity_factor', 'variability_index', 'ef', 'compliance_score', 'planned_tss'];
    for (const f of numericFields) {
      if (mapped[f] !== undefined) mapped[f] = Number(mapped[f]) || null;
    }

    // Duration: HH:MM:SS → seconds
    if (mapped.duration_hms) {
      mapped.duration_seconds = hmsToSeconds(mapped.duration_hms);
      delete mapped.duration_hms;
    }
    if (mapped.planned_duration_hms) {
      mapped.planned_duration_seconds = hmsToSeconds(mapped.planned_duration_hms);
      delete mapped.planned_duration_hms;
    }

    // Distance: km → metres
    if (mapped.distance_km !== undefined) {
      mapped.distance_metres = mapped.distance_km !== null ? Math.round(Number(mapped.distance_km) * 1000) : null;
      delete mapped.distance_km;
    }

    results.push(mapped);
  }

  log.info({ filePath, rows: results.length }, 'tp csv parse complete');
  return results;
}

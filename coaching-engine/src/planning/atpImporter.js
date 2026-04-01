// ATP Importer
// Reads a TrainingPeaks workout summary CSV and creates the season/period/session
// structure in the Athlete OS API.
//
// Import flow:
//   1. Parse CSV rows using the ingestion service's tpCsvParser
//   2. Detect period boundaries from workout titles and intensity patterns
//   3. Create season record if none exists
//   4. Create period records from detected boundaries
//   5. Create planned_session records for all TP workouts
//   6. Return import summary (or dry-run preview)

import { createReadStream } from 'fs';
import { parse } from 'csv-parse';
import { apiClient } from '../api/client.js';
import pino from 'pino';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// ---------------------------------------------------------------------------
// Period detection keywords
// Order matters — more specific patterns first.
// ---------------------------------------------------------------------------

const PERIOD_PATTERNS = [
  { keywords: ['prep', 'preparation', 'off-season', 'offseason'], type: 'preparation' },
  { keywords: ['base 3', 'base3', 'base iii'],                    type: 'base',  sub: '3' },
  { keywords: ['base 2', 'base2', 'base ii'],                     type: 'base',  sub: '2' },
  { keywords: ['base 1', 'base1', 'base i'],                      type: 'base',  sub: '1' },
  { keywords: ['base'],                                            type: 'base' },
  { keywords: ['build 2', 'build2', 'build ii'],                  type: 'build', sub: '2' },
  { keywords: ['build 1', 'build1', 'build i'],                   type: 'build', sub: '1' },
  { keywords: ['build'],                                           type: 'build' },
  { keywords: ['peak'],                                            type: 'peak' },
  { keywords: ['race', 'event', 'a-race', 'a race'],              type: 'race' },
  { keywords: ['transition', 'recovery', 'off week'],             type: 'transition' },
];

// TP workout type → session type code mapping
const TP_TYPE_MAP = {
  // Cycling
  'rideendurance':   'AE2', 'riderecovery': 'AE1', 'ridetempo': 'Te1',
  'ridethreshold':   'ME4', 'ridevo2max':   'AC1',  'ridesprint': 'SP2',
  'ridehills':       'MF2', 'rideintervals':'ME1',
  // Running
  'runlong':         'AE2', 'runrecovery':  'AE1',  'runthreshold': 'ME4',
  'runintervals':    'AC1', 'runtempo':     'Te1',   'runhills': 'MF3',
  // Swimming
  'swimendurance':   'AE2', 'swimrecovery': 'AE1',  'swimthreshold': 'ME3',
  'swimintervals':   'AC1',
  // Strength
  'strength':        'ST1', 'gym': 'ST1',
  // Generic fallbacks
  'endurance':       'AE2', 'recovery': 'AE1', 'threshold': 'ME4',
  'intervals':       'ME1', 'tempo': 'Te1',
};

// ---------------------------------------------------------------------------
// CSV parser
// ---------------------------------------------------------------------------

/**
 * Parses a TrainingPeaks CSV export into an array of row objects.
 * TP CSV columns (typical export):
 *   Date, Title, WorkoutType, TSS, Duration, Distance, IF, Notes
 *
 * @param {string} filePath - absolute path to the CSV file
 * @returns {Promise<Array<object>>}
 */
export async function parseTpCsv(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    createReadStream(filePath)
      .pipe(parse({ columns: true, skip_empty_lines: true, trim: true }))
      .on('data', row => {
        // Normalise column names — TP exports vary slightly in casing
        const normalised = {};
        for (const [k, v] of Object.entries(row)) {
          normalised[k.toLowerCase().replace(/\s+/g, '_')] = v;
        }
        rows.push(normalised);
      })
      .on('end',   () => resolve(rows))
      .on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Period detection
// ---------------------------------------------------------------------------

/**
 * Detects period boundaries from an array of parsed TP rows.
 *
 * Strategy:
 *   1. Scan workout titles for period keywords (primary signal)
 *   2. Look for gaps > 5 days → transition periods
 *   3. Group contiguous workouts of the same period type into blocks
 *
 * Returns an array of period objects with start_date, end_date, period_type, sub_period.
 * Ambiguous transitions are flagged with needs_confirmation = true.
 *
 * @param {Array} rows - parsed CSV rows
 * @returns {{ periods: Array, ambiguous: Array }}
 */
export function detectPeriods(rows) {
  // Filter to rows with a valid date
  const dated = rows
    .filter(r => r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!dated.length) return { periods: [], ambiguous: [] };

  // Tag each row with its detected period type
  const tagged = dated.map(row => ({
    ...row,
    detected_type: detectPeriodType(row),
  }));

  // Merge contiguous rows of the same detected type into periods
  const periods  = [];
  const ambiguous = [];
  let current = null;

  for (const row of tagged) {
    const type = row.detected_type;

    if (!current || type !== current.period_type) {
      // Check for gap > 5 days from previous → insert transition
      if (current) {
        const gap = daysBetween(current.end_date, row.date);
        if (gap > 5) {
          periods.push({
            period_type:  'transition',
            sub_period:   null,
            start_date:   addDays(current.end_date, 1),
            end_date:     addDays(row.date, -1),
            workout_count: 0,
            detected:     true,
            source:       'gap'
          });
        }
        periods.push(current);
      }

      // Start a new period segment
      const pattern = PERIOD_PATTERNS.find(p =>
        p.type === type && p.sub
          ? detectSubPeriod(row) === p.sub
          : true
      );

      current = {
        period_type:   type ?? 'base',
        sub_period:    detectSubPeriod(row),
        start_date:    row.date,
        end_date:      row.date,
        workout_count: 1,
        detected:      true,
        source:        type ? 'title' : 'intensity_pattern',
        needs_confirmation: !type,
      };

      if (!type) ambiguous.push(row.date);
    } else {
      current.end_date = row.date;
      current.workout_count++;
    }
  }

  if (current) periods.push(current);

  return { periods, ambiguous };
}

function detectPeriodType(row) {
  const text = [row.title, row.workout_type ?? row.workouttype, row.notes].join(' ').toLowerCase();
  for (const pattern of PERIOD_PATTERNS) {
    if (pattern.keywords.some(k => text.includes(k))) return pattern.type;
  }
  return null; // ambiguous — will be flagged
}

function detectSubPeriod(row) {
  // Only look at the period label token before the first dash/comma.
  // E.g. "Base 1 - AE2 Long Ride" → inspect "Base 1" only, not "AE2".
  const title = (row.title ?? '').toLowerCase();
  const label = title.split(/[-,]/)[0];  // take everything before first dash
  if (/\b3\b|iii/.test(label)) return '3';
  if (/\b2\b|ii/.test(label))  return '2';
  if (/\b1\b/.test(label))     return '1';
  return null;
}

// ---------------------------------------------------------------------------
// Session type mapping
// ---------------------------------------------------------------------------

function mapSessionType(row) {
  // TP exports "WorkoutType" as one word → normalises to "workouttype" not "workout_type".
  // Check both forms so the mapper works regardless of CSV column spacing.
  const rawType = row.workout_type ?? row.workouttype ?? '';
  const type = rawType.toLowerCase().replace(/\s+/g, '');
  const title = (row.title ?? '').toLowerCase();

  // Direct workout type match
  if (TP_TYPE_MAP[type]) return TP_TYPE_MAP[type];

  // Title keyword fallback
  for (const [key, code] of Object.entries(TP_TYPE_MAP)) {
    if (title.includes(key)) return code;
  }

  return 'AE1'; // default to easy if unmapped
}

// ---------------------------------------------------------------------------
// Duration parser (HH:MM:SS or MM:SS or decimal hours)
// ---------------------------------------------------------------------------

function parseDuration(raw) {
  if (!raw || raw.trim() === '') return null;
  const str = raw.trim();

  // HH:MM:SS or MM:SS
  const colons = str.split(':');
  if (colons.length === 3) {
    const [h, m, s] = colons.map(Number);
    return (h * 3600 + m * 60 + s) || null;
  }
  if (colons.length === 2) {
    const [m, s] = colons.map(Number);
    return (m * 60 + s) || null;
  }

  // Decimal hours (e.g. "1.5")
  const hours = parseFloat(str);
  if (!isNaN(hours)) return Math.round(hours * 3600);

  return null;
}

// ---------------------------------------------------------------------------
// Main: import ATP
// ---------------------------------------------------------------------------

/**
 * Imports a TrainingPeaks ATP CSV and creates the season/period/session structure.
 *
 * @param {string} filePath   - path to the TP CSV export
 * @param {object} [options]
 * @param {boolean} [options.dryRun=true] - preview only; no API writes
 * @param {string}  [options.seasonName]  - override season name
 * @param {number}  [options.seasonYear]  - override season year
 * @returns {object} import summary
 */
export async function importAtp(filePath, { dryRun = true, seasonName, seasonYear } = {}) {
  log.info({ filePath, dryRun }, 'starting ATP import');

  // --- Parse CSV ---
  const rows = await parseTpCsv(filePath);
  log.info({ rowCount: rows.length }, 'CSV parsed');

  if (!rows.length) {
    return { success: false, error: 'CSV file is empty or has no valid rows' };
  }

  // --- Detect periods ---
  const { periods, ambiguous } = detectPeriods(rows);
  log.info({ periodCount: periods.length, ambiguous: ambiguous.length }, 'periods detected');

  // --- Derive season bounds ---
  const firstDate  = rows.find(r => r.date)?.date ?? rows[0].date;
  const lastDate   = [...rows].reverse().find(r => r.date)?.date ?? rows[rows.length - 1].date;
  const year       = seasonYear ?? parseInt(lastDate.slice(0, 4), 10);
  const name       = seasonName ?? `Season ${year}`;

  // --- Build planned sessions ---
  const plannedSessions = rows
    .filter(r => r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date))
    .map(row => {
      const durationSec = parseDuration(row.duration ?? row.planned_duration ?? '');
      const tss         = parseFloat(row.tss ?? row.planned_tss ?? '') || null;
      const sport       = detectSport(row);

      return {
        scheduled_date:      row.date,
        sport,
        title:               row.title ?? mapSessionType(row),
        description:         row.notes ?? null,
        target_duration_min: durationSec ? Math.round(durationSec / 60) : null,
        target_tss:          tss,
        tp_workout_id:       row.workout_id ?? row.id ?? null,
        session_type_code:   mapSessionType(row),
        status:              'scheduled',
        priority:            'normal',
        created_by:          'import',
      };
    });

  // --- Dry run: return preview ---
  if (dryRun) {
    return {
      dry_run:          true,
      file:             filePath,
      rows_parsed:      rows.length,
      season: {
        name,
        year,
        start_date:  firstDate,
        end_date:    lastDate,
      },
      periods_detected: periods.length,
      periods:          periods.map(p => ({
        period_type:   p.period_type,
        sub_period:    p.sub_period,
        start_date:    p.start_date,
        end_date:      p.end_date,
        workout_count: p.workout_count,
        source:        p.source,
        needs_confirmation: p.needs_confirmation ?? false,
      })),
      sessions_to_create: plannedSessions.length,
      ambiguous_periods:  ambiguous.length,
      confirmation_required: ambiguous.length > 0,
      confirmation_message:  ambiguous.length > 0
        ? `I imported your TP plan. I detected ${periods.length} periods but I'm not sure about ${ambiguous.length} workout(s). Can you confirm the period boundaries?`
        : null,
      sample_sessions: plannedSessions.slice(0, 5),
    };
  }

  // --- Live run: write to API ---
  let seasonId = null;
  let periodsCreated = 0;
  let sessionsCreated = 0;
  let sessionsFailed  = 0;

  try {
    // Create season
    const season = await apiClient.post('/season', {
      name,
      year,
      start_date:  firstDate,
      end_date:    lastDate,
      primary_goal: 'ATP import',
    });
    seasonId = season?.id ?? null;
    log.info({ seasonId }, 'season created');

    // Create periods
    for (const p of periods) {
      if (!p.start_date || !p.end_date) continue;
      try {
        await apiClient.post('/periods', {
          season_id:           seasonId,
          name:                `${p.period_type}${p.sub_period ? ` ${p.sub_period}` : ''}`.replace(/^\w/, c => c.toUpperCase()),
          period_type:         p.period_type,
          sub_period:          p.sub_period,
          start_date:          p.start_date,
          end_date:            p.end_date,
          planned_weekly_hrs:  null,
        });
        periodsCreated++;
      } catch (err) {
        log.error({ period: p, err: err.message }, 'failed to create period');
      }
    }

    // Create planned sessions
    for (const sess of plannedSessions) {
      try {
        await apiClient.post('/sessions/planned', sess);
        sessionsCreated++;
      } catch (err) {
        log.error({ date: sess.scheduled_date, err: err.message }, 'failed to create session');
        sessionsFailed++;
      }
    }
  } catch (err) {
    log.error({ err: err.message }, 'ATP import failed');
    return { success: false, error: err.message };
  }

  return {
    dry_run:          false,
    success:          true,
    season_id:        seasonId,
    periods_created:  periodsCreated,
    sessions_created: sessionsCreated,
    sessions_failed:  sessionsFailed,
    ambiguous_periods: ambiguous.length,
    confirmation_message: ambiguous.length > 0
      ? `I imported your TP plan. I detected ${periods.length} periods but I'm not sure about ${ambiguous.length} workout(s). Can you confirm the period boundaries?`
      : null,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectSport(row) {
  const text = [row.workout_type ?? row.workouttype, row.title, row.notes].join(' ').toLowerCase();
  if (text.includes('swim')) return 'swimming';
  if (text.includes('run') || text.includes('walk')) return 'running';
  if (text.includes('strength') || text.includes('gym')) return 'strength';
  return 'cycling'; // default
}

function daysBetween(a, b) {
  return Math.round(
    (new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000
  );
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

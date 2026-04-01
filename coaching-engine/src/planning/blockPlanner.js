// Block Planner
// Generates a full training block (3–4 weeks) from a period definition.
// Writes planned_session records to the API via POST /sessions/planned.
//
// Build order within a block:
//   1. Read period from API (GET /periods/current or by ID)
//   2. Apply PERIOD_RULES for the period type
//   3. Calculate per-week volume using LOAD_PROGRESSION multipliers
//   4. For each week: select session types → assign to days → scale durations
//   5. POST each planned_session; return block summary

import { apiClient } from '../api/client.js';
import pino from 'pino';
import {
  PERIOD_RULES,
  LOAD_PROGRESSION,
  DAY_RULES,
  weekMultiplier,
  isRecoveryWeek,
  getSessionTypes,
} from './ruleEngine.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// ---------------------------------------------------------------------------
// Session duration templates (minutes) per session type
// These are baseline durations at ×1.0 multiplier.
// The block planner scales these to hit the weekly volume target.
// ---------------------------------------------------------------------------

const SESSION_DURATION_MINS = {
  // Easy / recovery
  AE1: 45,
  // Aerobic endurance / long ride
  AE2: 90,
  // Force work
  MF1: 60, MF2: 60, MF3: 50,
  // Speed skill
  SS1: 30, SS2: 30,
  // Muscular endurance
  ME1: 75, ME2: 75, ME3: 60, ME4: 70,
  // Anaerobic capacity
  AC1: 60, AC2: 60, AC3: 55,
  // Sprint power
  SP1: 45, SP2: 50,
  // Strength / gym (not counted in volume)
  ST1: 60,
};

// ---------------------------------------------------------------------------
// Session intensity classification (for easy:hard ratio enforcement)
// ---------------------------------------------------------------------------

const HARD_SESSION_TYPES = new Set([
  'MF1','MF2','MF3','ME1','ME2','ME3','ME4',
  'AC1','AC2','AC3','SP1','SP2',
  'T1','T2','T3','T4','T5',
  'I-session','R-session',
]);

function isHardSession(type) {
  return HARD_SESSION_TYPES.has(type);
}

// ---------------------------------------------------------------------------
// Week template builder
// ---------------------------------------------------------------------------

/**
 * Selects and orders sessions for a single week.
 * Returns an array of { sessionType, durationMins, isHard } in day order.
 *
 * Rules applied:
 * - Recovery weeks: only AE1 sessions, reduced count
 * - Anchor session (AE2 long ride/run) placed on Saturday or Sunday
 * - Hard sessions separated by at least 1 easy day
 * - No more than 2 hard sessions per week (easy:hard ratio)
 *
 * @param {object} periodRules - PERIOD_RULES[periodType]
 * @param {number} weekIndex   - 0-based position in period
 * @param {string|null} limiter
 * @param {string} periodType
 * @returns {Array<{day: number, sessionType: string, durationMins: number, isHard: boolean}>}
 */
function buildWeekTemplate(periodRules, weekIndex, limiter, periodType) {
  const recovery = isRecoveryWeek(weekIndex);

  if (recovery) {
    // Recovery week: 3 easy sessions on Mon/Wed/Fri, no anchor, no hard
    return [
      { day: 0, sessionType: 'AE1', durationMins: SESSION_DURATION_MINS.AE1, isHard: false },
      { day: 2, sessionType: 'AE1', durationMins: SESSION_DURATION_MINS.AE1, isHard: false },
      { day: 4, sessionType: 'AE1', durationMins: SESSION_DURATION_MINS.AE1, isHard: false },
    ];
  }

  const availableTypes = getSessionTypes(periodType, limiter);
  const hard   = availableTypes.filter(t => isHardSession(t));
  const easy   = availableTypes.filter(t => !isHardSession(t) && t !== 'AE2');
  const anchor = availableTypes.includes('AE2') ? 'AE2' : null;

  // Parse easy:hard ratio (e.g. '4:3' → 4 easy, 3 hard)
  const [easyCount, hardCount] = (periodRules.weekly_easy_hard ?? '4:3')
    .split(':').map(Number);

  const sessions = [];

  // Saturday (day 5, 0-indexed from Monday): anchor long session
  if (anchor) {
    sessions.push({ day: 5, sessionType: 'AE2', durationMins: SESSION_DURATION_MINS.AE2, isHard: false });
  }

  // Assign hard sessions — days 1 and 3 (Tue/Thu), never consecutive
  const hardSelected = hard.slice(0, Math.min(hardCount - (anchor ? 0 : 0), 2));
  const hardDays     = [1, 3]; // Tuesday, Thursday
  hardSelected.forEach((type, i) => {
    sessions.push({ day: hardDays[i], sessionType: type, durationMins: SESSION_DURATION_MINS[type] ?? 60, isHard: true });
  });

  // Fill remaining days with easy sessions
  const usedDays = new Set(sessions.map(s => s.day));
  const easyDays = [0, 2, 4].filter(d => !usedDays.has(d)); // Mon, Wed, Fri
  const easyType = easy[0] ?? 'AE1';
  easyDays.slice(0, easyCount - (anchor ? 1 : 0)).forEach(day => {
    sessions.push({ day, sessionType: easyType, durationMins: SESSION_DURATION_MINS.AE1, isHard: false });
  });

  return sessions.sort((a, b) => a.day - b.day);
}

// ---------------------------------------------------------------------------
// Volume scaling
// ---------------------------------------------------------------------------

/**
 * Scales session durations so total week volume hits the target hours.
 * Anchor sessions (AE2) and hard sessions scale proportionally.
 * Easy sessions (AE1) are capped at 60 min to avoid padding them too long.
 *
 * @param {Array} sessions   - week template from buildWeekTemplate
 * @param {number} targetHrs - target weekly volume in hours
 * @returns {Array} sessions with scaled durationMins
 */
function scaleToVolume(sessions, targetHrs) {
  const targetMins = targetHrs * 60;
  const rawTotal   = sessions.reduce((s, sess) => s + sess.durationMins, 0);
  if (rawTotal === 0) return sessions;

  const scale = targetMins / rawTotal;

  return sessions.map(sess => ({
    ...sess,
    durationMins: Math.round(
      sess.sessionType === 'AE1'
        ? Math.min(sess.durationMins * scale, 60)  // cap easy at 60 min
        : sess.durationMins * scale
    ),
  }));
}

// ---------------------------------------------------------------------------
// TSS estimation
// ---------------------------------------------------------------------------

/**
 * Rough TSS estimate per session type for planning purposes.
 * Actual TSS is calculated post-session from power/HR data.
 */
function estimateTss(sessionType, durationMins) {
  // IF (intensity factor) approximations by session type
  const IF_MAP = {
    AE1: 0.65, AE2: 0.70,
    MF1: 0.75, MF2: 0.78, MF3: 0.76,
    SS1: 0.68, SS2: 0.68,
    ME1: 0.85, ME2: 0.85, ME3: 0.82, ME4: 0.88,
    AC1: 0.95, AC2: 0.95, AC3: 0.93,
    SP1: 0.88, SP2: 0.92,
  };
  const IF  = IF_MAP[sessionType] ?? 0.70;
  const hrs = durationMins / 60;
  return Math.round(IF * IF * hrs * 100);
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Returns the Monday of the ISO week containing the given date.
 */
function weekStart(dateStr) {
  const d   = new Date(dateStr + 'T00:00:00Z');
  const dow = d.getUTCDay(); // 0=Sun, 1=Mon, ...
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Main: generate block
// ---------------------------------------------------------------------------

/**
 * Generates a full training block from a period definition and writes
 * planned_session records to the API.
 *
 * @param {object} period  - period record from GET /periods/current or /periods
 * @param {object} athlete - athlete record from GET /athlete
 * @param {object} options
 * @param {boolean} [options.dryRun=false] - if true, returns plan without writing to API
 * @returns {object} block summary
 */
export async function generateBlock(period, athlete, { dryRun = false } = {}) {
  const periodType  = period.period_type;
  const rules       = PERIOD_RULES[periodType];
  const limiter     = athlete.limiter ?? null;
  const baseHrs     = period.planned_weekly_hrs ?? 8;

  if (!rules) {
    throw new Error(`Unknown period type: ${periodType}`);
  }

  log.info({ periodType, baseHrs, dryRun }, 'generating block');

  // Determine how many weeks are in this period
  const periodStart = period.start_date;
  const periodEnd   = period.end_date;
  const startMs     = new Date(periodStart + 'T00:00:00Z').getTime();
  const endMs       = new Date(periodEnd   + 'T00:00:00Z').getTime();
  const totalDays   = Math.round((endMs - startMs) / 86400000) + 1;
  const totalWeeks  = Math.ceil(totalDays / 7);

  const allSessions = [];
  const weekSummaries = [];

  for (let w = 0; w < totalWeeks; w++) {
    const multiplier = weekMultiplier(w);
    const targetHrs  = round2(baseHrs * multiplier);
    const wkStart    = addDays(weekStart(periodStart), w * 7);

    // Skip weeks that fall outside the period end date
    if (new Date(wkStart + 'T00:00:00Z') > new Date(periodEnd + 'T00:00:00Z')) break;

    const template = buildWeekTemplate(rules, w, limiter, periodType);
    const scaled   = scaleToVolume(template, targetHrs);

    let weekTss = 0;
    const weekSessions = [];

    for (const sess of scaled) {
      const sessionDate = addDays(wkStart, sess.day);
      // Skip if this date falls outside the period
      if (sessionDate > periodEnd) continue;

      const targetTss = estimateTss(sess.sessionType, sess.durationMins);
      weekTss += targetTss;

      const payload = {
        week_id:             null,   // week record linked by the weekly planner
        session_type_id:     null,   // resolved by session type lookup (future)
        scheduled_date:      sessionDate,
        sport:               athlete.primary_sport ?? 'cycling',
        title:               sess.sessionType,
        description:         rules.notes ?? null,
        target_zone:         isHardSession(sess.sessionType) ? 'Z4-Z5' : 'Z1-Z2',
        target_duration_min: sess.durationMins,
        target_tss:          targetTss,
        status:              'scheduled',
        priority:            isHardSession(sess.sessionType) ? 'high' : 'normal',
        created_by:          'coach',
      };

      weekSessions.push(payload);
      allSessions.push(payload);
    }

    weekSummaries.push({
      week:         w + 1,
      week_start:   wkStart,
      multiplier,
      target_hrs:   targetHrs,
      session_count: weekSessions.length,
      estimated_tss: weekTss,
      recovery:      isRecoveryWeek(w),
    });
  }

  log.info({ totalWeeks, totalSessions: allSessions.length }, 'block template ready');

  // Write to API unless dry run
  let created = 0;
  let failed  = 0;

  if (!dryRun) {
    for (const payload of allSessions) {
      try {
        await apiClient.post('/sessions/planned', payload);
        created++;
      } catch (err) {
        log.error({ date: payload.scheduled_date, type: payload.title, err: err.message }, 'failed to create session');
        failed++;
      }
    }
  }

  return {
    period_id:      period.id,
    period_type:    periodType,
    total_weeks:    totalWeeks,
    total_sessions: allSessions.length,
    sessions_created: created,
    sessions_failed:  failed,
    dry_run:        dryRun,
    weeks:          weekSummaries,
    sessions:       dryRun ? allSessions : undefined,
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

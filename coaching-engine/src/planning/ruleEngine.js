// Rule Engine
// Deterministic Friel methodology rules encoded as constants and pure functions.
// No AI involved — all decisions are computable from the athlete's period type,
// limiter, and current metrics.
//
// Sources: Friel, J. Triathlon Training Bible (4th ed.); The Cyclist's Training Bible (5th ed.)

// ---------------------------------------------------------------------------
// Period rules
// ---------------------------------------------------------------------------
// Defines the training character for each Friel period type.
// The block planner reads these to determine session selection and volume targets.

export const PERIOD_RULES = {
  preparation: {
    intensity_dist:   'general',       // no strict zone prescription
    progression:      'frequency',     // build number of sessions
    strength_phase:   'AA_MT',         // anatomical adaptation → max transition
    session_types:    ['AE1', 'AE2', 'SS1', 'SS2'],
    weekly_easy_hard: '4:3',
    cross_training_ok: true,
    notes: 'Rebuild movement patterns, restore base frequency. No intensity prescription.'
  },

  base: {
    intensity_dist:       'pure_middle',  // 70% Z1-Z2, 30% Z3-Z4, 0% Z5
    progression:          'duration',     // build session length week-on-week
    strength_phase:       'MS_to_SM',     // max strength → strength maintenance
    session_types:        ['AE1', 'AE2', 'MF1', 'MF2', 'SS1', 'SS2', 'ST1'],
    weekly_easy_hard:     '4:3',
    anchor_sessions:      ['AE2'],        // long Z2 session — must appear every week
    breakthrough_sessions:['MF2'],        // hill force — high priority
    notes: 'Aerobic foundation. Pure middle intensity. EF and decoupling are key metrics.'
  },

  build: {
    intensity_dist:   'polarised',     // 80% Z1-Z2, 0% Z3-Z4, 20% Z5
    progression:      'intensity',     // maintain duration, increase intensity
    strength_phase:   'SM',            // strength maintenance only
    session_types:    ['AE1', 'AE2', 'ME1', 'ME2', 'AC1', 'AC2', 'SP2'],
    weekly_easy_hard: '5:2',
    limiter_focus:    true,            // select hard sessions based on athlete limiter
    notes: 'Polarised intensity. No tempo/threshold — only easy and hard. Limiter focus.'
  },

  peak: {
    intensity_dist:   'polarised',
    progression:      'taper',         // reduce volume, maintain intensity
    strength_phase:   'SM',
    volume_factor:    0.7,             // 70% of Base 3 weekly volume
    session_types:    ['AE1', 'AE2', 'AC1', 'SP1'],
    weekly_easy_hard: '5:2',
    notes: 'Sharpen. Volume drops to 70% of Base 3. Intensity stays. TSB moves positive.'
  },

  race: {
    intensity_dist:   'polarised',
    progression:      'sharpen',
    strength_phase:   'none',
    volume_factor:    0.5,             // 50% of Base 3 weekly volume
    session_types:    ['AE1', 'AE2', 'AC2'],
    weekly_easy_hard: '6:1',
    notes: 'Minimal load. Keep legs sharp. Race on positive TSB.'
  },

  transition: {
    intensity_dist:   'general',
    progression:      'rest',
    strength_phase:   'none',
    volume_factor:    0.2,
    session_types:    ['AE1'],
    weekly_easy_hard: 'rest',
    notes: 'Full rest and recovery. No structured training. Duration 1–4 weeks.'
  }
};

// ---------------------------------------------------------------------------
// Load progression rules
// ---------------------------------------------------------------------------
// 3-week build + 1-week recovery cycle, repeating.
// Week multipliers are applied to the period's planned_weekly_hrs.

export const LOAD_PROGRESSION = {
  build_weeks:     3,
  recovery_weeks:  1,
  // Index 0–2 = build weeks (1.0, 1.1, 1.2), index 3 = recovery week (0.65)
  week_multipliers: [1.0, 1.1, 1.2, 0.65],
  peak_vol_vs_base3: 0.7,   // peak week volume = 70% of Base 3 peak week
  race_vol_vs_base3: 0.5,   // race week volume = 50% of Base 3 peak week
};

// ---------------------------------------------------------------------------
// Intensity distribution targets (% of total weekly duration)
// ---------------------------------------------------------------------------

export const INTENSITY_DIST = {
  pure_middle: {
    low:    0.70,   // Z1–Z2
    middle: 0.30,   // Z3–Z4
    high:   0.00,   // Z5a/b/c
    notes:  'Base period only'
  },
  polarised: {
    low:    0.80,   // Z1–Z2
    middle: 0.00,   // Z3–Z4 — deliberately zero
    high:   0.20,   // Z5a/b/c
    notes:  'Build, peak, race periods'
  },
  general: {
    low:    null,   // no prescription
    middle: null,
    high:   null,
    notes:  'Prep and transition — no zone targets'
  }
};

// ---------------------------------------------------------------------------
// Strength phase definitions (Friel)
// ---------------------------------------------------------------------------

export const STRENGTH_PHASES = {
  AA: {
    name:      'Anatomical Adaptation',
    period:    'preparation',
    intensity: '40–60% 1RM',
    reps:      '15–20',
    sets:      '2–3',
    frequency: '2–3×/week',
    goal:      'Connective tissue adaptation, movement pattern re-establishment'
  },
  MT: {
    name:      'Maximum Transition',
    period:    'preparation → base1',
    intensity: '70–80% 1RM',
    reps:      '8–12',
    sets:      '2–3',
    frequency: '2–3×/week',
    goal:      'Bridge from AA to max strength loads'
  },
  MS: {
    name:      'Maximum Strength',
    period:    'base1',
    intensity: '85–95% 1RM',
    reps:      '3–6',
    sets:      '3–5',
    frequency: '2–3×/week',
    goal:      'Peak neuromuscular strength before sport-specific endurance phase'
  },
  SM: {
    name:      'Strength Maintenance',
    period:    'base2 → peak',
    intensity: '60% / 85% 1RM alternating',
    reps:      '12 / 6 alternating',
    sets:      '2',
    frequency: '1×/week',
    goal:      'Maintain strength gains without adding fatigue'
  }
};

// ---------------------------------------------------------------------------
// Period progression gates
// ---------------------------------------------------------------------------
// Criteria that must be met before advancing to the next period.
// Checked by progressionGates.js in the final week of each period.

export const PROGRESSION_GATES = {
  base_to_build: {
    decoupling_pct_max:  5,     // long Z2 ride decoupling < 5%
    ef_trend:            'positive',  // EF improving over last 4 weeks
    weeks_minimum:       10,    // at least 10 weeks in base total
    readiness_avg_min:   60,    // average readiness > 60 in final week
    description: 'Aerobic base solid: low decoupling, improving EF, adequate base volume'
  },
  build_to_peak: {
    field_test_completed:        true,  // FTP re-test done
    limiter_sessions_completed:  4,     // at least 4 limiter-focused sessions
    tsb_trend:                   'recovering',  // TSB moving toward positive
    readiness_avg_min:           65,
    description: 'Build complete: FTP tested, limiters addressed, fatigue clearing'
  },
  peak_to_race: {
    tsb_positive:        true,   // TSB > 0
    volume_at_target:    true,   // week volume hit 0.7 × base3
    no_fatigue_flags:    true,   // no readiness < 50 in last 5 days
    description: 'Peak taper complete: fresh, sharp, and ready'
  }
};

// ---------------------------------------------------------------------------
// Revision triggers
// ---------------------------------------------------------------------------
// Thresholds that trigger the plan revision engine.

export const REVISION_TRIGGERS = {
  missed_sessions:       2,    // 2+ missed sessions in a week
  readiness_score_low:   50,   // below 50 for 3 consecutive days
  readiness_low_days:    3,    // number of consecutive low-readiness days
  decoupling_high:       7,    // decoupling > 7% on long ride (base period)
  hrv_declining_days:    4,    // HRV declining for 4+ consecutive days
  tss_deficit_pct:       25,   // actual TSS more than 25% below planned
  tss_excess_pct:        30,   // actual TSS more than 30% above planned
};

// ---------------------------------------------------------------------------
// Revision actions (ordered by severity)
// ---------------------------------------------------------------------------

export const REVISION_ACTIONS = {
  // Minor — engine acts autonomously, notifies athlete
  swap_session:     { severity: 'minor',    autonomous: true,  description: 'Replace hard session with easy session' },
  reduce_duration:  { severity: 'minor',    autonomous: true,  description: 'Shorten upcoming sessions by 15–20%' },
  move_session:     { severity: 'minor',    autonomous: true,  description: 'Shift session to different day within the week' },

  // Moderate — engine proposes, athlete confirms
  extend_recovery:   { severity: 'moderate', autonomous: false, description: 'Add extra recovery day' },
  reduce_week_load:  { severity: 'moderate', autonomous: false, description: 'Reduce entire week by 20–30%' },
  delay_progression: { severity: 'moderate', autonomous: false, description: 'Extend current period by 1 week' },

  // Major — engine flags, recommends TP update
  extend_base:          { severity: 'major', autonomous: false, description: 'Base period needs more time before build' },
  reduce_season_load:   { severity: 'major', autonomous: false, description: 'Overall plan too ambitious' },
  revise_arace_goal:    { severity: 'major', autonomous: false, description: 'Event goal may not be achievable at current trajectory' },
};

// ---------------------------------------------------------------------------
// Day assignment rules for block planning
// ---------------------------------------------------------------------------

export const DAY_RULES = {
  anchor_days:          [6, 0],   // Saturday=6, Sunday=0 — long rides go here
  min_days_between_hard: 1,       // at least 1 easy day between hard sessions
  min_days_between_gym:  2,       // gym sessions separated by 2+ days
  race_week_hard_day:    2,       // Tuesday (hard session day in race week)
};

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------

/**
 * Given a week index within a period (0-based), returns the volume multiplier.
 * Cycles through the 3-build + 1-recovery pattern indefinitely.
 *
 * @param {number} weekIndex - 0-based week number within the period
 * @returns {number} multiplier to apply to planned_weekly_hrs
 */
export function weekMultiplier(weekIndex) {
  const cyclePos = weekIndex % (LOAD_PROGRESSION.build_weeks + LOAD_PROGRESSION.recovery_weeks);
  return LOAD_PROGRESSION.week_multipliers[cyclePos];
}

/**
 * Returns true if the given week index is a recovery week.
 */
export function isRecoveryWeek(weekIndex) {
  const cycleLen = LOAD_PROGRESSION.build_weeks + LOAD_PROGRESSION.recovery_weeks;
  return (weekIndex % cycleLen) === LOAD_PROGRESSION.build_weeks;
}

/**
 * Returns the intensity distribution targets for a given period type.
 */
export function getIntensityDist(periodType) {
  const rules = PERIOD_RULES[periodType];
  if (!rules) return INTENSITY_DIST.general;
  return INTENSITY_DIST[rules.intensity_dist] ?? INTENSITY_DIST.general;
}

/**
 * Returns the appropriate session types for a given period type.
 * If the period is in build and a limiter is set, hard sessions are filtered
 * to limiter-relevant types only.
 *
 * @param {string} periodType
 * @param {string|null} limiter - athlete's identified limiter (e.g. 'muscular_endurance')
 */
export function getSessionTypes(periodType, limiter = null) {
  const rules = PERIOD_RULES[periodType];
  if (!rules) return [];

  // In build period with a known limiter, prioritise ME/AC sessions
  if (periodType === 'build' && limiter && rules.limiter_focus) {
    const LIMITER_SESSIONS = {
      muscular_endurance: ['AE1', 'AE2', 'ME1', 'ME2', 'ME3', 'ME4'],
      aerobic_capacity:   ['AE1', 'AE2', 'AC1', 'AC2', 'AC3'],
      speed_skill:        ['AE1', 'AE2', 'SS1', 'SS2', 'SP1'],
      sprint_power:       ['AE1', 'AE2', 'AC1', 'SP1', 'SP2'],
      force:              ['AE1', 'AE2', 'MF1', 'MF2', 'MF3'],
      anaerobic_endurance:['AE1', 'AE2', 'AC1', 'AC2', 'SP2'],
    };
    return LIMITER_SESSIONS[limiter] ?? rules.session_types;
  }

  return rules.session_types;
}

-- =============================================================
-- GROUP 2: Reference Tables
-- methodology + session_type
-- =============================================================

-- ------------------------------------------------------------
-- TABLE: methodology
-- ------------------------------------------------------------
CREATE TABLE methodology (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  version          TEXT NOT NULL,
  sport_scope      TEXT[] NOT NULL,
  description      TEXT,
  zone_count       INT NOT NULL,
  zone_model_type  TEXT NOT NULL,
  intensity_dist   JSONB,
  period_rules     JSONB,
  session_scoring  JSONB,
  load_progression JSONB,
  evidence_level   TEXT,
  source_refs      TEXT[],
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- TABLE: session_type
-- ------------------------------------------------------------
CREATE TABLE session_type (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  methodology_id       UUID REFERENCES methodology(id),
  code                 TEXT NOT NULL,
  name                 TEXT NOT NULL,
  sport                TEXT NOT NULL,
  ability_category     TEXT NOT NULL,
  period_applicability TEXT[],
  primary_zone         TEXT,
  secondary_zone       TEXT,
  intensity_metric     TEXT,
  target_duration_min  INT,
  target_duration_max  INT,
  description          TEXT,
  execution_notes      TEXT,
  injury_risk          TEXT,
  is_field_test        BOOLEAN DEFAULT false,
  created_at           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_session_type_sport       ON session_type(sport);
CREATE INDEX idx_session_type_methodology ON session_type(methodology_id);

-- =============================================================
-- SEED: methodology
-- =============================================================

WITH friel_insert AS (
  INSERT INTO methodology (
    name, version, sport_scope, description,
    zone_count, zone_model_type,
    intensity_dist, period_rules, session_scoring, load_progression,
    evidence_level, source_refs
  ) VALUES (
    'Friel',
    '2025-v1',
    ARRAY['cycling', 'triathlon', 'mtb'],
    'Joe Friel periodisation model. 7-zone HR model anchored to FTHR, power zones anchored to FTP. Pure middle intensity in base, polarised in build and peak.',
    7,
    'hr_fthr',
    '{
      "base":  {"z1_z2_pct": 70, "z3_z4_pct": 30, "z5_pct": 0,  "model": "pure_middle"},
      "build": {"z1_z2_pct": 80, "z3_z4_pct": 0,  "z5_pct": 20, "model": "polarised"},
      "peak":  {"z1_z2_pct": 80, "z3_z4_pct": 0,  "z5_pct": 20, "model": "polarised"}
    }'::jsonb,
    '{
      "periods": [
        {"name": "Preparation", "weeks_min": 3,  "weeks_max": 6,  "emphasis": "frequency, cross-training"},
        {"name": "Base 1",      "weeks": 4,                       "emphasis": "frequency and duration", "intensity_model": "pure_middle"},
        {"name": "Base 2",      "weeks": 4,                       "emphasis": "frequency and duration", "intensity_model": "pure_middle"},
        {"name": "Base 3",      "weeks": 4,                       "emphasis": "frequency and duration", "intensity_model": "pure_middle"},
        {"name": "Build 1",     "weeks": 4,                       "emphasis": "intensity",              "intensity_model": "polarised"},
        {"name": "Build 2",     "weeks_min": 4, "weeks_max": 5,   "emphasis": "intensity",              "intensity_model": "polarised"},
        {"name": "Peak",        "days_min": 10, "days_max": 14,   "emphasis": "taper volume, hold intensity"},
        {"name": "Race",        "days_min": 5,  "days_max": 7,    "emphasis": "sharpen, 0.5x Base3 volume"},
        {"name": "Transition",  "weeks_min": 1, "weeks_max": 4,   "emphasis": "rest and recovery"}
      ]
    }'::jsonb,
    '{
      "type": "zone_x_time",
      "zone_weights": {"Z1": 1, "Z2": 2, "Z3": 3, "Z4": 4, "Z5": 5},
      "tss_also_calculated": true
    }'::jsonb,
    '{
      "weeks_build": 3,
      "weeks_recovery": 1,
      "peak_vol_factor": 0.7,
      "race_vol_factor": 0.5,
      "easy_hard_ratio": {"base": "4:3", "build": "5:2"}
    }'::jsonb,
    'evidence_based',
    ARRAY['Friel - Training Bible 2025', 'Friel - Cyclists Training Bible', 'Friel - Triathlete Training Bible']
  )
  RETURNING id
),
daniels_insert AS (
  INSERT INTO methodology (
    name, version, sport_scope, description,
    zone_count, zone_model_type,
    intensity_dist, period_rules, session_scoring, load_progression,
    evidence_level, source_refs
  ) VALUES (
    'Daniels VDOT',
    '2025-v1',
    ARRAY['running'],
    'Jack Daniels running formula. 5 pace zones (E/M/T/I/R) anchored to VDOT score. Points-per-minute session scoring. VDOT is the primary fitness anchor.',
    5,
    'vdot',
    '{
      "general": {"easy_pct": 70, "quality_pct": 30}
    }'::jsonb,
    '{
      "phases": [
        {"name": "Phase I",  "emphasis": "injury prevention, base mileage"},
        {"name": "Phase II", "emphasis": "early quality — T and R pace"},
        {"name": "Phase III","emphasis": "peak quality — I pace and race prep"},
        {"name": "Phase IV", "emphasis": "race specific, peaking"}
      ]
    }'::jsonb,
    '{
      "type": "daniels_points",
      "zone_weights": {"E": 0.2, "M": 0.4, "T": 0.6, "I": 1.0, "R": 1.5},
      "tss_also_calculated": true
    }'::jsonb,
    '{
      "weeks_build": 3,
      "weeks_recovery": 1,
      "mileage_cap_increase_pct": 10
    }'::jsonb,
    'evidence_based',
    ARRAY['Daniels - Daniels Running Formula 4th ed.']
  )
  RETURNING id
),
seiler_insert AS (
  INSERT INTO methodology (
    name, version, sport_scope, description,
    zone_count, zone_model_type,
    intensity_dist, period_rules, session_scoring, load_progression,
    evidence_level, source_refs
  ) VALUES (
    'Seiler Polarised',
    '2025-v1',
    ARRAY['cycling', 'running'],
    'Stephen Seiler polarised training model. 3-zone HR model. 80% of sessions in Z1 (low), 20% in Z3 (high). Strict avoidance of Z2 (moderate) in build phases.',
    3,
    'hr_3zone',
    '{
      "general": {"z1_pct": 80, "z2_pct": 0, "z3_pct": 20, "model": "polarised"}
    }'::jsonb,
    '{
      "note": "No traditional periodisation periods. Maintain 80/20 split year-round. Increase volume before intensity.",
      "intensity_threshold_z1_z2": "first ventilatory threshold (VT1)",
      "intensity_threshold_z2_z3": "second ventilatory threshold (VT2)"
    }'::jsonb,
    '{
      "type": "zone_x_time",
      "zone_weights": {"Z1": 1, "Z2": 2, "Z3": 3},
      "tss_also_calculated": true
    }'::jsonb,
    '{
      "weeks_build": 3,
      "weeks_recovery": 1,
      "principle": "volume before intensity"
    }'::jsonb,
    'evidence_based',
    ARRAY['Seiler - Polarised Training 2010', 'Seiler & Tønnessen 2009', 'Stöggl & Sperlich 2014']
  )
  RETURNING id
)

-- =============================================================
-- SEED: session_type
-- Uses CTEs above to capture methodology IDs
-- =============================================================

INSERT INTO session_type (
  methodology_id, code, name, sport, ability_category,
  period_applicability, primary_zone, secondary_zone,
  intensity_metric, target_duration_min, target_duration_max,
  description, injury_risk, is_field_test
)

-- -------------------------------------------------------
-- CYCLING (Friel)
-- -------------------------------------------------------
SELECT friel_insert.id, 'AE1', 'Recovery ride',           'cycling', 'aerobic_endurance',
  ARRAY['preparation','base1','base2','base3','build1','build2','peak','race'],
  'Z1', NULL, 'hr', 30, 60,
  'Easy spinning below aerobic threshold. Active recovery only.', 'low', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'AE2', 'Aerobic threshold ride',  'cycling', 'aerobic_endurance',
  ARRAY['base1','base2','base3','build1','build2'],
  'Z2', NULL, 'hr', 60, 180,
  'Primary base-building session. Steady Z2 HR, conversational pace. Foundation of aerobic fitness.', 'low', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'Te1', 'Tempo endurance ride',    'cycling', 'stamina',
  ARRAY['base2','base3','build1','build2'],
  'Z3', NULL, 'power', 45, 90,
  'Sustained effort in tempo zone. Bridges aerobic endurance and muscular endurance.', 'medium', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'MF1', 'Flat force reps',         'cycling', 'muscular_force',
  ARRAY['preparation','base1'],
  'Z3', 'Z4', 'power', 30, 60,
  'Big gear, low cadence (50–60 rpm) on flat terrain. Builds pedal force.', 'medium', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'MF2', 'Hill force reps',         'cycling', 'muscular_force',
  ARRAY['preparation','base1'],
  'Z3', 'Z4', 'power', 30, 60,
  'Big gear, low cadence (50–60 rpm) on moderate gradient. Builds leg strength.', 'medium', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'MF3', 'Hill repeats',            'cycling', 'muscular_force',
  ARRAY['base1','base2'],
  'Z4', NULL, 'power', 45, 75,
  'Repeated seated climbs on 6–8% grade. Normal cadence. Builds muscular force and lactate tolerance.', 'medium', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'SS1', 'Spin-ups',                'cycling', 'speed_skills',
  ARRAY['preparation','base1','base2','base3'],
  'Z1', 'Z2', 'technique', 30, 60,
  'Progressive cadence increases to 110+ rpm. Smooth circular pedal stroke. No grinding.', 'low', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'SS2', 'Isolated leg training',   'cycling', 'speed_skills',
  ARRAY['preparation','base1','base2','base3'],
  'Z1', NULL, 'technique', 30, 60,
  'One leg pedalling drills. Identifies and corrects dead spots in stroke.', 'low', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'ME1', 'Cruise intervals',        'cycling', 'stamina',
  ARRAY['build1','build2','peak'],
  'Z4', NULL, 'power', 60, 90,
  'Repeated Z4 efforts 8–20 min with short recovery. Classic lactate threshold work.', 'medium', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'ME2', 'Hill cruise intervals',   'cycling', 'stamina',
  ARRAY['build1','build2'],
  'Z4', NULL, 'power', 60, 90,
  'Cruise intervals performed on sustained climbs. Added muscular load.', 'medium', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'ME3', 'Crisscross intervals',    'cycling', 'stamina',
  ARRAY['build1','build2','peak'],
  'Z4', 'Z5a', 'power', 60, 90,
  'Alternating efforts crossing threshold — Z3 to Z5a and back. Raises lactate clearance.', 'medium', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'ME4', 'Threshold ride',          'cycling', 'stamina',
  ARRAY['build1','build2','peak'],
  'Z4', 'Z5a', 'power', 60, 120,
  'Extended effort at or near FTP. Raises functional threshold over time.', 'medium', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'AC1', 'VO2max intervals',        'cycling', 'aerobic_capacity',
  ARRAY['build1','build2','peak'],
  'Z5b', NULL, 'power', 45, 75,
  'Short hard efforts 3–5 min at VO2max power with equal recovery. Raises aerobic ceiling.', 'medium', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'AC2', 'Pyramid intervals',       'cycling', 'aerobic_capacity',
  ARRAY['build1','build2'],
  'Z5a', 'Z5b', 'power', 45, 75,
  'Ascending then descending effort durations through Z5. Broadens intensity tolerance.', 'medium', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'AC3', 'Hill intervals',          'cycling', 'aerobic_capacity',
  ARRAY['build1','build2','peak'],
  'Z5a', 'Z5b', 'power', 45, 75,
  'Repeated hard climbs at VO2max effort. Combines muscular load with aerobic stress.', 'medium', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'SP1', 'Form sprints',            'cycling', 'sprint_power',
  ARRAY['build1','build2'],
  'Z5c', NULL, 'power', 30, 60,
  'Short 10–15 sec all-out sprints with full recovery. Focus on technique and neuromuscular recruitment.', 'low', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'SP2', 'Competitive sprints',     'cycling', 'sprint_power',
  ARRAY['build2','peak'],
  'Z5c', NULL, 'power', 30, 60,
  'Race-simulation sprints from various speeds and positions. Peak power development.', 'high', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'T1',  'FTP / FTHR test',         'cycling', 'aerobic_endurance',
  NULL, NULL, NULL, 'power', 60, 90,
  '20-min maximal effort test. FTP = 95% of 20-min mean power. FTHR from last 20 min avg HR.', 'medium', true FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'T2',  'Aerobic capacity test',   'cycling', 'aerobic_capacity',
  NULL, NULL, NULL, 'power', 45, 75,
  'Graded exercise test or maximal 5-min effort to estimate VO2max power.', 'medium', true FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'T3',  'Stamina test',            'cycling', 'stamina',
  NULL, NULL, NULL, 'power', 90, 180,
  'Long ride at steady Z3–Z4 to assess aerobic decoupling and EF drift.', 'low', true FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'T4',  'Sprint power test',       'cycling', 'sprint_power',
  NULL, NULL, NULL, 'power', 30, 45,
  '3 × 10 sec maximal sprint with full recovery. Records peak power and fatigue index.', 'medium', true FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'T5',  'Time trial',              'cycling', 'stamina',
  NULL, NULL, NULL, 'power', 30, 60,
  'Race-effort time trial on flat or consistent course. Performance benchmark.', 'low', true FROM friel_insert

-- -------------------------------------------------------
-- RUNNING (Friel)
-- -------------------------------------------------------
UNION ALL
SELECT friel_insert.id, 'AE1', 'Recovery run',            'running', 'aerobic_endurance',
  ARRAY['preparation','base1','base2','base3','build1','build2','peak','race'],
  'Z1', NULL, 'hr', 20, 45,
  'Very easy run below aerobic threshold. Used for active recovery between harder sessions.', 'low', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'AE2', 'Aerobic endurance run',   'running', 'aerobic_endurance',
  ARRAY['base1','base2','base3','build1','build2'],
  'Z2', NULL, 'hr', 45, 120,
  'Long easy run at conversational pace. Primary aerobic base builder.', 'low', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'Te1', 'Tempo endurance run',     'running', 'stamina',
  ARRAY['base2','base3','build1','build2'],
  'Z3', NULL, 'pace', 45, 75,
  'Comfortably hard sustained effort. Bridges aerobic and threshold work.', 'medium', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'MF1', 'Force reps',              'running', 'muscular_force',
  ARRAY['preparation','base1'],
  'Z3', NULL, 'hr', 30, 60,
  'Bounding, running drills, and dynamic strength exercises. Builds running-specific leg strength.', 'medium', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'MF2', 'Hill fartlek',            'running', 'muscular_force',
  ARRAY['base1','base2'],
  'Z3', 'Z4', 'hr', 30, 60,
  'Unstructured hill efforts mixed with easy running. Builds force without full lactate stress.', 'medium', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'MF3', 'Hill repeats',            'running', 'muscular_force',
  ARRAY['base1','base2'],
  'Z4', 'Z5a', 'hr', 30, 60,
  'Structured hill repeats at hard effort. Builds leg power and running economy.', 'medium', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'SS1', 'Strides',                 'running', 'speed_skills',
  ARRAY['preparation','base1','base2','base3','build1','build2'],
  'Z5c', NULL, 'pace', 20, 30,
  '4–6 × 20 sec accelerations to near-sprint, full recovery. Maintains neuromuscular sharpness.', 'low', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'SS2', 'Pickups',                 'running', 'speed_skills',
  ARRAY['preparation','base1','base2','base3'],
  'Z2', 'Z3', 'hr', 30, 45,
  'Fartlek accelerations within an easy run. Improves running form at varied paces.', 'low', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'ME1', 'Cruise intervals',        'running', 'stamina',
  ARRAY['build1','build2','peak'],
  'Z4', NULL, 'pace', 45, 75,
  'Repeated threshold-pace efforts 5–15 min with short jog recovery. Core lactate threshold session.', 'medium', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'ME2', 'Hill cruise intervals',   'running', 'stamina',
  ARRAY['build1','build2'],
  'Z4', NULL, 'pace', 45, 60,
  'Threshold-effort cruise intervals on sustained hills. Combined strength and threshold stimulus.', 'medium', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'ME3', 'Crisscross intervals',    'running', 'stamina',
  ARRAY['build1','build2','peak'],
  'Z4', 'Z5a', 'pace', 45, 75,
  'Alternating efforts above and below threshold. Trains lactate clearance capacity.', 'medium', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'ME4', 'Threshold run',           'running', 'stamina',
  ARRAY['build1','build2','peak'],
  'Z4', 'Z5a', 'pace', 45, 90,
  'Sustained run at or near lactate threshold. Raises FTHR and running economy at threshold.', 'medium', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'AC1', 'Group run',               'running', 'aerobic_capacity',
  ARRAY['build1','build2'],
  'Z3', 'Z5a', 'hr', 60, 90,
  'Unstructured run with others. Pace naturally varies. Social stimulus and unpredictable intensity.', 'low', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'AC2', 'VO2max intervals',        'running', 'aerobic_capacity',
  ARRAY['build1','build2','peak'],
  'Z5b', NULL, 'pace', 45, 75,
  'Hard intervals 3–5 min at VO2max pace. Equal recovery. Raises aerobic ceiling.', 'medium', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'AC3', 'Hill intervals',          'running', 'aerobic_capacity',
  ARRAY['build1','build2'],
  'Z5a', 'Z5b', 'hr', 30, 60,
  'Repeated hard hill efforts. Combined strength and VO2max stimulus.', 'medium', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'T1',  'FTP pace / FTHR test',    'running', 'stamina',
  NULL, NULL, NULL, 'pace', 40, 60,
  '30-min time trial on flat course. FTHR = average HR last 20 min. FTP pace = average pace.', 'medium', true FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'T2',  'VO2max estimation run',   'running', 'aerobic_capacity',
  NULL, NULL, NULL, 'pace', 30, 45,
  'Cooper test or 6-min maximal run. Estimates VO2max from distance covered.', 'medium', true FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'T3',  'VO2max time trial',       'running', 'aerobic_capacity',
  NULL, NULL, NULL, 'pace', 20, 30,
  'All-out effort on known course. VO2max estimated from pace and HR relationship.', 'medium', true FROM friel_insert

-- -------------------------------------------------------
-- RUNNING (Daniels VDOT) — Daniels-specific sessions
-- -------------------------------------------------------
UNION ALL
SELECT daniels_insert.id, 'E-session', 'Easy / Long run',       'running', 'aerobic_endurance',
  ARRAY['phase1','phase2','phase3','phase4'],
  'E', NULL, 'pace', 30, 180,
  'Easy pace run at 59–74% VDOT. Primary aerobic development. Used for long runs and recovery days.', 'low', false FROM daniels_insert
UNION ALL
SELECT daniels_insert.id, 'M-session', 'Marathon pace run',     'running', 'stamina',
  ARRAY['phase2','phase3','phase4'],
  'M', NULL, 'pace', 60, 180,
  'Sustained run at marathon race pace (75–84% VDOT). Teaches efficient marathon effort.', 'low', false FROM daniels_insert
UNION ALL
SELECT daniels_insert.id, 'T-session', 'Threshold run',         'running', 'stamina',
  ARRAY['phase2','phase3','phase4'],
  'T', NULL, 'pace', 30, 60,
  'Comfortably hard pace at lactate threshold (~mid-80s% VDOT). Cruise intervals or tempo run.', 'medium', false FROM daniels_insert
UNION ALL
SELECT daniels_insert.id, 'I-session', 'Interval / Hard pace',  'running', 'aerobic_capacity',
  ARRAY['phase3','phase4'],
  'I', NULL, 'pace', 30, 60,
  'Repeated efforts at ~VO2max pace (~100% VDOT). 3–5 min reps, equal recovery. Core quality session.', 'medium', false FROM daniels_insert
UNION ALL
SELECT daniels_insert.id, 'R-session', 'Repetition run',        'running', 'sprint_power',
  ARRAY['phase2','phase3','phase4'],
  'R', NULL, 'pace', 20, 45,
  'Short fast reps at 105–110% VDOT. Full recovery between reps. Improves speed and running economy.', 'medium', false FROM daniels_insert
UNION ALL
SELECT daniels_insert.id, 'G-session', 'Treadmill hill run',    'running', 'muscular_force',
  ARRAY['phase1','phase2'],
  'E', 'M', 'pace', 30, 60,
  'Graded treadmill run (5–8% incline) at easy to marathon pace. Builds leg strength without speed stress.', 'low', false FROM daniels_insert

-- -------------------------------------------------------
-- SWIMMING (Friel Triathlon Bible)
-- -------------------------------------------------------
UNION ALL
SELECT friel_insert.id, 'AE1', 'Recovery swim',                        'swimming', 'aerobic_endurance',
  ARRAY['preparation','base1','base2','base3','build1','build2','peak','race'],
  'Z1', NULL, 'hr', 30, 45,
  'Easy, low-intensity swim. Active recovery. Focus on relaxed stroke mechanics.', 'low', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'AE2', 'Aerobic endurance intervals',          'swimming', 'aerobic_endurance',
  ARRAY['base1','base2','base3','build1','build2'],
  'Z2', NULL, 'pace', 45, 75,
  'Moderate volume at aerobic pace. Sets of 200–400m with short rest. Primary swim base builder.', 'low', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'Te1', 'Tempo intervals',                      'swimming', 'stamina',
  ARRAY['base2','base3','build1','build2'],
  'Z3', NULL, 'pace', 45, 60,
  'Comfortably hard sets approaching threshold pace. Builds lactate tolerance.', 'medium', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'MF1', 'Muscular force reps',                  'swimming', 'muscular_force',
  ARRAY['preparation','base1'],
  'Z3', 'Z4', 'technique', 30, 45,
  'Resisted drills (drag suits, ankle bands). Builds pull strength and catch efficiency.', 'low', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'MF2', 'Open-water current intervals',         'swimming', 'muscular_force',
  ARRAY['base1','base2'],
  'Z3', 'Z4', 'pace', 30, 60,
  'Hard efforts into current or headwind open water. Builds force production under resistance.', 'medium', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'MF3', 'Paddles',                              'swimming', 'muscular_force',
  ARRAY['base1','base2','base3'],
  'Z2', 'Z3', 'technique', 30, 60,
  'Hand paddle sets for pull strength. Enforces high elbow catch. Not used when shoulder issues present.', 'medium', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'SS1', 'Fast-form 25s',                        'swimming', 'speed_skills',
  ARRAY['preparation','base1','base2','base3','build1','build2'],
  'Z5', NULL, 'technique', 30, 45,
  '25m fast repeats focusing on stroke mechanics at speed. Full rest between reps.', 'low', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'SS2', 'Toy sets',                             'swimming', 'speed_skills',
  ARRAY['preparation','base1','base2','base3'],
  'Z1', 'Z2', 'technique', 30, 45,
  'Drill sets using fins, pull buoy, and kickboard. Develops specific stroke components.', 'low', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'ME1', 'Long cruise intervals',                'swimming', 'stamina',
  ARRAY['build1','build2','peak'],
  'Z4', NULL, 'pace', 45, 75,
  'Long threshold sets (400–800m) at CSS pace. Core lactate threshold swim session.', 'medium', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'ME2', 'Short cruise intervals',               'swimming', 'stamina',
  ARRAY['build1','build2','peak'],
  'Z4', NULL, 'pace', 45, 60,
  'Short threshold sets (100–200m) at CSS pace with minimal rest. High volume at threshold.', 'medium', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'ME3', 'Threshold swim',                       'swimming', 'stamina',
  ARRAY['build1','build2','peak'],
  'Z4', 'Z5a', 'pace', 30, 60,
  'Continuous or near-continuous swim at CSS. Tests and builds lactate threshold.', 'medium', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'AC1', 'VO2max intervals',                     'swimming', 'aerobic_capacity',
  ARRAY['build1','build2','peak'],
  'Z5b', NULL, 'pace', 30, 60,
  'Short hard repeats (50–100m) well above CSS. Raises aerobic ceiling. Full recovery.', 'medium', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'AC2', 'Aerobic capacity intervals',           'swimming', 'aerobic_capacity',
  ARRAY['build1','build2'],
  'Z5a', 'Z5b', 'pace', 30, 60,
  'Mid-length hard sets (200m) at hard effort. Bridges threshold and VO2max.', 'medium', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'T1',  'Broken kilometer',                     'swimming', 'stamina',
  NULL, NULL, NULL, 'pace', 30, 45,
  '10 × 100m all-out with 10 sec rest. Total time minus rest = benchmark performance.', 'low', true FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'T2',  'CSS functional threshold pace test',   'swimming', 'stamina',
  NULL, NULL, NULL, 'pace', 30, 45,
  '400m TT and 200m TT on separate days. CSS calculated from pace difference.', 'low', true FROM friel_insert

-- -------------------------------------------------------
-- BRICK (Friel Triathlon Bible)
-- -------------------------------------------------------
UNION ALL
SELECT friel_insert.id, 'AE1', 'Aerobic endurance brick',    'brick', 'aerobic_endurance',
  ARRAY['base1','base2','base3'],
  'Z2', NULL, 'hr', 60, 120,
  'Long Z2 bike followed immediately by easy Z1–Z2 run. Trains metabolic transition.', 'low', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'TB1', 'Tempo brick',                'brick', 'stamina',
  ARRAY['base3','build1','build2'],
  'Z3', NULL, 'hr', 60, 90,
  'Tempo bike followed by threshold-effort run. Builds ability to run hard off the bike.', 'medium', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'SS1', 'Transition 1 practice',      'brick', 'speed_skills',
  ARRAY['preparation','base1','base2','base3','build1','build2','peak'],
  'Z1', 'Z2', 'technique', 30, 60,
  'Short bike with practiced T1 into run. Focus on speed of transition and immediate running form.', 'low', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'SS2', 'Transition 2 practice',      'brick', 'speed_skills',
  ARRAY['preparation','base1','base2','base3','build1','build2','peak'],
  'Z1', 'Z2', 'technique', 30, 60,
  'Run-to-rack practice for T2. Focus on speed and logistics under fatigue.', 'low', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'ME1', 'Muscular endurance brick',   'brick', 'stamina',
  ARRAY['build1','build2','peak'],
  'Z4', NULL, 'power', 90, 150,
  'Threshold bike sets followed by threshold-effort run. Core race-specific session.', 'medium', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'ME2', 'Hilly brick',                'brick', 'muscular_force',
  ARRAY['build1','build2'],
  'Z3', 'Z4', 'power', 90, 150,
  'Hilly bike ride with Z3–Z4 climbs followed by moderate run. Combined muscular and endurance stress.', 'medium', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'AC1', 'Bike-intervals brick',       'brick', 'aerobic_capacity',
  ARRAY['build1','build2','peak'],
  'Z5a', 'Z5b', 'power', 75, 120,
  'VO2max bike intervals followed by easy run. Tests aerobic capacity under pre-fatigued legs.', 'medium', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'AC2', 'Run-intervals brick',        'brick', 'aerobic_capacity',
  ARRAY['build1','build2','peak'],
  'Z5a', NULL, 'pace', 75, 120,
  'Aerobic endurance bike followed by hard run intervals. Specificity for run-heavy triathlon legs.', 'medium', false FROM friel_insert

-- -------------------------------------------------------
-- STRENGTH (Friel — linked to strength_phase)
-- -------------------------------------------------------
UNION ALL
SELECT friel_insert.id, 'AA', 'Anatomical adaptation',   'strength', 'strength',
  ARRAY['preparation'],
  NULL, NULL, 'rpe', 45, 60,
  '40–60% 1RM, 15–20 reps, 2–3 sets, 2–3×/week. Full-body foundation. Injury prevention focus.', 'low', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'MT', 'Max transition',          'strength', 'strength',
  ARRAY['preparation','base1'],
  NULL, NULL, 'rpe', 45, 60,
  '70–80% 1RM, 8–12 reps, 2–3 sets, 2–3×/week. Bridges AA and max strength phases.', 'medium', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'MS', 'Max strength',            'strength', 'strength',
  ARRAY['base1'],
  NULL, NULL, 'rpe', 60, 75,
  '85–95% 1RM, 3–6 reps, 3–5 sets, 2–3×/week. Peak neuromuscular stimulus. Short phase only.', 'high', false FROM friel_insert
UNION ALL
SELECT friel_insert.id, 'SM', 'Strength maintenance',    'strength', 'strength',
  ARRAY['base2','base3','build1','build2','peak'],
  NULL, NULL, 'rpe', 30, 45,
  '60/85% 1RM alternating, 12/6 reps, 1 set, 1×/week. Maintains strength without fatigue accumulation.', 'low', false FROM friel_insert;

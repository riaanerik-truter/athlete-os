# Athlete OS — Storage Schema Definition
**Version:** 1.0  
**Status:** Design complete — ready for Claude Code implementation  
**Last updated:** 2026-03-27

---

## Overview

Three storage engines, one deployment.

| Engine | Technology | Purpose |
|---|---|---|
| Relational DB | PostgreSQL | Goals, plans, sessions, athletes, methodology |
| Time-series DB | TimescaleDB (PostgreSQL extension) | Workout streams, daily health metrics |
| Vector store | pgvector (PostgreSQL extension) | Knowledge base chunks, semantic search |

All three engines run in a single PostgreSQL instance. This simplifies deployment, backup, and cross-engine queries.

---

## Design Principles

- Every table has `athlete_id` as a foreign key. No athlete-agnostic data except reference tables (`methodology`, `session_type`).
- UUIDs for all primary keys. No sequential integers — required for portability and multi-athlete use.
- JSONB for variable-structure data (lab results, zone distributions, structured metadata). Indexed where queried.
- Nullable foreign keys for optional links (e.g. `strava_activity_id` on `completed_session`).
- Soft deletes (`deleted_at`) on athlete-facing records. Hard deletes only on system/log tables.
- All timestamps in UTC.

---

## Reference Tables

These tables have no `athlete_id`. They define system-wide rules.

---

### `methodology`

Pluggable training methodology definitions. One row per supported methodology.

```sql
CREATE TABLE methodology (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,               -- e.g. 'Friel', 'Daniels VDOT', 'Seiler Polarised'
  version         TEXT NOT NULL,               -- e.g. '2025-v1'
  sport_scope     TEXT[] NOT NULL,             -- e.g. ['cycling', 'running', 'triathlon']
  description     TEXT,
  zone_count      INT NOT NULL,                -- number of zones in this methodology
  zone_model_type TEXT NOT NULL,               -- 'hr_fthr' | 'power_ftp' | 'pace_ftpa' | 'css' | 'vdot'
  intensity_dist  JSONB,                       -- rules: {"base": {"z1_z2_pct": 70, "z3_z4_pct": 30},
                                               --         "build": {"z1_z2_pct": 80, "z5_pct": 20}}
  period_rules    JSONB,                       -- period names, durations, progression rules
  session_scoring JSONB,                       -- scoring formula: {"type": "zone_x_time" | "daniels_points",
                                               --                   "zone_weights": [1,2,3,4,5]}
  load_progression JSONB,                      -- e.g. {"weeks_build": 3, "weeks_recovery": 1,
                                               --       "peak_vol_factor": 0.7}
  evidence_level  TEXT,                        -- 'evidence_based' | 'practitioner_consensus' | 'anecdote'
  source_refs     TEXT[],                      -- e.g. ['Friel 2025', 'Seiler 2010']
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
```

---

### `session_type`

All known session types across all sports and methodologies. Reference table — not per-athlete.

```sql
CREATE TABLE session_type (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  methodology_id      UUID REFERENCES methodology(id),   -- null = universal
  code                TEXT NOT NULL,                     -- e.g. 'AE2', 'ST3', 'T-session', 'ME1-brick'
  name                TEXT NOT NULL,                     -- e.g. 'Aerobic threshold ride'
  sport               TEXT NOT NULL,                     -- 'cycling' | 'running' | 'swimming' | 'brick' | 'strength'
  ability_category    TEXT NOT NULL,                     -- 'aerobic_endurance' | 'muscular_force' |
                                                         -- 'speed_skills' | 'stamina' | 'aerobic_capacity' |
                                                         -- 'sprint_power' | 'strength' | 'recovery'
  period_applicability TEXT[],                           -- e.g. ['base', 'build', 'peak']
  primary_zone        TEXT,                              -- e.g. 'Z2', 'Z4', 'T', 'I'
  secondary_zone      TEXT,                              -- for combo sessions
  intensity_metric    TEXT,                              -- 'hr' | 'power' | 'pace' | 'rpe' | 'technique'
  target_duration_min INT,                               -- minimum session duration in minutes
  target_duration_max INT,                               -- maximum session duration in minutes
  description         TEXT,
  execution_notes     TEXT,                              -- key coaching cues from source material
  injury_risk         TEXT,                              -- 'low' | 'medium' | 'high'
  is_field_test       BOOLEAN DEFAULT false,
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_session_type_sport ON session_type(sport);
CREATE INDEX idx_session_type_methodology ON session_type(methodology_id);
```

---

## Athlete Tables

---

### `athlete`

Core athlete profile. One row per athlete.

```sql
CREATE TABLE athlete (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    TEXT NOT NULL,
  email                   TEXT UNIQUE NOT NULL,
  date_of_birth           DATE,
  sex                     TEXT,                          -- 'male' | 'female' | 'other'
  weight_kg               NUMERIC(5,2),
  height_cm               NUMERIC(5,1),
  primary_sport           TEXT,                          -- 'cycling' | 'triathlon' | 'running' | 'mtb'
  active_sports           TEXT[],                        -- all sports currently training
  active_methodology_id   UUID REFERENCES methodology(id),
  ftp_watts               INT,                           -- current FTP (updated after each test)
  fthr_cycling            INT,                           -- functional threshold HR cycling (bpm)
  fthr_running            INT,                           -- functional threshold HR running (bpm)
  css_per_100m_sec        NUMERIC(6,2),                  -- critical swim speed in seconds per 100m
  vdot                    NUMERIC(5,2),                  -- current VDOT score (running)
  max_hr                  INT,                           -- max HR from testing or Garmin detect
  weekly_run_volume_km    NUMERIC(6,1),                  -- used by Daniels session selection
  limiter                 TEXT,                          -- current identified limiter (free text)
  strengths               TEXT,                          -- current identified strengths (free text)
  known_injuries          TEXT,                          -- injury history relevant to training
  medications             TEXT,                          -- optional, for doctor export
  blood_type              TEXT,                          -- optional, for doctor export
  garmin_user_id          TEXT,                          -- Garmin Connect user ID
  strava_athlete_id       TEXT,                          -- Strava athlete ID
  tp_athlete_id           TEXT,                          -- TrainingPeaks athlete ID
  whatsapp_number         TEXT,                          -- for coach interface
  timezone                TEXT DEFAULT 'UTC',
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now(),
  deleted_at              TIMESTAMPTZ                    -- soft delete
);
```

---

### `zone_model`

Sport-specific zone boundaries per athlete. Recalculated after each field test or FTP update.

```sql
CREATE TABLE zone_model (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id      UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  methodology_id  UUID NOT NULL REFERENCES methodology(id),
  sport           TEXT NOT NULL,              -- 'cycling' | 'running' | 'swimming'
  anchor_metric   TEXT NOT NULL,              -- 'ftp_watts' | 'fthr_bpm' | 'css_sec' | 'vdot'
  anchor_value    NUMERIC(8,2) NOT NULL,      -- the anchor number zones are derived from
  effective_from  DATE NOT NULL,              -- date this zone model became active
  effective_to    DATE,                       -- null = currently active
  zones           JSONB NOT NULL,             -- zone definitions:
                                              -- [{"zone": "Z1", "label": "Recovery",
                                              --   "min_pct": 0, "max_pct": 55,
                                              --   "min_value": 0, "max_value": 198,
                                              --   "unit": "watts"}]
  css_per_100m_sec NUMERIC(6,2),             -- swim anchor
  vdot_score      NUMERIC(5,2),              -- run anchor
  pace_zones      JSONB,                     -- for run/swim: pace targets per zone
                                             -- [{"zone": "E", "label": "Easy",
                                             --   "min_pace_sec_km": 360, "max_pace_sec_km": 450}]
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_zone_model_athlete_sport ON zone_model(athlete_id, sport);
CREATE INDEX idx_zone_model_active ON zone_model(athlete_id, sport, effective_to)
  WHERE effective_to IS NULL;
```

---

### `permission`

Multi-athlete access control. Controls who can read or write each athlete's data.

```sql
CREATE TABLE permission (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id    UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  granted_to    UUID NOT NULL REFERENCES athlete(id), -- or a coach/admin user id
  access_level  TEXT NOT NULL,                        -- 'read' | 'write' | 'admin'
  granted_at    TIMESTAMPTZ DEFAULT now(),
  expires_at    TIMESTAMPTZ,                          -- null = permanent
  granted_by    UUID REFERENCES athlete(id)
);

CREATE INDEX idx_permission_athlete ON permission(athlete_id);
CREATE INDEX idx_permission_granted_to ON permission(granted_to);
```

---

## Season and Planning Tables

---

### `season`

One season per athlete per year. Contains the A-race and overall goal.

```sql
CREATE TABLE season (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id      UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,              -- e.g. '2026 MTB Season'
  year            INT NOT NULL,
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  primary_goal    TEXT,                       -- free text season objective
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_season_athlete ON season(athlete_id);
```

---

### `goal`

A-race, B-race, C-race goals and season/block objectives. Multiple goals per season.

```sql
CREATE TABLE goal (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id      UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  season_id       UUID REFERENCES season(id),
  type            TEXT NOT NULL,              -- 'a_race' | 'b_race' | 'c_race' | 'fitness' | 'block'
  priority        TEXT,                       -- 'A' | 'B' | 'C' (for race goals)
  title           TEXT NOT NULL,
  description     TEXT,
  event_date      DATE,                       -- for race goals
  event_name      TEXT,                       -- e.g. 'Transbaviaans 2026'
  event_distance  TEXT,                       -- e.g. '230km'
  event_sport     TEXT,                       -- 'mtb' | 'triathlon' | 'running' etc
  target_metric   TEXT,                       -- e.g. 'finish' | 'sub_12hr' | 'ftp_280w'
  target_value    NUMERIC(10,3),              -- numeric target where applicable
  target_unit     TEXT,                       -- 'watts' | 'hours' | 'kg' | 'vdot'
  status          TEXT DEFAULT 'active',      -- 'active' | 'achieved' | 'revised' | 'abandoned'
  revision_log    JSONB DEFAULT '[]',         -- array of {date, reason, old_value, new_value}
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_goal_athlete ON goal(athlete_id);
CREATE INDEX idx_goal_season ON goal(season_id);
```

---

### `period`

Training blocks within a season. Maps to Friel's Prep/Base/Build/Peak/Race/Transition or Daniels' phases.

```sql
CREATE TABLE period (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id          UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  season_id           UUID NOT NULL REFERENCES season(id),
  methodology_id      UUID REFERENCES methodology(id),
  name                TEXT NOT NULL,              -- 'Base 1' | 'Build 2' | 'Peak' etc
  period_type         TEXT NOT NULL,              -- 'preparation' | 'base' | 'build' |
                                                  -- 'peak' | 'race' | 'transition'
  sub_period          TEXT,                       -- 'base_1' | 'base_2' | 'base_3' | 'build_1' etc
  start_date          DATE NOT NULL,
  end_date            DATE NOT NULL,
  objective           TEXT,                       -- primary training objective for this block
  intensity_dist_type TEXT,                       -- 'pure_middle' | 'polarised' | 'general'
  planned_weekly_hrs  NUMERIC(5,2),               -- target weekly training hours
  target_ctl_end      NUMERIC(6,2),               -- target CTL at end of period
  strength_phase      TEXT,                       -- 'AA' | 'MT' | 'MS' | 'SM' | 'none'
  progression_gate    JSONB,                      -- conditions to advance to next period:
                                                  -- {"decoupling_pct_max": 5,
                                                  --  "ef_trend": "positive",
                                                  --  "weeks_minimum": 3}
  status              TEXT DEFAULT 'planned',     -- 'planned' | 'active' | 'complete'
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_period_athlete ON period(athlete_id);
CREATE INDEX idx_period_season ON period(season_id);
CREATE INDEX idx_period_dates ON period(athlete_id, start_date, end_date);
```

---

### `week`

Individual training weeks within a period.

```sql
CREATE TABLE week (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id            UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  period_id             UUID NOT NULL REFERENCES period(id),
  week_number           INT NOT NULL,              -- week number within the period
  start_date            DATE NOT NULL,
  end_date              DATE NOT NULL,
  week_type             TEXT NOT NULL,             -- 'build' | 'recovery' | 'test' | 'race'
  planned_volume_hrs    NUMERIC(5,2),
  planned_tss           NUMERIC(8,2),
  easy_hard_ratio       TEXT,                      -- e.g. '4:3' (easy days : hard days)
  actual_volume_hrs     NUMERIC(5,2),              -- populated by ingestion service post-week
  actual_tss            NUMERIC(8,2),
  compliance_pct        NUMERIC(5,2),              -- actual/planned sessions completed
  notes                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_week_athlete ON week(athlete_id);
CREATE INDEX idx_week_period ON week(period_id);
CREATE INDEX idx_week_dates ON week(athlete_id, start_date);
```

---

### `strength_phase`

Tracks the active gym strength phase per athlete, linked to the training period.

```sql
CREATE TABLE strength_phase (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id        UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  period_id         UUID REFERENCES period(id),
  phase             TEXT NOT NULL,               -- 'AA' | 'MT' | 'MS' | 'SM'
  start_date        DATE NOT NULL,
  end_date          DATE,                         -- null = currently active
  sessions_per_week INT NOT NULL,
  load_pct_1rm_set1 NUMERIC(5,2),                -- e.g. 60 (SM alternating sets)
  load_pct_1rm_set2 NUMERIC(5,2),                -- e.g. 85 (SM second set)
  reps_set1         INT,
  reps_set2         INT,
  key_exercises     TEXT[],                       -- e.g. ['two_leg_squat', 'deadlift', 'step_ups']
  core_included     BOOLEAN DEFAULT true,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_strength_phase_athlete ON strength_phase(athlete_id);
```

---

## Session Tables

---

### `planned_session`

Every session scheduled by the coaching engine or the athlete. Linked to TrainingPeaks when synced.

```sql
CREATE TABLE planned_session (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id          UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  week_id             UUID REFERENCES week(id),
  session_type_id     UUID REFERENCES session_type(id),
  scheduled_date      DATE NOT NULL,
  sport               TEXT NOT NULL,              -- 'cycling' | 'running' | 'swimming' |
                                                  -- 'brick' | 'strength' | 'other'
  title               TEXT NOT NULL,
  description         TEXT,
  goal                TEXT,                       -- what this session is meant to achieve
  block_objective_link TEXT,                      -- how this session serves the block objective
  target_zone         TEXT,                       -- primary target zone e.g. 'Z2' | 'T' | 'Z4'
  target_duration_min INT,
  target_tss          NUMERIC(8,2),
  target_score        NUMERIC(8,2),               -- expected session score (methodology-native)
  target_metric       TEXT,                       -- e.g. 'ef' | 'decoupling' | 'avg_power'
  target_metric_value NUMERIC(10,3),
  intensity_dist_target JSONB,                    -- planned zone time splits
  tp_workout_id       TEXT,                       -- TrainingPeaks workout ID (nullable)
  status              TEXT DEFAULT 'scheduled',   -- 'scheduled' | 'completed' | 'skipped' | 'modified'
  priority            TEXT DEFAULT 'normal',      -- 'anchor' | 'breakthrough' | 'normal' | 'optional'
  created_by          TEXT DEFAULT 'coach',       -- 'coach' | 'athlete' | 'system'
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_planned_session_athlete ON planned_session(athlete_id);
CREATE INDEX idx_planned_session_date ON planned_session(athlete_id, scheduled_date);
CREATE INDEX idx_planned_session_week ON planned_session(week_id);
```

---

### `completed_session`

Actual workout records. One row per workout. Garmin is primary source; Strava and TrainingPeaks add fields.

```sql
CREATE TABLE completed_session (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id              UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  planned_session_id      UUID REFERENCES planned_session(id),  -- null if unplanned
  session_type_id         UUID REFERENCES session_type(id),
  activity_date           DATE NOT NULL,
  start_time              TIMESTAMPTZ NOT NULL,
  end_time                TIMESTAMPTZ NOT NULL,
  sport                   TEXT NOT NULL,

  -- Identity and deduplication
  garmin_activity_id      TEXT UNIQUE NOT NULL,
  strava_activity_id      TEXT UNIQUE,
  tp_workout_id           TEXT,
  data_source_primary     TEXT DEFAULT 'garmin',

  -- Core metrics (from Garmin)
  duration_sec            INT NOT NULL,
  distance_m              NUMERIC(10,2),
  elevation_gain_m        NUMERIC(8,2),
  avg_power_w             NUMERIC(8,2),            -- cycling/running power
  normalized_power_w      NUMERIC(8,2),
  avg_hr                  NUMERIC(6,2),
  max_hr                  INT,
  avg_cadence             NUMERIC(6,2),
  avg_speed_ms            NUMERIC(8,4),
  variability_index       NUMERIC(6,4),            -- NP / avg power

  -- Intensity metrics (Garmin calculated)
  intensity_factor_garmin NUMERIC(6,4),            -- NP / FTP

  -- TrainingPeaks fields
  tss                     NUMERIC(8,2),
  intensity_factor_tp     NUMERIC(6,4),
  ef_trainingpeaks        NUMERIC(8,4),            -- EF as reported by TP
  ctl_at_completion       NUMERIC(8,2),
  atl_at_completion       NUMERIC(8,2),
  tsb_at_completion       NUMERIC(8,2),
  compliance_score_tp     NUMERIC(6,2),            -- TP planned vs actual %
  vi_tp                   NUMERIC(6,4),

  -- Calculated by ingestion service
  ef_garmin_calculated    NUMERIC(8,4),            -- NP / avg HR from raw stream
  ef_source_used          TEXT,                    -- 'garmin' | 'trainingpeaks'
  ef_source_reason        TEXT,                    -- why that source was chosen

  -- Zone distribution (populated from stream analysis)
  zone_distribution       JSONB,                   -- {"Z1": 12, "Z2": 45, "Z3": 20, ...} (minutes)
  decoupling_pct          NUMERIC(6,3),            -- aerobic decoupling %
  aerobic_ef              NUMERIC(8,4),            -- EF for the session

  -- Strava fields
  strava_suffer_score     NUMERIC(8,2),
  strava_relative_effort  NUMERIC(8,2),
  segment_prs             JSONB,                   -- Strava segment PRs achieved

  -- Session assessment
  rpe_actual              NUMERIC(4,2),            -- 1-10 RPE post-session
  session_notes           TEXT,
  goal_achieved           BOOLEAN,
  goal_deviation_notes    TEXT,

  -- Planned vs actual
  planned_duration_min    INT,
  actual_vs_planned_pct   NUMERIC(6,2),

  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_completed_session_athlete ON completed_session(athlete_id);
CREATE INDEX idx_completed_session_date ON completed_session(athlete_id, activity_date);
CREATE INDEX idx_completed_session_planned ON completed_session(planned_session_id);
CREATE INDEX idx_completed_session_garmin ON completed_session(garmin_activity_id);
```

---

### `session_score`

Methodology-native training stress score per completed session. Separate table to support multiple scoring systems.

```sql
CREATE TABLE session_score (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id          UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  completed_session_id UUID NOT NULL REFERENCES completed_session(id) ON DELETE CASCADE,
  methodology_id      UUID REFERENCES methodology(id),
  tss                 NUMERIC(8,2),               -- universal (from TrainingPeaks or calculated)
  friel_score         NUMERIC(8,2),               -- zone × time in zone (Friel / Triathlon Bible)
  daniels_points      NUMERIC(8,2),               -- pace zone points (Daniels, running only)
  weekly_points_total NUMERIC(8,2),               -- Daniels weekly cumulative (running)
  score_breakdown     JSONB,                       -- {"Z1_min": 30, "Z1_pts": 30,
                                                   --  "Z2_min": 8, "Z2_pts": 16, ...}
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_session_score_session ON session_score(completed_session_id);
CREATE INDEX idx_session_score_athlete_date ON session_score(athlete_id);
```

---

## Fitness and Testing Tables

---

### `field_test`

All field tests performed by the athlete. One row per test event.

```sql
CREATE TABLE field_test (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id        UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  test_date         DATE NOT NULL,
  test_type         TEXT NOT NULL,               -- 'T1_ftp_fthr' | 'T2_aerobic_capacity' |
                                                 -- 'T3_stamina' | 'T4_sprint_power' |
                                                 -- 'vdot_time_trial' | 'css_broken_km' |
                                                 -- 'css_threshold_pace' | 'ramp_test'
  sport             TEXT NOT NULL,
  methodology_id    UUID REFERENCES methodology(id),

  -- Results (populated based on test type)
  ftp_watts         NUMERIC(8,2),               -- T1: FTP result
  fthr_bpm          NUMERIC(6,2),               -- T1: FTHR result
  avg_power_20min   NUMERIC(8,2),               -- T1: raw 20-min avg power
  avg_hr_20min      NUMERIC(6,2),               -- T1: raw 20-min avg HR
  vo2max_power_w    NUMERIC(8,2),               -- T2: 5-min power proxy
  stamina_if        NUMERIC(6,4),               -- T3: IF sustained over 90 min
  sprint_5s_peak_w  NUMERIC(8,2),               -- T4: 5-second peak power
  sprint_20s_avg_w  NUMERIC(8,2),               -- T4: 20-second average power
  vdot_score        NUMERIC(5,2),               -- VDOT: derived from time trial
  race_distance_m   NUMERIC(10,2),              -- VDOT: time trial distance
  race_time_sec     INT,                         -- VDOT: time trial time
  css_per_100m_sec  NUMERIC(6,2),               -- CSS: critical swim speed
  css_400m_time_sec INT,                         -- CSS: 400m time
  css_200m_time_sec INT,                         -- CSS: 200m time

  -- Zone update
  zones_updated     BOOLEAN DEFAULT false,       -- did this test trigger zone recalculation
  notes             TEXT,
  garmin_activity_id TEXT,                       -- link to the test workout
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_field_test_athlete ON field_test(athlete_id);
CREATE INDEX idx_field_test_type ON field_test(athlete_id, test_type);
CREATE INDEX idx_field_test_date ON field_test(athlete_id, test_date DESC);
```

---

### `lab_result`

Lab tests and clinical assessments uploaded by the athlete or practitioner.

```sql
CREATE TABLE lab_result (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id        UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  test_date         DATE NOT NULL,
  test_type         TEXT NOT NULL,               -- 'vo2max_lab' | 'lactate_threshold' |
                                                 -- 'blood_panel' | 'dxa_body_comp' |
                                                 -- 'ramp_test' | 'cpet' | 'other'
  performed_by      TEXT,                        -- lab / clinic / practitioner name
  report_file_url   TEXT,                        -- link to PDF/image in object storage
  structured_data   JSONB,                       -- extracted metrics:
                                                 -- {"vo2max_ml_kg_min": 58.3,
                                                 --  "lt1_watts": 210, "lt2_watts": 285,
                                                 --  "ferritin_ug_l": 42,
                                                 --  "haemoglobin_g_dl": 14.2,
                                                 --  "vitamin_d_nmol_l": 68,
                                                 --  "cortisol_nmol_l": 320}
  source            TEXT DEFAULT 'upload',       -- 'upload' | 'manual_entry' | 'integrated_lab'
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_lab_result_athlete ON lab_result(athlete_id);
CREATE INDEX idx_lab_result_type ON lab_result(athlete_id, test_type);
CREATE INDEX idx_lab_result_structured ON lab_result USING GIN(structured_data);
```

---

### `fitness_snapshot`

Weekly fitness KPI snapshot. One row per athlete per week. Written by ingestion service every Sunday night.

```sql
CREATE TABLE fitness_snapshot (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id            UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  snapshot_date         DATE NOT NULL,           -- Sunday of the week
  week_id               UUID REFERENCES week(id),

  -- PMC metrics (from TrainingPeaks)
  ctl                   NUMERIC(8,2),            -- chronic training load (fitness)
  atl                   NUMERIC(8,2),            -- acute training load (fatigue)
  tsb                   NUMERIC(8,2),            -- training stress balance (form)

  -- Power metrics
  ftp_current           NUMERIC(8,2),            -- FTP at time of snapshot
  w_per_kg              NUMERIC(6,3),            -- FTP / weight

  -- Running metrics
  vdot_current          NUMERIC(5,2),

  -- Swim metrics
  css_current_sec       NUMERIC(6,2),            -- CSS per 100m in seconds

  -- Aerobic fitness proxies
  ef_7day_avg           NUMERIC(8,4),            -- 7-day rolling EF average (Z2 rides)
  ef_trend              TEXT,                    -- 'improving' | 'stable' | 'declining'
  decoupling_last_long  NUMERIC(6,3),            -- decoupling % from last long aerobic session

  -- HR metrics
  resting_hr_avg        NUMERIC(6,2),            -- 7-day avg resting HR
  hrv_7day_avg          NUMERIC(8,4),            -- 7-day HRV average

  -- Readiness (engine-calculated composite)
  readiness_score       NUMERIC(5,2),            -- 0-100, calculated from health metrics

  -- Volume
  weekly_volume_hrs     NUMERIC(6,2),
  weekly_tss            NUMERIC(8,2),
  ytd_volume_hrs        NUMERIC(8,2),

  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_fitness_snapshot_athlete ON fitness_snapshot(athlete_id);
CREATE INDEX idx_fitness_snapshot_date ON fitness_snapshot(athlete_id, snapshot_date DESC);
```

---

## Diary and Coaching Tables

---

### `diary_entry`

Daily training diary. One row per athlete per day. Written by the coach interface.

```sql
CREATE TABLE diary_entry (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id            UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  entry_date            DATE NOT NULL,
  completed_session_id  UUID REFERENCES completed_session(id),

  -- Subjective wellness (1-10 scale)
  rpe_overall           NUMERIC(4,2),            -- perceived exertion of the day
  wellness_score        NUMERIC(4,2),            -- overall wellness
  sleep_quality         NUMERIC(4,2),            -- subjective sleep quality
  motivation_score      NUMERIC(4,2),            -- motivation to train
  soreness_score        NUMERIC(4,2),            -- muscle soreness
  stress_life           NUMERIC(4,2),            -- life/work stress level

  -- Free text
  session_reflection    TEXT,                    -- how the session went
  daily_notes           TEXT,                    -- anything else

  -- Coach summary (written by coaching engine after processing)
  coach_summary         TEXT,
  coach_flags           TEXT[],                  -- e.g. ['high_fatigue', 'missed_target_zone']
  coach_recommendations TEXT,

  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_diary_entry_athlete_date ON diary_entry(athlete_id, entry_date);
CREATE INDEX idx_diary_entry_session ON diary_entry(completed_session_id);
```

---

### `conversation`

WhatsApp message history. Provides multi-turn context for the coaching engine.

```sql
CREATE TABLE conversation (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id    UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  role          TEXT NOT NULL,                   -- 'athlete' | 'coach'
  content       TEXT NOT NULL,
  message_ts    TIMESTAMPTZ NOT NULL,
  channel       TEXT DEFAULT 'whatsapp',         -- 'whatsapp' | 'web' | 'system'
  intent        TEXT,                            -- classified intent: 'diary' | 'planning' |
                                                 -- 'question' | 'feedback' | 'revision'
  linked_session_id UUID REFERENCES completed_session(id),
  linked_goal_id    UUID REFERENCES goal(id),
  metadata      JSONB,                           -- whatsapp message ID, media refs etc
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_conversation_athlete ON conversation(athlete_id);
CREATE INDEX idx_conversation_ts ON conversation(athlete_id, message_ts DESC);
```

---

### `notification_log`

Outbound alerts and messages sent to the athlete.

```sql
CREATE TABLE notification_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id    UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  channel       TEXT NOT NULL,                   -- 'whatsapp' | 'email' | 'push'
  type          TEXT NOT NULL,                   -- 'session_reminder' | 'recovery_alert' |
                                                 -- 'milestone' | 'plan_revision' | 'test_due'
  title         TEXT,
  body          TEXT NOT NULL,
  sent_at       TIMESTAMPTZ NOT NULL,
  delivered     BOOLEAN,
  read_at       TIMESTAMPTZ,
  metadata      JSONB                            -- delivery receipts, message IDs
);

CREATE INDEX idx_notification_athlete ON notification_log(athlete_id);
CREATE INDEX idx_notification_sent ON notification_log(athlete_id, sent_at DESC);
```

---

## Knowledge Tables

---

### `knowledge_chunk`

Chunks from books, papers, articles, and talks. Stored in vector store with embeddings.

```sql
CREATE TABLE knowledge_chunk (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_title    TEXT NOT NULL,                 -- e.g. 'Triathlon Training Bible'
  source_author   TEXT,                          -- e.g. 'Joe Friel'
  source_type     TEXT NOT NULL,                 -- 'book' | 'paper' | 'article' | 'talk' | 'manual'
  page_ref        TEXT,                          -- page number or chapter reference
  evidence_level  TEXT,                          -- 'evidence_based' | 'practitioner_consensus' | 'anecdote'
  sport_tags      TEXT[],                        -- e.g. ['cycling', 'mtb', 'triathlon']
  topic_tags      TEXT[],                        -- e.g. ['aerobic_endurance', 'zone_2', 'periodisation']
  content         TEXT NOT NULL,                 -- the chunk text
  embedding       vector(1536),                  -- OpenAI or similar embedding
  methodology_ref TEXT,                          -- links to methodology if applicable
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_knowledge_chunk_embedding ON knowledge_chunk USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_knowledge_chunk_tags ON knowledge_chunk USING GIN(topic_tags);
CREATE INDEX idx_knowledge_chunk_source ON knowledge_chunk(source_title, source_author);
```

---

### `methodology_document`

Full methodology source documents indexed for the coaching engine.

```sql
CREATE TABLE methodology_document (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  methodology_id  UUID NOT NULL REFERENCES methodology(id),
  title           TEXT NOT NULL,
  content         TEXT NOT NULL,
  embedding       vector(1536),
  chunk_index     INT,                           -- position within the source document
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_methodology_doc_embedding ON methodology_document USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_methodology_doc_methodology ON methodology_document(methodology_id);
```

---

### `coach_reference`

Links between coaching conversations/diary entries and knowledge chunks.

```sql
CREATE TABLE coach_reference (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id        UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  knowledge_chunk_id UUID NOT NULL REFERENCES knowledge_chunk(id),
  source_type       TEXT NOT NULL,               -- 'diary_entry' | 'conversation' | 'session'
  source_id         UUID NOT NULL,               -- ID of the diary_entry, conversation, or session
  relevance_score   NUMERIC(6,4),               -- semantic similarity score
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_coach_reference_athlete ON coach_reference(athlete_id);
CREATE INDEX idx_coach_reference_chunk ON coach_reference(knowledge_chunk_id);
```

---

### `annotation`

Athlete notes and highlights on knowledge chunks.

```sql
CREATE TABLE annotation (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id          UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  knowledge_chunk_id  UUID NOT NULL REFERENCES knowledge_chunk(id),
  note                TEXT,
  highlight           TEXT,                      -- selected text from the chunk
  tags                TEXT[],
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_annotation_athlete ON annotation(athlete_id);
CREATE INDEX idx_annotation_chunk ON annotation(knowledge_chunk_id);
```

---

## Time-Series Tables (TimescaleDB)

---

### `workout_stream`

Second-by-second workout data. Hypertable partitioned by `time`.

```sql
CREATE TABLE workout_stream (
  time                TIMESTAMPTZ NOT NULL,
  athlete_id          UUID NOT NULL,
  garmin_activity_id  TEXT NOT NULL,
  power_w             NUMERIC(8,2),
  hr_bpm              INT,
  cadence_rpm         NUMERIC(6,2),
  speed_ms            NUMERIC(8,4),
  elevation_m         NUMERIC(8,2),
  latitude            NUMERIC(12,8),
  longitude           NUMERIC(12,8),
  distance_m          NUMERIC(10,2),              -- cumulative distance
  temperature_c       NUMERIC(6,2),
  left_power_pct      NUMERIC(6,2),               -- Assioma L/R balance
  right_power_pct     NUMERIC(6,2)
);

SELECT create_hypertable('workout_stream', 'time');
CREATE INDEX idx_workout_stream_activity ON workout_stream(garmin_activity_id, time);
CREATE INDEX idx_workout_stream_athlete ON workout_stream(athlete_id, time DESC);
```

---

### `lap_summary`

Lap-level aggregates per workout. Faster than querying the full stream.

```sql
CREATE TABLE lap_summary (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id          UUID NOT NULL,
  garmin_activity_id  TEXT NOT NULL,
  lap_number          INT NOT NULL,
  start_time          TIMESTAMPTZ NOT NULL,
  end_time            TIMESTAMPTZ NOT NULL,
  duration_sec        INT,
  distance_m          NUMERIC(10,2),
  avg_power_w         NUMERIC(8,2),
  normalized_power_w  NUMERIC(8,2),
  avg_hr              NUMERIC(6,2),
  max_hr              INT,
  avg_cadence         NUMERIC(6,2),
  avg_speed_ms        NUMERIC(8,4),
  elevation_gain_m    NUMERIC(8,2),
  zone_distribution   JSONB                       -- time in each zone for this lap
);

CREATE INDEX idx_lap_summary_activity ON lap_summary(garmin_activity_id);
CREATE INDEX idx_lap_summary_athlete ON lap_summary(athlete_id);
```

---

### `daily_metrics`

Garmin health API data. One row per athlete per day. Pulled by scheduled trigger.

```sql
CREATE TABLE daily_metrics (
  time                    TIMESTAMPTZ NOT NULL,  -- midnight UTC of the day
  athlete_id              UUID NOT NULL,
  date                    DATE NOT NULL,

  -- HRV
  hrv_nightly_avg         NUMERIC(8,4),
  hrv_7day_avg            NUMERIC(8,4),
  hrv_status              TEXT,                  -- 'balanced' | 'unbalanced' | 'low' | 'poor'

  -- Heart rate
  resting_hr              INT,

  -- Body battery
  body_battery_morning    INT,                   -- value on waking (0-100)
  body_battery_min        INT,
  body_battery_max        INT,

  -- Sleep
  sleep_duration_hrs      NUMERIC(5,2),
  sleep_score             INT,                   -- Garmin composite score (0-100)
  sleep_deep_hrs          NUMERIC(5,2),
  sleep_rem_hrs           NUMERIC(5,2),
  sleep_light_hrs         NUMERIC(5,2),
  sleep_awake_hrs         NUMERIC(5,2),
  sleep_respiration_avg   NUMERIC(6,2),          -- breaths per minute

  -- Blood oxygen
  spo2_avg                NUMERIC(6,2),
  spo2_min                NUMERIC(6,2),

  -- Stress
  stress_avg              INT,                   -- Garmin stress score 0-100
  stress_rest_avg         INT,

  -- Temperature
  skin_temp_deviation     NUMERIC(6,3),          -- deviation from baseline (nullable)

  -- Engine-calculated
  readiness_score         NUMERIC(5,2)           -- composite readiness 0-100
);

SELECT create_hypertable('daily_metrics', 'time');
CREATE UNIQUE INDEX idx_daily_metrics_athlete_date ON daily_metrics(athlete_id, date);
```

---

## Ingestion Support Table

---

### `sync_state`

Tracks the last successful sync per athlete per data source and endpoint.

```sql
CREATE TABLE sync_state (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id        UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  source            TEXT NOT NULL,               -- 'garmin_activities' | 'garmin_health' |
                                                 -- 'trainingpeaks' | 'strava'
  last_synced_at    TIMESTAMPTZ,
  last_item_id      TEXT,                        -- ID of last synced item (for pagination)
  sync_status       TEXT DEFAULT 'pending',      -- 'pending' | 'success' | 'error' | 'running'
  error_message     TEXT,
  error_count       INT DEFAULT 0,
  next_sync_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_sync_state_athlete_source ON sync_state(athlete_id, source);
```

---

## Summary

### Table count

| Engine | Tables | Notes |
|---|---|---|
| Relational (PostgreSQL) | 23 | Includes reference, athlete, planning, session, fitness, diary, coaching, knowledge tables |
| Time-series (TimescaleDB) | 3 | workout_stream, lap_summary, daily_metrics |
| Vector store (pgvector) | 2 | knowledge_chunk, methodology_document — columns on relational tables |
| Ingestion support | 1 | sync_state |
| **Total** | **27** | Single PostgreSQL deployment |

Note: pgvector tables are relational tables with an additional `vector` column type. They live in the same PostgreSQL instance with the `vector` extension enabled.

### Key relationships

```
athlete
  └── season → period → week → planned_session → completed_session
  └── zone_model (per sport, per methodology)
  └── goal (A/B/C races, fitness targets)
  └── field_test (FTP, VDOT, CSS)
  └── lab_result (blood panels, VO2max lab)
  └── fitness_snapshot (weekly KPI snapshot)
  └── strength_phase (gym phase tracking)
  └── diary_entry → completed_session
  └── conversation (WhatsApp history)
  └── permission (multi-athlete access)
  └── sync_state (per data source)

methodology → session_type (reference, not per-athlete)
knowledge_chunk ← coach_reference → diary_entry / conversation
knowledge_chunk ← annotation ← athlete
```

### V2 flags

- Nutrition logging (`nutrition_log` table — daily macros, race fuelling logs)
- Export template (`export_template` table — defines doctor summary and coach summary document structure)
- The `lab_result.structured_data` JSONB is already designed to support both V1 and V2 export without schema changes

---

*End of schema definition. Ready for Claude Code implementation.*

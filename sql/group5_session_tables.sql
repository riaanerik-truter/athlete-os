-- =============================================================
-- GROUP 5: Session Tables
-- planned_session, completed_session, session_score
-- =============================================================

CREATE TABLE planned_session (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id            UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  week_id               UUID REFERENCES week(id),
  session_type_id       UUID REFERENCES session_type(id),
  scheduled_date        DATE NOT NULL,
  sport                 TEXT NOT NULL,
  title                 TEXT NOT NULL,
  description           TEXT,
  goal                  TEXT,
  block_objective_link  TEXT,
  target_zone           TEXT,
  target_duration_min   INT,
  target_tss            NUMERIC(8,2),
  target_score          NUMERIC(8,2),
  target_metric         TEXT,
  target_metric_value   NUMERIC(10,3),
  intensity_dist_target JSONB,
  tp_workout_id         TEXT,
  status                TEXT DEFAULT 'scheduled',
  priority              TEXT DEFAULT 'normal',
  created_by            TEXT DEFAULT 'coach',
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_planned_session_athlete ON planned_session(athlete_id);
CREATE INDEX idx_planned_session_date    ON planned_session(athlete_id, scheduled_date);
CREATE INDEX idx_planned_session_week    ON planned_session(week_id);

CREATE TABLE completed_session (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id              UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  planned_session_id      UUID REFERENCES planned_session(id),
  session_type_id         UUID REFERENCES session_type(id),
  activity_date           DATE NOT NULL,
  start_time              TIMESTAMPTZ NOT NULL,
  end_time                TIMESTAMPTZ NOT NULL,
  sport                   TEXT NOT NULL,
  garmin_activity_id      TEXT UNIQUE NOT NULL,
  strava_activity_id      TEXT UNIQUE,
  tp_workout_id           TEXT,
  data_source_primary     TEXT DEFAULT 'garmin',
  duration_sec            INT NOT NULL,
  distance_m              NUMERIC(10,2),
  elevation_gain_m        NUMERIC(8,2),
  avg_power_w             NUMERIC(8,2),
  normalized_power_w      NUMERIC(8,2),
  avg_hr                  NUMERIC(6,2),
  max_hr                  INT,
  avg_cadence             NUMERIC(6,2),
  avg_speed_ms            NUMERIC(8,4),
  variability_index       NUMERIC(6,4),
  intensity_factor_garmin NUMERIC(6,4),
  tss                     NUMERIC(8,2),
  intensity_factor_tp     NUMERIC(6,4),
  ef_trainingpeaks        NUMERIC(8,4),
  ctl_at_completion       NUMERIC(8,2),
  atl_at_completion       NUMERIC(8,2),
  tsb_at_completion       NUMERIC(8,2),
  compliance_score_tp     NUMERIC(6,2),
  vi_tp                   NUMERIC(6,4),
  ef_garmin_calculated    NUMERIC(8,4),
  ef_source_used          TEXT,
  ef_source_reason        TEXT,
  zone_distribution       JSONB,
  decoupling_pct          NUMERIC(6,3),
  aerobic_ef              NUMERIC(8,4),
  strava_suffer_score     NUMERIC(8,2),
  strava_relative_effort  NUMERIC(8,2),
  segment_prs             JSONB,
  rpe_actual              NUMERIC(4,2),
  session_notes           TEXT,
  goal_achieved           BOOLEAN,
  goal_deviation_notes    TEXT,
  planned_duration_min    INT,
  actual_vs_planned_pct   NUMERIC(6,2),
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_completed_session_athlete ON completed_session(athlete_id);
CREATE INDEX idx_completed_session_date    ON completed_session(athlete_id, activity_date);
CREATE INDEX idx_completed_session_planned ON completed_session(planned_session_id);
CREATE INDEX idx_completed_session_garmin  ON completed_session(garmin_activity_id);

CREATE TABLE session_score (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id           UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  completed_session_id UUID NOT NULL REFERENCES completed_session(id) ON DELETE CASCADE,
  methodology_id       UUID REFERENCES methodology(id),
  tss                  NUMERIC(8,2),
  friel_score          NUMERIC(8,2),
  daniels_points       NUMERIC(8,2),
  weekly_points_total  NUMERIC(8,2),
  score_breakdown      JSONB,
  created_at           TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_session_score_session      ON session_score(completed_session_id);
CREATE INDEX idx_session_score_athlete_date ON session_score(athlete_id);

-- =============================================================
-- GROUP 4: Season and Planning Tables
-- season, goal, period, week, strength_phase
-- =============================================================

CREATE TABLE season (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id   UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  year         INT NOT NULL,
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  primary_goal TEXT,
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);
CREATE INDEX idx_season_athlete ON season(athlete_id);

CREATE TABLE goal (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id     UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  season_id      UUID REFERENCES season(id),
  type           TEXT NOT NULL,
  priority       TEXT,
  title          TEXT NOT NULL,
  description    TEXT,
  event_date     DATE,
  event_name     TEXT,
  event_distance TEXT,
  event_sport    TEXT,
  target_metric  TEXT,
  target_value   NUMERIC(10,3),
  target_unit    TEXT,
  status         TEXT DEFAULT 'active',
  revision_log   JSONB DEFAULT '[]',
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now(),
  deleted_at     TIMESTAMPTZ
);
CREATE INDEX idx_goal_athlete ON goal(athlete_id);
CREATE INDEX idx_goal_season  ON goal(season_id);

CREATE TABLE period (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id          UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  season_id           UUID NOT NULL REFERENCES season(id),
  methodology_id      UUID REFERENCES methodology(id),
  name                TEXT NOT NULL,
  period_type         TEXT NOT NULL,
  sub_period          TEXT,
  start_date          DATE NOT NULL,
  end_date            DATE NOT NULL,
  objective           TEXT,
  intensity_dist_type TEXT,
  planned_weekly_hrs  NUMERIC(5,2),
  target_ctl_end      NUMERIC(6,2),
  strength_phase      TEXT,
  progression_gate    JSONB,
  status              TEXT DEFAULT 'planned',
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_period_athlete ON period(athlete_id);
CREATE INDEX idx_period_season  ON period(season_id);
CREATE INDEX idx_period_dates   ON period(athlete_id, start_date, end_date);

CREATE TABLE week (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id         UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  period_id          UUID NOT NULL REFERENCES period(id),
  week_number        INT NOT NULL,
  start_date         DATE NOT NULL,
  end_date           DATE NOT NULL,
  week_type          TEXT NOT NULL,
  planned_volume_hrs NUMERIC(5,2),
  planned_tss        NUMERIC(8,2),
  easy_hard_ratio    TEXT,
  actual_volume_hrs  NUMERIC(5,2),
  actual_tss         NUMERIC(8,2),
  compliance_pct     NUMERIC(5,2),
  notes              TEXT,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_week_athlete ON week(athlete_id);
CREATE INDEX idx_week_period  ON week(period_id);
CREATE INDEX idx_week_dates   ON week(athlete_id, start_date);

CREATE TABLE strength_phase (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id        UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  period_id         UUID REFERENCES period(id),
  phase             TEXT NOT NULL,
  start_date        DATE NOT NULL,
  end_date          DATE,
  sessions_per_week INT NOT NULL,
  load_pct_1rm_set1 NUMERIC(5,2),
  load_pct_1rm_set2 NUMERIC(5,2),
  reps_set1         INT,
  reps_set2         INT,
  key_exercises     TEXT[],
  core_included     BOOLEAN DEFAULT true,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_strength_phase_athlete ON strength_phase(athlete_id);

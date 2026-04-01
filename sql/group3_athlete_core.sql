-- =============================================================
-- GROUP 3: Athlete Core
-- athlete, zone_model
-- permission table removed — V1 is single-athlete per instance
-- =============================================================

CREATE TABLE athlete (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  email                 TEXT UNIQUE NOT NULL,
  date_of_birth         DATE,
  sex                   TEXT,
  weight_kg             NUMERIC(5,2),
  height_cm             NUMERIC(5,1),
  primary_sport         TEXT,
  active_sports         TEXT[],
  active_methodology_id UUID REFERENCES methodology(id),
  ftp_watts             INT,
  fthr_cycling          INT,
  fthr_running          INT,
  css_per_100m_sec      NUMERIC(6,2),
  vdot                  NUMERIC(5,2),
  max_hr                INT,
  weekly_run_volume_km  NUMERIC(6,1),
  limiter               TEXT,
  strengths             TEXT,
  known_injuries        TEXT,
  medications           TEXT,
  blood_type            TEXT,
  garmin_user_id        TEXT,
  strava_athlete_id     TEXT,
  tp_athlete_id         TEXT,
  whatsapp_number       TEXT,
  timezone              TEXT DEFAULT 'UTC',
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  deleted_at            TIMESTAMPTZ
);

CREATE TABLE zone_model (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id       UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  methodology_id   UUID NOT NULL REFERENCES methodology(id),
  sport            TEXT NOT NULL,
  anchor_metric    TEXT NOT NULL,
  anchor_value     NUMERIC(8,2) NOT NULL,
  effective_from   DATE NOT NULL,
  effective_to     DATE,
  zones            JSONB NOT NULL,
  css_per_100m_sec NUMERIC(6,2),
  vdot_score       NUMERIC(5,2),
  pace_zones       JSONB,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_zone_model_athlete_sport ON zone_model(athlete_id, sport);
CREATE INDEX idx_zone_model_active ON zone_model(athlete_id, sport, effective_to)
  WHERE effective_to IS NULL;

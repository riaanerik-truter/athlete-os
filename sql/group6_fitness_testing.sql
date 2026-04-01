-- =============================================================
-- GROUP 6: Fitness and Testing Tables
-- field_test, lab_result, fitness_snapshot
-- =============================================================

CREATE TABLE field_test (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id         UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  test_date          DATE NOT NULL,
  test_type          TEXT NOT NULL,
  sport              TEXT NOT NULL,
  methodology_id     UUID REFERENCES methodology(id),
  ftp_watts          NUMERIC(8,2),
  fthr_bpm           NUMERIC(6,2),
  avg_power_20min    NUMERIC(8,2),
  avg_hr_20min       NUMERIC(6,2),
  vo2max_power_w     NUMERIC(8,2),
  stamina_if         NUMERIC(6,4),
  sprint_5s_peak_w   NUMERIC(8,2),
  sprint_20s_avg_w   NUMERIC(8,2),
  vdot_score         NUMERIC(5,2),
  race_distance_m    NUMERIC(10,2),
  race_time_sec      INT,
  css_per_100m_sec   NUMERIC(6,2),
  css_400m_time_sec  INT,
  css_200m_time_sec  INT,
  zones_updated      BOOLEAN DEFAULT false,
  notes              TEXT,
  garmin_activity_id TEXT,
  created_at         TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_field_test_athlete ON field_test(athlete_id);
CREATE INDEX idx_field_test_type    ON field_test(athlete_id, test_type);
CREATE INDEX idx_field_test_date    ON field_test(athlete_id, test_date DESC);

CREATE TABLE lab_result (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id      UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  test_date       DATE NOT NULL,
  test_type       TEXT NOT NULL,
  performed_by    TEXT,
  report_file_url TEXT,
  structured_data JSONB,
  source          TEXT DEFAULT 'upload',
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_lab_result_athlete    ON lab_result(athlete_id);
CREATE INDEX idx_lab_result_type       ON lab_result(athlete_id, test_type);
CREATE INDEX idx_lab_result_structured ON lab_result USING GIN(structured_data);

CREATE TABLE fitness_snapshot (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id           UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  snapshot_date        DATE NOT NULL,
  week_id              UUID REFERENCES week(id),
  ctl                  NUMERIC(8,2),
  atl                  NUMERIC(8,2),
  tsb                  NUMERIC(8,2),
  ftp_current          NUMERIC(8,2),
  w_per_kg             NUMERIC(6,3),
  vdot_current         NUMERIC(5,2),
  css_current_sec      NUMERIC(6,2),
  ef_7day_avg          NUMERIC(8,4),
  ef_trend             TEXT,
  decoupling_last_long NUMERIC(6,3),
  resting_hr_avg       NUMERIC(6,2),
  hrv_7day_avg         NUMERIC(8,4),
  readiness_score      NUMERIC(5,2),
  weekly_volume_hrs    NUMERIC(6,2),
  weekly_tss           NUMERIC(8,2),
  ytd_volume_hrs       NUMERIC(8,2),
  created_at           TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_fitness_snapshot_athlete ON fitness_snapshot(athlete_id);
CREATE INDEX idx_fitness_snapshot_date    ON fitness_snapshot(athlete_id, snapshot_date DESC);

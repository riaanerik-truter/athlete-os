-- =============================================================
-- GROUP 9: Time-Series Tables (TimescaleDB)
-- workout_stream, lap_summary, daily_metrics
-- workout_stream and daily_metrics are hypertables
-- =============================================================

CREATE TABLE workout_stream (
  time               TIMESTAMPTZ NOT NULL,
  athlete_id         UUID NOT NULL,
  garmin_activity_id TEXT NOT NULL,
  power_w            NUMERIC(8,2),
  hr_bpm             INT,
  cadence_rpm        NUMERIC(6,2),
  speed_ms           NUMERIC(8,4),
  elevation_m        NUMERIC(8,2),
  latitude           NUMERIC(12,8),
  longitude          NUMERIC(12,8),
  distance_m         NUMERIC(10,2),
  temperature_c      NUMERIC(6,2),
  left_power_pct     NUMERIC(6,2),
  right_power_pct    NUMERIC(6,2)
);
SELECT create_hypertable('workout_stream', 'time');
CREATE INDEX idx_workout_stream_activity ON workout_stream(garmin_activity_id, time);
CREATE INDEX idx_workout_stream_athlete  ON workout_stream(athlete_id, time DESC);

CREATE TABLE lap_summary (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id         UUID NOT NULL,
  garmin_activity_id TEXT NOT NULL,
  lap_number         INT NOT NULL,
  start_time         TIMESTAMPTZ NOT NULL,
  end_time           TIMESTAMPTZ NOT NULL,
  duration_sec       INT,
  distance_m         NUMERIC(10,2),
  avg_power_w        NUMERIC(8,2),
  normalized_power_w NUMERIC(8,2),
  avg_hr             NUMERIC(6,2),
  max_hr             INT,
  avg_cadence        NUMERIC(6,2),
  avg_speed_ms       NUMERIC(8,4),
  elevation_gain_m   NUMERIC(8,2),
  zone_distribution  JSONB
);
CREATE INDEX idx_lap_summary_activity ON lap_summary(garmin_activity_id);
CREATE INDEX idx_lap_summary_athlete  ON lap_summary(athlete_id);

CREATE TABLE daily_metrics (
  time                  TIMESTAMPTZ NOT NULL,
  athlete_id            UUID NOT NULL,
  date                  DATE NOT NULL,
  hrv_nightly_avg       NUMERIC(8,4),
  hrv_7day_avg          NUMERIC(8,4),
  hrv_status            TEXT,
  resting_hr            INT,
  body_battery_morning  INT,
  body_battery_min      INT,
  body_battery_max      INT,
  sleep_duration_hrs    NUMERIC(5,2),
  sleep_score           INT,
  sleep_deep_hrs        NUMERIC(5,2),
  sleep_rem_hrs         NUMERIC(5,2),
  sleep_light_hrs       NUMERIC(5,2),
  sleep_awake_hrs       NUMERIC(5,2),
  sleep_respiration_avg NUMERIC(6,2),
  spo2_avg              NUMERIC(6,2),
  spo2_min              NUMERIC(6,2),
  stress_avg            INT,
  stress_rest_avg       INT,
  skin_temp_deviation   NUMERIC(6,3),
  readiness_score       NUMERIC(5,2)
);
SELECT create_hypertable('daily_metrics', 'time');
-- TimescaleDB requires the partitioning column (time) in all unique indexes on hypertables
CREATE UNIQUE INDEX idx_daily_metrics_athlete_date ON daily_metrics(athlete_id, date, time);

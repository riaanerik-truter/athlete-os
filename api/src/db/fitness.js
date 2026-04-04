// DB queries: fitness and testing
// Tables: fitness_snapshot, field_test, lab_result, daily_metrics

// ---------------------------------------------------------------------------
// Fitness snapshots
// ---------------------------------------------------------------------------

/**
 * Returns the single most recent fitness snapshot.
 */
export async function getLatestSnapshot(pool, athleteId) {
  const result = await pool.query(`
    SELECT *
    FROM fitness_snapshot
    WHERE athlete_id = $1
    ORDER BY snapshot_date DESC
    LIMIT 1
  `, [athleteId]);
  return result.rows[0] ?? null;
}

/**
 * Returns snapshot history for CTL/ATL/TSB charting.
 * from/to are ISO date strings (YYYY-MM-DD).
 */
export async function getSnapshotHistory(pool, athleteId, { from, to } = {}) {
  const conditions = ['athlete_id = $1'];
  const values = [athleteId];

  if (from) { values.push(from); conditions.push(`snapshot_date >= $${values.length}`); }
  if (to)   { values.push(to);   conditions.push(`snapshot_date <= $${values.length}`); }

  const result = await pool.query(`
    SELECT *
    FROM fitness_snapshot
    WHERE ${conditions.join(' AND ')}
    ORDER BY snapshot_date ASC
  `, values);
  return result.rows;
}

export async function createSnapshot(pool, athleteId, data) {
  const result = await pool.query(`
    INSERT INTO fitness_snapshot (
      athlete_id, snapshot_date, week_id,
      ctl, atl, tsb,
      ftp_current, w_per_kg, vdot_current, css_current_sec,
      ef_7day_avg, ef_trend, decoupling_last_long,
      resting_hr_avg, hrv_7day_avg, readiness_score,
      weekly_volume_hrs, weekly_tss, ytd_volume_hrs
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16, $17, $18, $19
    )
    RETURNING *
  `, [
    athleteId,
    data.snapshot_date,
    data.week_id              ?? null,
    data.ctl                  ?? null,
    data.atl                  ?? null,
    data.tsb                  ?? null,
    data.ftp_current          ?? null,
    data.w_per_kg             ?? null,
    data.vdot_current         ?? null,
    data.css_current_sec      ?? null,
    data.ef_7day_avg          ?? null,
    data.ef_trend             ?? null,
    data.decoupling_last_long ?? null,
    data.resting_hr_avg       ?? null,
    data.hrv_7day_avg         ?? null,
    data.readiness_score      ?? null,
    data.weekly_volume_hrs    ?? null,
    data.weekly_tss           ?? null,
    data.ytd_volume_hrs       ?? null
  ]);
  return result.rows[0];
}

/**
 * Returns all existing snapshot dates for the athlete.
 * Used by backfill to skip weeks that already have a snapshot.
 */
export async function getExistingSnapshotDates(pool, athleteId) {
  const result = await pool.query(`
    SELECT snapshot_date::text FROM fitness_snapshot
    WHERE athlete_id = $1
  `, [athleteId]);
  return new Set(result.rows.map(r => r.snapshot_date));
}

/**
 * Returns TSS history from completed_session for CTL/ATL/TSB seeding.
 * Includes TP-supplied ctl/atl/tsb values when present — calculator uses these
 * as authoritative where available and fills gaps with its own calculation.
 */
export async function getTssHistory(pool, athleteId, { from, to, limit = 1000 } = {}) {
  const conditions = ['athlete_id = $1', 'tss IS NOT NULL'];
  const values = [athleteId];

  if (from) { values.push(from); conditions.push(`activity_date >= $${values.length}`); }
  if (to)   { values.push(to);   conditions.push(`activity_date <= $${values.length}`); }

  values.push(limit);
  const result = await pool.query(`
    SELECT
      activity_date,
      tss,
      ctl_at_completion,
      atl_at_completion,
      tsb_at_completion,
      sport,
      duration_sec
    FROM completed_session
    WHERE ${conditions.join(' AND ')}
    ORDER BY activity_date ASC, start_time ASC
    LIMIT $${values.length}
  `, values);
  return result.rows;
}

// ---------------------------------------------------------------------------
// Field tests
// ---------------------------------------------------------------------------

/**
 * Returns field tests ordered by date descending.
 * Optionally filtered by sport and/or test_type.
 */
export async function getFieldTests(pool, athleteId, { sport, type } = {}) {
  const conditions = ['athlete_id = $1'];
  const values = [athleteId];

  if (sport) { values.push(sport); conditions.push(`sport = $${values.length}`); }
  if (type)  { values.push(type);  conditions.push(`test_type = $${values.length}`); }

  const result = await pool.query(`
    SELECT *
    FROM field_test
    WHERE ${conditions.join(' AND ')}
    ORDER BY test_date DESC
  `, values);
  return result.rows;
}

export async function createFieldTest(pool, athleteId, data) {
  const result = await pool.query(`
    INSERT INTO field_test (
      athlete_id, test_date, test_type, sport, methodology_id,
      ftp_watts, fthr_bpm, avg_power_20min, avg_hr_20min,
      vo2max_power_w, stamina_if,
      sprint_5s_peak_w, sprint_20s_avg_w,
      vdot_score, race_distance_m, race_time_sec,
      css_per_100m_sec, css_400m_time_sec, css_200m_time_sec,
      zones_updated, notes, garmin_activity_id
    )
    VALUES (
      $1,  $2,  $3,  $4,  $5,  $6,  $7,  $8,  $9,  $10,
      $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
      $21, $22
    )
    RETURNING *
  `, [
    athleteId,
    data.test_date,
    data.test_type,
    data.sport,
    data.methodology_id      ?? null,
    data.ftp_watts           ?? null,
    data.fthr_bpm            ?? null,
    data.avg_power_20min     ?? null,
    data.avg_hr_20min        ?? null,
    data.vo2max_power_w      ?? null,
    data.stamina_if          ?? null,
    data.sprint_5s_peak_w    ?? null,
    data.sprint_20s_avg_w    ?? null,
    data.vdot_score          ?? null,
    data.race_distance_m     ?? null,
    data.race_time_sec       ?? null,
    data.css_per_100m_sec    ?? null,
    data.css_400m_time_sec   ?? null,
    data.css_200m_time_sec   ?? null,
    false,                          // zones_updated set false on creation; recalculate sets it true
    data.notes               ?? null,
    data.garmin_activity_id  ?? null
  ]);
  return result.rows[0];
}

/**
 * Marks a field test as having triggered zone recalculation.
 * Called after POST /zones/recalculate succeeds.
 */
export async function markZonesUpdated(pool, testId) {
  const result = await pool.query(`
    UPDATE field_test
    SET zones_updated = true
    WHERE id = $1
    RETURNING *
  `, [testId]);
  return result.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Lab results
// ---------------------------------------------------------------------------

export async function getLabResults(pool, athleteId) {
  const result = await pool.query(`
    SELECT *
    FROM lab_result
    WHERE athlete_id = $1
    ORDER BY test_date DESC
  `, [athleteId]);
  return result.rows;
}

export async function createLabResult(pool, athleteId, data) {
  const result = await pool.query(`
    INSERT INTO lab_result (
      athlete_id, test_date, test_type, performed_by,
      report_file_url, structured_data, source, notes
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `, [
    athleteId,
    data.test_date,
    data.test_type,
    data.performed_by      ?? null,
    data.report_file_url   ?? null,
    data.structured_data   ? JSON.stringify(data.structured_data) : null,
    data.source            ?? 'upload',
    data.notes             ?? null
  ]);
  return result.rows[0];
}

// ---------------------------------------------------------------------------
// Daily health metrics (TimescaleDB hypertable)
// ---------------------------------------------------------------------------

/**
 * Returns daily metrics for a date range.
 * Queries by the DATE column rather than the TIMESTAMPTZ partition key
 * for readability — the unique index on (athlete_id, date) keeps this fast.
 */
export async function getDailyMetrics(pool, athleteId, { from, to } = {}) {
  const conditions = ['athlete_id = $1'];
  const values = [athleteId];

  if (from) { values.push(from); conditions.push(`date >= $${values.length}`); }
  if (to)   { values.push(to);   conditions.push(`date <= $${values.length}`); }

  const result = await pool.query(`
    SELECT *
    FROM daily_metrics
    WHERE ${conditions.join(' AND ')}
    ORDER BY date ASC
  `, values);
  return result.rows;
}

/**
 * Inserts a daily metrics record.
 * time column is set to midnight UTC of the given date to satisfy the hypertable
 * partition key requirement — TimescaleDB requires time in all unique constraints.
 * Plain INSERT; unique constraint violation (23505) → 409 handled in route.
 */
export async function createDailyMetrics(pool, athleteId, data) {
  const result = await pool.query(`
    INSERT INTO daily_metrics (
      time, athlete_id, date,
      hrv_nightly_avg, hrv_7day_avg, hrv_status,
      resting_hr,
      body_battery_morning, body_battery_min, body_battery_max,
      sleep_duration_hrs, sleep_score, sleep_deep_hrs, sleep_rem_hrs,
      sleep_light_hrs, sleep_awake_hrs, sleep_respiration_avg,
      spo2_avg, spo2_min,
      stress_avg, stress_rest_avg,
      skin_temp_deviation, readiness_score
    )
    VALUES (
      ($1::date)::timestamptz, $2, $1,
      $3,  $4,  $5,  $6,  $7,  $8,  $9,  $10, $11, $12, $13,
      $14, $15, $16, $17, $18, $19, $20, $21, $22
    )
    RETURNING *
  `, [
    data.date,
    athleteId,
    data.hrv_nightly_avg         ?? null,
    data.hrv_7day_avg            ?? null,
    data.hrv_status              ?? null,
    data.resting_hr              ?? null,
    data.body_battery_morning    ?? null,
    data.body_battery_min        ?? null,
    data.body_battery_max        ?? null,
    data.sleep_duration_hrs      ?? null,
    data.sleep_score             ?? null,
    data.sleep_deep_hrs          ?? null,
    data.sleep_rem_hrs           ?? null,
    data.sleep_light_hrs         ?? null,
    data.sleep_awake_hrs         ?? null,
    data.sleep_respiration_avg   ?? null,
    data.spo2_avg                ?? null,
    data.spo2_min                ?? null,
    data.stress_avg              ?? null,
    data.stress_rest_avg         ?? null,
    data.skin_temp_deviation     ?? null,
    data.readiness_score         ?? null
  ]);
  return result.rows[0];
}

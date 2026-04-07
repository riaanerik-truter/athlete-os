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
export async function getSnapshotHistory(pool, athleteId, { from, to, limit } = {}) {
  const conditions = ['athlete_id = $1'];
  const values = [athleteId];

  if (from) { values.push(from); conditions.push(`snapshot_date >= $${values.length}`); }
  if (to)   { values.push(to);   conditions.push(`snapshot_date <= $${values.length}`); }

  // When limit is given without from/to, return the most recent N rows ordered ASC
  const limitClause = (limit && !from && !to) ? `LIMIT ${Number(limit)}` : '';
  const orderDir    = (limit && !from && !to) ? 'DESC' : 'ASC';

  const result = await pool.query(`
    SELECT * FROM (
      SELECT
        snapshot_date::text AS snapshot_date,
        week_id,
        ctl, atl, tsb,
        ftp_current, w_per_kg, vdot_current, css_current_sec,
        ef_7day_avg, ef_trend, decoupling_last_long,
        resting_hr_avg, hrv_7day_avg, readiness_score,
        weekly_volume_hrs, weekly_tss, ytd_volume_hrs
      FROM fitness_snapshot
      WHERE ${conditions.join(' AND ')}
      ORDER BY snapshot_date ${orderDir}
      ${limitClause}
    ) sub
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
export async function getDailyMetrics(pool, athleteId, { from, to, limit } = {}) {
  const conditions = ['athlete_id = $1'];
  const values = [athleteId];

  if (from) { values.push(from); conditions.push(`date >= $${values.length}`); }
  if (to)   { values.push(to);   conditions.push(`date <= $${values.length}`); }

  // When limit is given without from/to, fetch the most recent N rows (order DESC, then re-sort ASC)
  if (limit && !from && !to) {
    values.push(Number(limit));
    const result = await pool.query(`
      SELECT * FROM (
        SELECT * FROM daily_metrics
        WHERE ${conditions.join(' AND ')}
        ORDER BY date DESC
        LIMIT $${values.length}
      ) sub
      ORDER BY date ASC
    `, values);
    return result.rows;
  }

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

// ---------------------------------------------------------------------------
// Ability scores
// ---------------------------------------------------------------------------

/**
 * Fetches all raw data needed to calculate Friel ability scores.
 * Returns sessions (8 weeks), snapshot history (10 entries), field tests, athlete, and stream max.
 */
export async function getAbilitiesData(pool, athleteId) {
  const [sessionsRes, snapshotHistRes, fieldTestRes, labRes, athleteRes, streamMaxRes] = await Promise.all([
    pool.query(`
      SELECT
        cs.id,
        cs.activity_date::text AS activity_date,
        cs.sport,
        cs.duration_sec,
        cs.avg_cadence,
        cs.variability_index,
        cs.intensity_factor_garmin,
        cs.avg_power_w,
        cs.normalized_power_w,
        cs.elevation_gain_m,
        cs.distance_m,
        cs.ef_garmin_calculated,
        cs.decoupling_pct,
        cs.zone_distribution,
        st.code AS session_type_code
      FROM completed_session cs
      LEFT JOIN session_type st ON st.id = cs.session_type_id
      WHERE cs.athlete_id = $1
        AND cs.activity_date >= CURRENT_DATE - INTERVAL '8 weeks'
      ORDER BY cs.activity_date ASC
    `, [athleteId]),

    pool.query(`
      SELECT
        snapshot_date::text AS snapshot_date,
        ef_7day_avg, decoupling_last_long, ef_trend, ctl, atl, tsb
      FROM fitness_snapshot
      WHERE athlete_id = $1
      ORDER BY snapshot_date DESC
      LIMIT 10
    `, [athleteId]),

    pool.query(`
      SELECT
        sprint_5s_peak_w, sprint_20s_avg_w, vo2max_power_w, avg_power_20min,
        test_date::text AS test_date
      FROM field_test
      WHERE athlete_id = $1 AND sport IN ('cycling', 'mtb')
      ORDER BY test_date DESC
      LIMIT 5
    `, [athleteId]),

    pool.query(`
      SELECT structured_data, test_date::text AS test_date
      FROM lab_result
      WHERE athlete_id = $1
        AND (test_type ILIKE '%vo2%' OR test_type ILIKE '%maximal%' OR test_type ILIKE '%lab%')
      ORDER BY test_date DESC
      LIMIT 1
    `, [athleteId]),

    pool.query(`SELECT ftp_watts, vdot, weight_kg FROM athlete LIMIT 1`),

    pool.query(`
      SELECT MAX(ws.power_w) AS max_power_1s
      FROM workout_stream ws
      JOIN completed_session cs ON cs.garmin_activity_id = ws.garmin_activity_id
      WHERE cs.athlete_id = $1
        AND cs.activity_date >= CURRENT_DATE - INTERVAL '8 weeks'
        AND ws.power_w IS NOT NULL
    `, [athleteId]),
  ]);

  return {
    sessions:        sessionsRes.rows,
    snapshotHistory: snapshotHistRes.rows,
    fieldTests:      fieldTestRes.rows,
    lab:             labRes.rows[0] ?? null,
    athlete:         athleteRes.rows[0] ?? null,
    maxPower1s:      streamMaxRes.rows[0]?.max_power_1s ?? null,
  };
}

// ---------------------------------------------------------------------------
// Zone distribution aggregation
// ---------------------------------------------------------------------------

/**
 * Aggregates zone_distribution JSONB from completed sessions for a date range and sport filter.
 */
export async function getZoneDistribution(pool, athleteId, { sports = [], from, to } = {}) {
  const conditions = ['cs.athlete_id = $1'];
  const values = [athleteId];

  if (from) { values.push(from); conditions.push(`cs.activity_date >= $${values.length}`); }
  if (to)   { values.push(to);   conditions.push(`cs.activity_date <= $${values.length}`); }
  if (sports.length > 0) {
    values.push(sports);
    conditions.push(`cs.sport = ANY($${values.length})`);
  }

  const result = await pool.query(`
    SELECT
      -- HR zones (Friel, Z1-Z5c)
      COALESCE(SUM((cs.zone_distribution->>'Z1')::float),  0) AS z1_sec,
      COALESCE(SUM((cs.zone_distribution->>'Z2')::float),  0) AS z2_sec,
      COALESCE(SUM((cs.zone_distribution->>'Z3')::float),  0) AS z3_sec,
      COALESCE(SUM((cs.zone_distribution->>'Z4')::float),  0) AS z4_sec,
      COALESCE(SUM((cs.zone_distribution->>'Z5a')::float), 0) AS z5a_sec,
      COALESCE(SUM((cs.zone_distribution->>'Z5b')::float), 0) AS z5b_sec,
      COALESCE(SUM((cs.zone_distribution->>'Z5c')::float), 0) AS z5c_sec,
      -- Power zones (Garmin pZ1-pZ6, Coggan-aligned)
      COALESCE(SUM((cs.zone_distribution->>'pZ1')::float), 0) AS pz1_sec,
      COALESCE(SUM((cs.zone_distribution->>'pZ2')::float), 0) AS pz2_sec,
      COALESCE(SUM((cs.zone_distribution->>'pZ3')::float), 0) AS pz3_sec,
      COALESCE(SUM((cs.zone_distribution->>'pZ4')::float), 0) AS pz4_sec,
      COALESCE(SUM((cs.zone_distribution->>'pZ5')::float), 0) AS pz5_sec,
      COALESCE(SUM((cs.zone_distribution->>'pZ6')::float), 0) AS pz6_sec,
      -- Daniels pace zones (running, E/M/T/I/R)
      COALESCE(SUM((cs.zone_distribution->>'E')::float),   0) AS e_sec,
      COALESCE(SUM((cs.zone_distribution->>'M')::float),   0) AS m_sec,
      COALESCE(SUM((cs.zone_distribution->>'T')::float),   0) AS t_sec,
      COALESCE(SUM((cs.zone_distribution->>'I')::float),   0) AS i_sec,
      COALESCE(SUM((cs.zone_distribution->>'R')::float),   0) AS r_sec,
      COUNT(*) FILTER (WHERE cs.zone_distribution IS NOT NULL) AS sessions_with_zones,
      COUNT(*)                                                  AS total_sessions,
      COALESCE(SUM(cs.duration_sec), 0)                        AS total_duration_sec
    FROM completed_session cs
    WHERE ${conditions.join(' AND ')}
  `, values);

  return result.rows[0] ?? {};
}

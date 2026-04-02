// DB queries: sessions
// Tables: planned_session, completed_session, session_score, workout_stream, lap_summary

// Fields the ingestion service is permitted to PATCH onto a completed session.
// garmin_activity_id, athlete_id, activity_date, start_time, end_time, sport are
// set on creation and never overwritten.
const COMPLETED_SESSION_UPDATABLE = new Set([
  // TrainingPeaks additive fields
  'tss', 'intensity_factor_tp', 'ef_trainingpeaks',
  'ctl_at_completion', 'atl_at_completion', 'tsb_at_completion',
  'compliance_score_tp', 'vi_tp',
  // Strava additive fields
  'strava_activity_id', 'strava_suffer_score', 'strava_relative_effort', 'segment_prs',
  // Ingestion-calculated fields
  'ef_garmin_calculated', 'ef_source_used', 'ef_source_reason',
  'zone_distribution', 'decoupling_pct', 'aerobic_ef',
  // Post-session assessment
  'rpe_actual', 'session_notes', 'goal_achieved', 'goal_deviation_notes',
  'actual_vs_planned_pct', 'planned_duration_min',
  // Links
  'planned_session_id', 'session_type_id'
]);

// ---------------------------------------------------------------------------
// Completed sessions
// ---------------------------------------------------------------------------

/**
 * Paginated list of completed sessions.
 * Returns rows with a total_count column for the route to build the pagination envelope.
 */
export async function getCompletedSessions(pool, athleteId, { sport, from, to, page = 1, limit = 20 } = {}) {
  const conditions = ['athlete_id = $1'];
  const values = [athleteId];

  if (sport) { values.push(sport);  conditions.push(`sport = $${values.length}`); }
  if (from)  { values.push(from);   conditions.push(`activity_date >= $${values.length}`); }
  if (to)    { values.push(to);     conditions.push(`activity_date <= $${values.length}`); }

  const offset = (page - 1) * limit;
  values.push(limit, offset);

  const result = await pool.query(`
    SELECT *, COUNT(*) OVER() AS total_count
    FROM completed_session
    WHERE ${conditions.join(' AND ')}
    ORDER BY activity_date DESC, start_time DESC
    LIMIT $${values.length - 1} OFFSET $${values.length}
  `, values);

  return result.rows;
}

/**
 * Single completed session by ID.
 */
export async function getCompletedSessionById(pool, athleteId, id) {
  const result = await pool.query(`
    SELECT *
    FROM completed_session
    WHERE id = $1 AND athlete_id = $2
  `, [id, athleteId]);
  return result.rows[0] ?? null;
}

/**
 * Creates a completed session record.
 * garmin_activity_id has a UNIQUE constraint — caller handles 23505 → 409.
 */
export async function createCompletedSession(pool, athleteId, data) {
  const result = await pool.query(`
    INSERT INTO completed_session (
      athlete_id, planned_session_id, session_type_id,
      activity_date, start_time, end_time, sport,
      garmin_activity_id, strava_activity_id, tp_workout_id, data_source_primary,
      duration_sec, distance_m, elevation_gain_m,
      avg_power_w, normalized_power_w, avg_hr, max_hr, avg_cadence,
      avg_speed_ms, variability_index, intensity_factor_garmin,
      tss, intensity_factor_tp, ef_trainingpeaks,
      ctl_at_completion, atl_at_completion, tsb_at_completion,
      compliance_score_tp, vi_tp,
      ef_garmin_calculated, ef_source_used, ef_source_reason,
      zone_distribution, decoupling_pct, aerobic_ef,
      strava_suffer_score, strava_relative_effort, segment_prs,
      rpe_actual, session_notes, goal_achieved, goal_deviation_notes,
      planned_duration_min, actual_vs_planned_pct
    )
    VALUES (
      $1,  $2,  $3,  $4,  $5,  $6,  $7,  $8,  $9,  $10,
      $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
      $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
      $31, $32, $33, $34, $35, $36, $37, $38, $39, $40,
      $41, $42, $43, $44, $45
    )
    RETURNING *
  `, [
    athleteId,
    data.planned_session_id        ?? null,
    data.session_type_id           ?? null,
    data.activity_date,
    data.start_time,
    data.end_time,
    data.sport,
    data.garmin_activity_id,
    data.strava_activity_id        ?? null,
    data.tp_workout_id             ?? null,
    data.data_source_primary       ?? 'garmin',
    data.duration_sec,
    data.distance_m                ?? null,
    data.elevation_gain_m          ?? null,
    data.avg_power_w               ?? null,
    data.normalized_power_w        ?? null,
    data.avg_hr                    ?? null,
    data.max_hr                    ?? null,
    data.avg_cadence               ?? null,
    data.avg_speed_ms              ?? null,
    data.variability_index         ?? null,
    data.intensity_factor_garmin   ?? null,
    data.tss                       ?? null,
    data.intensity_factor_tp       ?? null,
    data.ef_trainingpeaks          ?? null,
    data.ctl_at_completion         ?? null,
    data.atl_at_completion         ?? null,
    data.tsb_at_completion         ?? null,
    data.compliance_score_tp       ?? null,
    data.vi_tp                     ?? null,
    data.ef_garmin_calculated      ?? null,
    data.ef_source_used            ?? null,
    data.ef_source_reason          ?? null,
    data.zone_distribution         ? JSON.stringify(data.zone_distribution) : null,
    data.decoupling_pct            ?? null,
    data.aerobic_ef                ?? null,
    data.strava_suffer_score       ?? null,
    data.strava_relative_effort    ?? null,
    data.segment_prs               ? JSON.stringify(data.segment_prs) : null,
    data.rpe_actual                ?? null,
    data.session_notes             ?? null,
    data.goal_achieved             ?? null,
    data.goal_deviation_notes      ?? null,
    data.planned_duration_min      ?? null,
    data.actual_vs_planned_pct     ?? null
  ]);
  return result.rows[0];
}

/**
 * Partial update of a completed session.
 * Used by ingestion service to write TP or Strava fields after initial Garmin sync.
 */
export async function updateCompletedSession(pool, athleteId, id, fields) {
  const keys = Object.keys(fields).filter(k => COMPLETED_SESSION_UPDATABLE.has(k));
  if (keys.length === 0) return getCompletedSessionById(pool, athleteId, id);

  // JSONB fields must be serialised
  const JSONB_FIELDS = new Set(['zone_distribution', 'segment_prs']);
  const setClauses = keys.map((k, i) => `${k} = $${i + 3}`);
  const values = [
    id,
    athleteId,
    ...keys.map(k => JSONB_FIELDS.has(k) && fields[k] != null ? JSON.stringify(fields[k]) : fields[k])
  ];

  const result = await pool.query(`
    UPDATE completed_session
    SET ${setClauses.join(', ')}, updated_at = now()
    WHERE id = $1 AND athlete_id = $2
    RETURNING *
  `, values);
  return result.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Workout stream
// ---------------------------------------------------------------------------

/**
 * Returns the raw workout stream for a session.
 * resolution=N returns every Nth row, reducing payload for charting.
 * resolution=1 returns all rows.
 */
export async function getWorkoutStream(pool, garminActivityId, resolution = 1) {
  const result = await pool.query(`
    SELECT time, power_w, hr_bpm, cadence_rpm, speed_ms,
           elevation_m, distance_m, left_power_pct, right_power_pct
    FROM (
      SELECT *, ROW_NUMBER() OVER (ORDER BY time) AS rn
      FROM workout_stream
      WHERE garmin_activity_id = $1
    ) sub
    WHERE rn % $2 = 1
    ORDER BY time
  `, [garminActivityId, resolution]);
  return result.rows;
}

/**
 * Inserts a batch of workout_stream rows for a session.
 * Uses a single multi-row INSERT for efficiency.
 * Skips rows where time is null.
 *
 * @param {object} pool
 * @param {string} athleteId
 * @param {string} garminActivityId
 * @param {object[]} rows - Array of stream row objects
 * @returns {Promise<number>} Number of rows inserted
 */
export async function insertWorkoutStream(pool, athleteId, garminActivityId, rows) {
  const valid = rows.filter(r => r.time != null);
  if (!valid.length) return 0;

  // Build parameterised multi-row insert in chunks of 500 to avoid pg parameter limit
  const CHUNK = 500;
  let inserted = 0;

  for (let i = 0; i < valid.length; i += CHUNK) {
    const chunk = valid.slice(i, i + CHUNK);
    const values = [];
    const params = [];
    let p = 1;

    for (const row of chunk) {
      params.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`);
      values.push(
        row.time,
        athleteId,
        garminActivityId,
        row.power_w      ?? null,
        row.hr_bpm       ?? null,
        row.cadence_rpm  ?? null,
        row.speed_ms     ?? null,
        row.elevation_m  ?? null,
        row.latitude     ?? null,
        row.longitude    ?? null,
        row.distance_m   ?? null,
      );
    }

    await pool.query(`
      INSERT INTO workout_stream
        (time, athlete_id, garmin_activity_id, power_w, hr_bpm, cadence_rpm,
         speed_ms, elevation_m, latitude, longitude, distance_m)
      VALUES ${params.join(',')}
      ON CONFLICT DO NOTHING
    `, values);

    inserted += chunk.length;
  }

  return inserted;
}

// ---------------------------------------------------------------------------
// Session scores
// ---------------------------------------------------------------------------

/**
 * Returns the session_score row for a completed session.
 */
export async function getSessionScore(pool, completedSessionId) {
  const result = await pool.query(`
    SELECT *
    FROM session_score
    WHERE completed_session_id = $1
  `, [completedSessionId]);
  return result.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Planned sessions
// ---------------------------------------------------------------------------

/**
 * Returns planned sessions filtered by date range and/or status.
 */
export async function getPlannedSessions(pool, athleteId, { from, to, status } = {}) {
  const conditions = ['athlete_id = $1'];
  const values = [athleteId];

  if (from)   { values.push(from);   conditions.push(`scheduled_date >= $${values.length}`); }
  if (to)     { values.push(to);     conditions.push(`scheduled_date <= $${values.length}`); }
  if (status) { values.push(status); conditions.push(`status = $${values.length}`); }

  const result = await pool.query(`
    SELECT *
    FROM planned_session
    WHERE ${conditions.join(' AND ')}
    ORDER BY scheduled_date ASC
  `, values);
  return result.rows;
}

/**
 * Returns all planned sessions belonging to a week.
 * Called by the /weeks/current route to populate the sessions array.
 */
export async function getPlannedSessionsByWeek(pool, athleteId, weekId) {
  const result = await pool.query(`
    SELECT *
    FROM planned_session
    WHERE athlete_id = $1 AND week_id = $2
    ORDER BY scheduled_date ASC
  `, [athleteId, weekId]);
  return result.rows;
}

/**
 * Returns a single planned session by ID.
 * Used by GET /sessions/:id to populate the planned_session summary.
 */
export async function getPlannedSessionById(pool, athleteId, id) {
  const result = await pool.query(`
    SELECT *
    FROM planned_session
    WHERE id = $1 AND athlete_id = $2
  `, [id, athleteId]);
  return result.rows[0] ?? null;
}

export async function createPlannedSession(pool, athleteId, data) {
  const result = await pool.query(`
    INSERT INTO planned_session (
      athlete_id, week_id, session_type_id, scheduled_date, sport, title,
      description, goal, block_objective_link, target_zone,
      target_duration_min, target_tss, target_score, target_metric,
      target_metric_value, intensity_dist_target, tp_workout_id,
      status, priority, created_by
    )
    VALUES (
      $1,  $2,  $3,  $4,  $5,  $6,  $7,  $8,  $9,  $10,
      $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
    )
    RETURNING *
  `, [
    athleteId,
    data.week_id                 ?? null,
    data.session_type_id         ?? null,
    data.scheduled_date,
    data.sport,
    data.title,
    data.description             ?? null,
    data.goal                    ?? null,
    data.block_objective_link    ?? null,
    data.target_zone             ?? null,
    data.target_duration_min     ?? null,
    data.target_tss              ?? null,
    data.target_score            ?? null,
    data.target_metric           ?? null,
    data.target_metric_value     ?? null,
    data.intensity_dist_target   ? JSON.stringify(data.intensity_dist_target) : null,
    data.tp_workout_id           ?? null,
    data.status                  ?? 'scheduled',
    data.priority                ?? 'normal',
    data.created_by              ?? 'coach'
  ]);
  return result.rows[0];
}


// ---------------------------------------------------------------------------
// Session scoring
// ---------------------------------------------------------------------------

/**
 * Upserts a session_score row for a completed session.
 * Called by POST /diary/:date/score after the scoring engine runs.
 * One score row per completed session — ON CONFLICT replaces all score fields.
 */
export async function upsertSessionScore(pool, athleteId, completedSessionId, data) {
  const result = await pool.query(`
    INSERT INTO session_score (
      athlete_id, completed_session_id, methodology_id,
      tss, friel_score, daniels_points, weekly_points_total, score_breakdown
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (completed_session_id) DO UPDATE SET
      methodology_id       = EXCLUDED.methodology_id,
      tss                  = EXCLUDED.tss,
      friel_score          = EXCLUDED.friel_score,
      daniels_points       = EXCLUDED.daniels_points,
      weekly_points_total  = EXCLUDED.weekly_points_total,
      score_breakdown      = EXCLUDED.score_breakdown
    RETURNING *
  `, [
    athleteId,
    completedSessionId,
    data.methodology_id       ?? null,
    data.tss                  ?? null,
    data.friel_score          ?? null,
    data.daniels_points       ?? null,
    data.weekly_points_total  ?? null,
    data.score_breakdown      ? JSON.stringify(data.score_breakdown) : null
  ]);
  return result.rows[0];
}

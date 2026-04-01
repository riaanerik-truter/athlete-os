// DB queries: season and planning
// Tables: season, goal, period, week, strength_phase

const GOAL_UPDATABLE = new Set([
  'type', 'priority', 'title', 'description',
  'event_date', 'event_name', 'event_distance', 'event_sport',
  'target_metric', 'target_value', 'target_unit', 'status'
]);

// ---------------------------------------------------------------------------
// Season
// ---------------------------------------------------------------------------

/**
 * Returns the season whose date range covers today.
 * Falls back to the most recently created season if none covers today.
 */
export async function getActiveSeason(pool, athleteId) {
  const result = await pool.query(`
    SELECT *
    FROM season
    WHERE athlete_id = $1
      AND deleted_at IS NULL
    ORDER BY
      CASE WHEN start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE THEN 0 ELSE 1 END,
      created_at DESC
    LIMIT 1
  `, [athleteId]);
  return result.rows[0] ?? null;
}

/**
 * Returns all periods belonging to a season, ordered by start_date.
 * Used to populate the `periods` array on the season response.
 */
export async function getPeriodsBySeason(pool, athleteId, seasonId) {
  const result = await pool.query(`
    SELECT *
    FROM period
    WHERE athlete_id = $1
      AND season_id = $2
    ORDER BY start_date ASC
  `, [athleteId, seasonId]);
  return result.rows;
}

export async function createSeason(pool, athleteId, data) {
  const result = await pool.query(`
    INSERT INTO season (athlete_id, name, year, start_date, end_date, primary_goal, notes)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `, [
    athleteId,
    data.name,
    data.year,
    data.start_date,
    data.end_date,
    data.primary_goal ?? null,
    data.notes        ?? null
  ]);
  return result.rows[0];
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

/**
 * Returns goals for the athlete. Optionally filter by status and/or type.
 */
export async function getGoals(pool, athleteId, { status, type } = {}) {
  const conditions = ['athlete_id = $1', 'deleted_at IS NULL'];
  const values = [athleteId];

  if (status) {
    values.push(status);
    conditions.push(`status = $${values.length}`);
  }
  if (type) {
    values.push(type);
    conditions.push(`type = $${values.length}`);
  }

  const result = await pool.query(`
    SELECT *
    FROM goal
    WHERE ${conditions.join(' AND ')}
    ORDER BY event_date ASC NULLS LAST, created_at ASC
  `, values);
  return result.rows;
}

export async function createGoal(pool, athleteId, data) {
  const result = await pool.query(`
    INSERT INTO goal (
      athlete_id, season_id, type, priority, title, description,
      event_date, event_name, event_distance, event_sport,
      target_metric, target_value, target_unit
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING *
  `, [
    athleteId,
    data.season_id      ?? null,
    data.type,
    data.priority       ?? null,
    data.title,
    data.description    ?? null,
    data.event_date     ?? null,
    data.event_name     ?? null,
    data.event_distance ?? null,
    data.event_sport    ?? null,
    data.target_metric  ?? null,
    data.target_value   ?? null,
    data.target_unit    ?? null
  ]);
  return result.rows[0];
}

/**
 * Partial update of a goal.
 * revisionEntry — optional { date, reason, old_value, new_value } object appended to revision_log.
 */
export async function updateGoal(pool, athleteId, goalId, fields, revisionEntry = null) {
  const keys = Object.keys(fields).filter(k => GOAL_UPDATABLE.has(k));

  // $1 = goalId, $2 = athleteId, $3...$N = field values
  const values = [goalId, athleteId, ...keys.map(k => fields[k])];
  const setClauses = keys.map((k, i) => `${k} = $${i + 3}`);

  if (revisionEntry) {
    values.push(JSON.stringify(revisionEntry));
    setClauses.push(
      `revision_log = revision_log || jsonb_build_array($${values.length}::jsonb)`
    );
  }

  if (setClauses.length === 0) {
    const r = await pool.query(
      'SELECT * FROM goal WHERE id = $1 AND athlete_id = $2 AND deleted_at IS NULL',
      [goalId, athleteId]
    );
    return r.rows[0] ?? null;
  }

  setClauses.push('updated_at = now()');

  const result = await pool.query(`
    UPDATE goal
    SET ${setClauses.join(', ')}
    WHERE id = $1 AND athlete_id = $2 AND deleted_at IS NULL
    RETURNING *
  `, values);
  return result.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

/**
 * Returns all periods for the current active season.
 * Pass seasonId to scope to a specific season.
 */
export async function getPeriods(pool, athleteId, seasonId = null) {
  const conditions = ['p.athlete_id = $1'];
  const values = [athleteId];

  if (seasonId) {
    values.push(seasonId);
    conditions.push(`p.season_id = $${values.length}`);
  }

  const result = await pool.query(`
    SELECT p.*
    FROM period p
    WHERE ${conditions.join(' AND ')}
    ORDER BY p.start_date ASC
  `, values);
  return result.rows;
}

export async function createPeriod(pool, athleteId, data) {
  const result = await pool.query(`
    INSERT INTO period (
      athlete_id, season_id, methodology_id, name, period_type, sub_period,
      start_date, end_date, objective, intensity_dist_type,
      planned_weekly_hrs, target_ctl_end, strength_phase, progression_gate, notes
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    RETURNING *
  `, [
    athleteId,
    data.season_id,
    data.methodology_id      ?? null,
    data.name,
    data.period_type,
    data.sub_period          ?? null,
    data.start_date,
    data.end_date,
    data.objective           ?? null,
    data.intensity_dist_type ?? null,
    data.planned_weekly_hrs  ?? null,
    data.target_ctl_end      ?? null,
    data.strength_phase      ?? null,
    data.progression_gate    ? JSON.stringify(data.progression_gate) : null,
    data.notes               ?? null
  ]);
  return result.rows[0];
}

// ---------------------------------------------------------------------------
// Weeks
// ---------------------------------------------------------------------------

/**
 * Returns all weeks within a period, ordered by start_date.
 */
export async function getWeeksByPeriod(pool, athleteId, periodId) {
  const result = await pool.query(`
    SELECT *
    FROM week
    WHERE athlete_id = $1 AND period_id = $2
    ORDER BY start_date ASC
  `, [athleteId, periodId]);
  return result.rows;
}

/**
 * Returns the period whose date range contains today.
 * Returns null if no period is currently active.
 */
export async function getCurrentPeriod(pool, athleteId) {
  const result = await pool.query(`
    SELECT *
    FROM period
    WHERE athlete_id = $1
      AND start_date <= CURRENT_DATE
      AND end_date >= CURRENT_DATE
    LIMIT 1
  `, [athleteId]);
  return result.rows[0] ?? null;
}

/**
 * Returns the week whose date range contains today.
 * Returns null if no week is currently active.
 */
export async function getCurrentWeek(pool, athleteId) {
  const result = await pool.query(`
    SELECT *
    FROM week
    WHERE athlete_id = $1
      AND start_date <= CURRENT_DATE
      AND end_date >= CURRENT_DATE
    LIMIT 1
  `, [athleteId]);
  return result.rows[0] ?? null;
}

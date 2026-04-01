// DB queries: ingestion and sync
// Tables: sync_state, methodology, session_type

// ---------------------------------------------------------------------------
// Athlete ID helper
// ---------------------------------------------------------------------------

/**
 * Returns the single athlete's UUID.
 * Lightweight alternative to getAthlete() when only the ID is needed.
 * All other db modules call this rather than importing from db/athlete.js
 * to avoid circular dependency risk.
 */
export async function getAthleteId(pool) {
  const result = await pool.query(`
    SELECT id FROM athlete WHERE deleted_at IS NULL LIMIT 1
  `);
  return result.rows[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// Sync state
// ---------------------------------------------------------------------------

/**
 * Returns all sync_state rows for the athlete.
 */
export async function getSyncStatus(pool, athleteId) {
  const result = await pool.query(`
    SELECT *
    FROM sync_state
    WHERE athlete_id = $1
    ORDER BY source ASC
  `, [athleteId]);
  return result.rows;
}

/**
 * Upserts a sync_state row for a given source.
 * Unique index is on (athlete_id, source) — safe to call after every sync job.
 */
export async function upsertSyncState(pool, athleteId, source, data) {
  const result = await pool.query(`
    INSERT INTO sync_state (athlete_id, source, last_synced_at, last_item_id, sync_status,
                            error_message, error_count, next_sync_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (athlete_id, source) DO UPDATE SET
      last_synced_at = EXCLUDED.last_synced_at,
      last_item_id   = EXCLUDED.last_item_id,
      sync_status    = EXCLUDED.sync_status,
      error_message  = EXCLUDED.error_message,
      error_count    = CASE
                         WHEN EXCLUDED.sync_status = 'error'
                         THEN sync_state.error_count + 1
                         ELSE 0
                       END,
      next_sync_at   = EXCLUDED.next_sync_at,
      updated_at     = now()
    RETURNING *
  `, [
    athleteId,
    source,
    data.last_synced_at ?? null,
    data.last_item_id   ?? null,
    data.sync_status    ?? 'pending',
    data.error_message  ?? null,
    0,                           // initial error_count; incremented by CASE on conflict
    data.next_sync_at   ?? null
  ]);
  return result.rows[0];
}

/**
 * Returns a single sync_state row by source name.
 * Used by PATCH /sync/status/:source to confirm the source exists before updating.
 */
export async function getSyncStateBySource(pool, athleteId, source) {
  const result = await pool.query(`
    SELECT *
    FROM sync_state
    WHERE athlete_id = $1 AND source = $2
  `, [athleteId, source]);
  return result.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Methodologies (reference table — no athlete_id)
// ---------------------------------------------------------------------------

export async function getMethodologies(pool) {
  const result = await pool.query(`
    SELECT *
    FROM methodology
    ORDER BY name ASC
  `);
  return result.rows;
}

// ---------------------------------------------------------------------------
// Session types (reference table — no athlete_id)
// ---------------------------------------------------------------------------

/**
 * Returns session types filtered by sport, methodology_id, and/or ability_category.
 */
export async function getSessionTypes(pool, { sport, methodologyId, ability } = {}) {
  const conditions = [];
  const values = [];

  if (sport) {
    values.push(sport);
    conditions.push(`sport = $${values.length}`);
  }
  if (methodologyId) {
    values.push(methodologyId);
    conditions.push(`methodology_id = $${values.length}`);
  }
  if (ability) {
    values.push(ability);
    conditions.push(`ability_category = $${values.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await pool.query(`
    SELECT *
    FROM session_type
    ${where}
    ORDER BY sport ASC, code ASC
  `, values);
  return result.rows;
}

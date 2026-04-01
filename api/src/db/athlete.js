// DB queries: athlete
// Tables: athlete, zone_model

// Fields permitted in a PATCH /athlete update.
// id, created_at, updated_at, deleted_at are never client-updatable.
const UPDATABLE_FIELDS = new Set([
  'name', 'email', 'date_of_birth', 'sex', 'weight_kg', 'height_cm',
  'primary_sport', 'active_sports', 'active_methodology_id',
  'ftp_watts', 'fthr_cycling', 'fthr_running', 'css_per_100m_sec',
  'vdot', 'max_hr', 'weekly_run_volume_km', 'limiter', 'strengths',
  'known_injuries', 'medications', 'blood_type', 'garmin_user_id',
  'strava_athlete_id', 'tp_athlete_id', 'whatsapp_number', 'timezone',
  'conversation_summary'
]);

/**
 * Returns the single athlete row joined with methodology name.
 * Single-athlete system — no ID parameter.
 */
export async function getAthlete(pool) {
  const result = await pool.query(`
    SELECT
      a.*,
      m.name AS methodology_name
    FROM athlete a
    LEFT JOIN methodology m ON m.id = a.active_methodology_id
    WHERE a.deleted_at IS NULL
    LIMIT 1
  `);
  return result.rows[0] ?? null;
}

/**
 * Inserts a new athlete record. Returns the created row.
 * Rejects if a non-deleted athlete already exists.
 */
export async function createAthlete(pool, fields) {
  const INSERTABLE = new Set([...UPDATABLE_FIELDS]);
  INSERTABLE.delete('conversation_summary'); // not a creation field

  const keys = ['name', ...Object.keys(fields).filter(k => k !== 'name' && INSERTABLE.has(k))];
  const values = keys.map(k => fields[k]);
  const placeholders = keys.map((_, i) => `$${i + 1}`);

  const result = await pool.query(`
    INSERT INTO athlete (${keys.join(', ')})
    VALUES (${placeholders.join(', ')})
    RETURNING *
  `, values);

  return result.rows[0];
}

/**
 * Partial update of athlete profile.
 * Only keys present in UPDATABLE_FIELDS are applied.
 * Returns the updated row.
 */
export async function updateAthlete(pool, fields) {
  const keys = Object.keys(fields).filter(k => UPDATABLE_FIELDS.has(k));
  if (keys.length === 0) return getAthlete(pool);

  const setClauses = keys.map((k, i) => `${k} = $${i + 1}`);
  const values = keys.map(k => fields[k]);

  const result = await pool.query(`
    UPDATE athlete
    SET ${setClauses.join(', ')}, updated_at = now()
    WHERE deleted_at IS NULL
    RETURNING *
  `, values);

  return result.rows[0] ?? null;
}

/**
 * Returns all active zone_model rows for the athlete, newest first.
 * effective_to IS NULL means currently active.
 */
export async function getActiveZones(pool, athleteId) {
  const result = await pool.query(`
    SELECT *
    FROM zone_model
    WHERE athlete_id = $1
      AND effective_to IS NULL
    ORDER BY sport ASC
  `, [athleteId]);
  return result.rows;
}

/**
 * Inserts a new zone_model row and closes the previous active row for that sport.
 * Called by POST /zones/recalculate.
 */
export async function replaceZoneModel(pool, athleteId, sport, data) {
  // Close the current active zone model for this sport
  await pool.query(`
    UPDATE zone_model
    SET effective_to = CURRENT_DATE
    WHERE athlete_id = $1
      AND sport = $2
      AND effective_to IS NULL
  `, [athleteId, sport]);

  const result = await pool.query(`
    INSERT INTO zone_model (
      athlete_id, methodology_id, sport,
      anchor_metric, anchor_value, effective_from,
      zones, css_per_100m_sec, vdot_score, pace_zones
    )
    VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, $7, $8, $9)
    RETURNING *
  `, [
    athleteId,
    data.methodology_id,
    sport,
    data.anchor_metric,
    data.anchor_value,
    JSON.stringify(data.zones),
    data.css_per_100m_sec ?? null,
    data.vdot_score        ?? null,
    data.pace_zones ? JSON.stringify(data.pace_zones) : null
  ]);

  return result.rows[0];
}

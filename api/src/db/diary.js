// DB queries: diary and coaching
// Tables: diary_entry, conversation, notification_log

// ---------------------------------------------------------------------------
// Diary entries
// ---------------------------------------------------------------------------

/**
 * Returns diary entries newest-first with total_count for pagination envelope.
 */
export async function getDiaryEntries(pool, athleteId, { from, to, page = 1, limit = 20 } = {}) {
  const conditions = ['athlete_id = $1'];
  const values = [athleteId];

  if (from) { values.push(from); conditions.push(`entry_date >= $${values.length}`); }
  if (to)   { values.push(to);   conditions.push(`entry_date <= $${values.length}`); }

  const offset = (page - 1) * limit;
  values.push(limit, offset);

  const result = await pool.query(`
    SELECT *, COUNT(*) OVER() AS total_count
    FROM diary_entry
    WHERE ${conditions.join(' AND ')}
    ORDER BY entry_date DESC
    LIMIT $${values.length - 1} OFFSET $${values.length}
  `, values);
  return result.rows;
}

/**
 * Returns a single diary entry for a specific date (YYYY-MM-DD).
 */
export async function getDiaryEntryByDate(pool, athleteId, date) {
  const result = await pool.query(`
    SELECT *
    FROM diary_entry
    WHERE athlete_id = $1 AND entry_date = $2
  `, [athleteId, date]);
  return result.rows[0] ?? null;
}

/**
 * Upsert a diary entry. One row per athlete per day — enforced by unique index.
 * All athlete-writable fields are updated on conflict.
 * Coach fields (coach_summary, coach_flags, coach_recommendations) are excluded here
 * and written only by updateDiaryCoachFields.
 */
export async function upsertDiaryEntry(pool, athleteId, data) {
  const result = await pool.query(`
    INSERT INTO diary_entry (
      athlete_id, entry_date, completed_session_id,
      rpe_overall, wellness_score, sleep_quality,
      motivation_score, soreness_score, stress_life,
      session_reflection, daily_notes
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (athlete_id, entry_date) DO UPDATE SET
      completed_session_id = EXCLUDED.completed_session_id,
      rpe_overall          = EXCLUDED.rpe_overall,
      wellness_score       = EXCLUDED.wellness_score,
      sleep_quality        = EXCLUDED.sleep_quality,
      motivation_score     = EXCLUDED.motivation_score,
      soreness_score       = EXCLUDED.soreness_score,
      stress_life          = EXCLUDED.stress_life,
      session_reflection   = EXCLUDED.session_reflection,
      daily_notes          = EXCLUDED.daily_notes,
      updated_at           = now()
    RETURNING *, (xmax = 0) AS inserted
  `, [
    athleteId,
    data.entry_date,
    data.completed_session_id ?? null,
    data.rpe_overall          ?? null,
    data.wellness_score       ?? null,
    data.sleep_quality        ?? null,
    data.motivation_score     ?? null,
    data.soreness_score       ?? null,
    data.stress_life          ?? null,
    data.session_reflection   ?? null,
    data.daily_notes          ?? null
  ]);
  return result.rows[0];
}

/**
 * Updates the coach-generated fields on a diary entry.
 * Called by PATCH /diary/:date/coach (coaching engine only).
 */
export async function updateDiaryCoachFields(pool, athleteId, date, data) {
  const result = await pool.query(`
    UPDATE diary_entry
    SET
      coach_summary         = $3,
      coach_flags           = $4,
      coach_recommendations = $5,
      updated_at            = now()
    WHERE athlete_id = $1 AND entry_date = $2
    RETURNING *
  `, [
    athleteId,
    date,
    data.coach_summary          ?? null,
    data.coach_flags            ?? null,
    data.coach_recommendations  ?? null
  ]);
  return result.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

/**
 * Returns conversation messages newest-first.
 * limit defaults to 20 — caller sets higher for coaching engine context windows.
 */
export async function getConversations(pool, athleteId, { limit = 20 } = {}) {
  const result = await pool.query(`
    SELECT *
    FROM conversation
    WHERE athlete_id = $1
    ORDER BY message_ts DESC
    LIMIT $2
  `, [athleteId, limit]);
  return result.rows;
}

export async function createConversation(pool, athleteId, data) {
  const result = await pool.query(`
    INSERT INTO conversation (
      athlete_id, role, content, message_ts, channel,
      intent, linked_session_id, linked_goal_id, metadata
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
  `, [
    athleteId,
    data.role,
    data.content,
    data.message_ts,
    data.channel            ?? 'whatsapp',
    data.intent             ?? null,
    data.linked_session_id  ?? null,
    data.linked_goal_id     ?? null,
    data.metadata           ? JSON.stringify(data.metadata) : null
  ]);
  return result.rows[0];
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/**
 * Returns notification log entries newest-first.
 * unread=true filters to rows where read_at IS NULL.
 */
export async function getNotifications(pool, athleteId, { limit = 10, unread = false } = {}) {
  const conditions = ['athlete_id = $1'];
  const values = [athleteId];

  if (unread) conditions.push('read_at IS NULL');

  values.push(limit);

  const result = await pool.query(`
    SELECT *
    FROM notification_log
    WHERE ${conditions.join(' AND ')}
    ORDER BY sent_at DESC
    LIMIT $${values.length}
  `, values);
  return result.rows;
}

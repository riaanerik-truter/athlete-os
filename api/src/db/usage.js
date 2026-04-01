// DB queries: API usage log
// Table: api_usage_log

/**
 * Inserts a usage log row. Called by the coaching engine after each AI API call.
 */
export async function logApiUsage(pool, athleteId, data) {
  const result = await pool.query(`
    INSERT INTO api_usage_log (
      athlete_id, service, call_type, model,
      input_tokens, output_tokens, cost_usd, currency,
      context_mode, engine_mode, metadata
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *
  `, [
    athleteId,
    data.service,
    data.call_type,
    data.model           ?? null,
    data.input_tokens    ?? null,
    data.output_tokens   ?? null,
    data.cost_usd,
    data.currency        ?? 'USD',
    data.context_mode    ?? null,
    data.engine_mode     ?? null,
    data.metadata        ? JSON.stringify(data.metadata) : null
  ]);
  return result.rows[0];
}

/**
 * Aggregated usage summary grouped by period (all-time, current month, last 30 days).
 * Returns cost totals and token totals by service and model.
 */
export async function getUsageSummary(pool, athleteId) {
  const result = await pool.query(`
    SELECT
      SUM(cost_usd)                                                         AS total_cost_usd,
      SUM(CASE WHEN called_at >= date_trunc('month', now()) THEN cost_usd ELSE 0 END) AS mtd_cost_usd,
      SUM(CASE WHEN called_at >= now() - INTERVAL '30 days'  THEN cost_usd ELSE 0 END) AS last30_cost_usd,
      SUM(input_tokens)                                                     AS total_input_tokens,
      SUM(output_tokens)                                                    AS total_output_tokens,
      COUNT(*)                                                              AS total_calls
    FROM api_usage_log
    WHERE athlete_id = $1
  `, [athleteId]);

  const byService = await pool.query(`
    SELECT service, SUM(cost_usd) AS cost_usd, COUNT(*) AS calls
    FROM api_usage_log
    WHERE athlete_id = $1
    GROUP BY service
    ORDER BY cost_usd DESC
  `, [athleteId]);

  const byModel = await pool.query(`
    SELECT model, SUM(cost_usd) AS cost_usd, SUM(input_tokens) AS input_tokens,
           SUM(output_tokens) AS output_tokens, COUNT(*) AS calls
    FROM api_usage_log
    WHERE athlete_id = $1 AND model IS NOT NULL
    GROUP BY model
    ORDER BY cost_usd DESC
  `, [athleteId]);

  return {
    summary:    result.rows[0],
    by_service: byService.rows,
    by_model:   byModel.rows
  };
}

/**
 * Paginated usage history, newest first.
 * Optional filters: from, to, service.
 */
export async function getUsageHistory(pool, athleteId, { from, to, service, page = 1, limit = 50 } = {}) {
  const conditions = ['athlete_id = $1'];
  const values = [athleteId];

  if (from)    { values.push(from);    conditions.push(`called_at >= $${values.length}`); }
  if (to)      { values.push(to);      conditions.push(`called_at <= $${values.length}`); }
  if (service) { values.push(service); conditions.push(`service = $${values.length}`); }

  const offset = (page - 1) * limit;
  values.push(limit, offset);

  const result = await pool.query(`
    SELECT *, COUNT(*) OVER() AS total_count
    FROM api_usage_log
    WHERE ${conditions.join(' AND ')}
    ORDER BY called_at DESC
    LIMIT $${values.length - 1} OFFSET $${values.length}
  `, values);

  return result.rows;
}

/**
 * Calculates projected monthly cost from the last 30 days of usage.
 * Returns daily_avg_cost, projected_month_cost, and day counts.
 */
export async function getUsagePrediction(pool, athleteId) {
  const result = await pool.query(`
    SELECT
      COUNT(DISTINCT called_at::date)                              AS active_days,
      SUM(cost_usd)                                                AS cost_30d,
      SUM(cost_usd) / NULLIF(COUNT(DISTINCT called_at::date), 0)  AS daily_avg_cost,
      SUM(cost_usd) / NULLIF(COUNT(DISTINCT called_at::date), 0) * 30 AS projected_month_cost
    FROM api_usage_log
    WHERE athlete_id = $1
      AND called_at >= now() - INTERVAL '30 days'
  `, [athleteId]);

  return result.rows[0];
}

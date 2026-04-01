/**
 * Group: API Usage
 * Endpoints: GET /usage/summary, GET /usage/history, GET /usage/predicted
 *
 * Manual verification:
 * - GET /usage/summary returns totals (all-time, MTD, last 30 days) and breakdowns by service and model
 * - GET /usage/history returns paginated log rows newest-first
 * - GET /usage/history?service=anthropic filters to that service
 * - GET /usage/history?from=2026-03-01&to=2026-03-31 filters by date range
 * - GET /usage/predicted returns projected monthly cost based on last 30 days
 * - All endpoints return empty/zero state when no usage has been logged yet
 */

import { Router } from 'express';
import { pool } from '../db/pool.js';
import { getAthleteId } from '../db/sync.js';
import { getUsageSummary, getUsageHistory, getUsagePrediction } from '../db/usage.js';

const router = Router();

function notFound(res, message) {
  return res.status(404).json({ error: { code: 'NOT_FOUND', message, field: null } });
}

function num(v) {
  return v !== null && v !== undefined ? Number(v) : null;
}

function clampLimit(raw, defaultVal = 50, max = 200) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return defaultVal;
  return Math.min(n, max);
}

// ---------------------------------------------------------------------------
// GET /usage/summary
// ---------------------------------------------------------------------------

router.get('/usage/summary', async (req, res, next) => {
  try {
    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const data = await getUsageSummary(pool, athleteId);

    res.json({
      totals: {
        all_time_cost_usd:  num(data.summary.total_cost_usd)    ?? 0,
        mtd_cost_usd:       num(data.summary.mtd_cost_usd)      ?? 0,
        last30_cost_usd:    num(data.summary.last30_cost_usd)   ?? 0,
        total_input_tokens: num(data.summary.total_input_tokens) ?? 0,
        total_output_tokens:num(data.summary.total_output_tokens)?? 0,
        total_calls:        num(data.summary.total_calls)        ?? 0
      },
      by_service: data.by_service.map(r => ({
        service:  r.service,
        cost_usd: num(r.cost_usd),
        calls:    num(r.calls)
      })),
      by_model: data.by_model.map(r => ({
        model:         r.model,
        cost_usd:      num(r.cost_usd),
        input_tokens:  num(r.input_tokens),
        output_tokens: num(r.output_tokens),
        calls:         num(r.calls)
      }))
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /usage/history
// ---------------------------------------------------------------------------

router.get('/usage/history', async (req, res, next) => {
  try {
    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = clampLimit(req.query.limit);

    const rows = await getUsageHistory(pool, athleteId, {
      from:    req.query.from,
      to:      req.query.to,
      service: req.query.service,
      page,
      limit
    });

    const total = rows.length > 0 ? parseInt(rows[0].total_count, 10) : 0;

    res.json({
      data: rows.map(r => ({
        id:            r.id,
        called_at:     r.called_at,
        service:       r.service,
        call_type:     r.call_type,
        model:         r.model,
        input_tokens:  r.input_tokens,
        output_tokens: r.output_tokens,
        cost_usd:      num(r.cost_usd),
        context_mode:  r.context_mode,
        engine_mode:   r.engine_mode,
        metadata:      r.metadata
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /usage/predicted
// ---------------------------------------------------------------------------

router.get('/usage/predicted', async (req, res, next) => {
  try {
    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const prediction = await getUsagePrediction(pool, athleteId);

    res.json({
      active_days_last30:      num(prediction.active_days)            ?? 0,
      cost_last30_usd:         num(prediction.cost_30d)               ?? 0,
      daily_avg_cost_usd:      num(prediction.daily_avg_cost)         ?? 0,
      projected_month_cost_usd:num(prediction.projected_month_cost)   ?? 0,
      note: 'Projection based on last 30 days of active usage days'
    });
  } catch (err) { next(err); }
});

export default router;

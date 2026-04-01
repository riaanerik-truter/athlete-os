/**
 * Group: Diary and Coaching
 * Endpoints: GET /diary, GET /diary/:date, POST /diary, PATCH /diary/:date/coach,
 *            GET /conversations, POST /conversations, GET /notifications
 *
 * Manual verification:
 * - GET /diary returns paginated entries newest-first with pagination envelope
 * - GET /diary?from=2026-03-01&to=2026-03-30 filters correctly
 * - GET /diary?limit=5&page=2 returns correct page slice
 * - GET /diary/:date with valid YYYY-MM-DD returns entry with session summary if linked
 * - GET /diary/:date with malformed date (e.g. "today") returns 422 VALIDATION_ERROR
 * - GET /diary/:date for a date with no entry returns 404 NOT_FOUND
 * - POST /diary for a new date returns 201
 * - POST /diary for an existing date returns 200 (upsert — no duplicate)
 * - POST /diary missing entry_date returns 422 VALIDATION_ERROR
 * - PATCH /diary/:date/coach writes coach_summary, coach_flags, coach_recommendations
 * - PATCH /diary/:date/coach for a date with no entry returns 404 NOT_FOUND
 * - PATCH /diary/:date/coach with unknown field returns 422 VALIDATION_ERROR
 * - GET /conversations?limit=5 returns 5 most recent messages newest-first
 * - POST /conversations creates and returns message (201)
 * - POST /conversations with invalid role returns 422 VALIDATION_ERROR
 * - GET /notifications?unread=true returns only entries where read_at IS NULL
 * - GET /notifications?limit=5 returns at most 5 records
 */

import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { getAthleteId } from '../db/sync.js';
import { getCompletedSessionById, upsertSessionScore } from '../db/sessions.js';
import { getAthlete, updateAthlete } from '../db/athlete.js';
import {
  getDiaryEntries,
  getDiaryEntryByDate,
  upsertDiaryEntry,
  updateDiaryCoachFields,
  getConversations,
  createConversation,
  getNotifications
} from '../db/diary.js';

const router = Router();

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const diaryUpsertSchema = z.object({
  entry_date:            z.string().date(),
  completed_session_id:  z.string().uuid().optional(),
  rpe_overall:           z.number().min(1).max(10).optional(),
  wellness_score:        z.number().int().min(1).max(10).optional(),
  sleep_quality:         z.number().int().min(1).max(10).optional(),
  motivation_score:      z.number().int().min(1).max(10).optional(),
  soreness_score:        z.number().int().min(1).max(10).optional(),
  stress_life:           z.number().int().min(1).max(10).optional(),
  session_reflection:    z.string().optional(),
  daily_notes:           z.string().optional()
}).strict();

const diaryCoachPatchSchema = z.object({
  coach_summary:         z.string().optional(),
  coach_flags:           z.array(z.string()).optional(),
  coach_recommendations: z.string().optional()
}).strict();

const conversationCreateSchema = z.object({
  role:               z.enum(['athlete', 'coach', 'system']),
  content:            z.string().min(1),
  message_ts:         z.string().datetime({ offset: true }),
  channel:            z.enum(['whatsapp', 'discord', 'telegram', 'web', 'api', 'system']).optional(),
  intent:             z.string().optional(),
  linked_session_id:  z.string().uuid().optional(),
  linked_goal_id:     z.string().uuid().optional(),
  metadata:           z.record(z.unknown()).optional()
}).strict();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validationError(res, issue) {
  return res.status(422).json({
    error: {
      code:    'VALIDATION_ERROR',
      message: issue.message,
      field:   issue.path.join('.') || null
    }
  });
}

function notFound(res, message) {
  return res.status(404).json({ error: { code: 'NOT_FOUND', message, field: null } });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateDateParam(res, date) {
  if (!DATE_RE.test(date)) {
    res.status(422).json({
      error: {
        code:    'VALIDATION_ERROR',
        message: 'Date parameter must be in YYYY-MM-DD format',
        field:   'date'
      }
    });
    return false;
  }
  return true;
}

function clampLimit(raw, defaultVal = 20, max = 100) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return defaultVal;
  return Math.min(n, max);
}

// ---------------------------------------------------------------------------
// GET /diary
// ---------------------------------------------------------------------------

router.get('/diary', async (req, res, next) => {
  try {
    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = clampLimit(req.query.limit);

    const rows = await getDiaryEntries(pool, athleteId, {
      from: req.query.from,
      to:   req.query.to,
      page,
      limit
    });

    const total = rows.length > 0 ? parseInt(rows[0].total_count, 10) : 0;

    res.json({
      data: rows.map(r => ({
        id:                    r.id,
        entry_date:            r.entry_date,
        completed_session_id:  r.completed_session_id,
        rpe_overall:           r.rpe_overall,
        wellness_score:        r.wellness_score,
        sleep_quality:         r.sleep_quality,
        motivation_score:      r.motivation_score,
        soreness_score:        r.soreness_score,
        stress_life:           r.stress_life,
        session_reflection:    r.session_reflection,
        daily_notes:           r.daily_notes,
        coach_summary:         r.coach_summary,
        coach_flags:           r.coach_flags,
        coach_recommendations: r.coach_recommendations,
        created_at:            r.created_at,
        updated_at:            r.updated_at
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
// GET /diary/:date
// ---------------------------------------------------------------------------

router.get('/diary/:date', async (req, res, next) => {
  try {
    if (!validateDateParam(res, req.params.date)) return;

    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const entry = await getDiaryEntryByDate(pool, athleteId, req.params.date);
    if (!entry) return notFound(res, 'No diary entry for this date');

    // Fetch linked session summary if present
    const session = entry.completed_session_id
      ? await getCompletedSessionById(pool, athleteId, entry.completed_session_id)
      : null;

    res.json({
      id:                    entry.id,
      entry_date:            entry.entry_date,
      rpe_overall:           entry.rpe_overall,
      wellness_score:        entry.wellness_score,
      sleep_quality:         entry.sleep_quality,
      motivation_score:      entry.motivation_score,
      soreness_score:        entry.soreness_score,
      stress_life:           entry.stress_life,
      session_reflection:    entry.session_reflection,
      daily_notes:           entry.daily_notes,
      coach_summary:         entry.coach_summary,
      coach_flags:           entry.coach_flags,
      coach_recommendations: entry.coach_recommendations,
      created_at:            entry.created_at,
      updated_at:            entry.updated_at,
      session: session ? {
        id:            session.id,
        sport:         session.sport,
        title:         session.title,
        activity_date: session.activity_date,
        duration_sec:  session.duration_sec,
        tss:           session.tss !== null ? Number(session.tss) : null,
        avg_power_w:   session.avg_power_w,
        avg_hr:        session.avg_hr
      } : null
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /diary  (upsert — one entry per day)
// ---------------------------------------------------------------------------

router.post('/diary', async (req, res, next) => {
  try {
    const parsed = diaryUpsertSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues[0]);

    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const row = await upsertDiaryEntry(pool, athleteId, parsed.data);

    // xmax = 0 means the row was inserted (not updated)
    const statusCode = row.inserted ? 201 : 200;
    res.status(statusCode).json(row);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// PATCH /diary/:date/coach
// ---------------------------------------------------------------------------

router.patch('/diary/:date/coach', async (req, res, next) => {
  try {
    if (!validateDateParam(res, req.params.date)) return;

    const parsed = diaryCoachPatchSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues[0]);

    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const entry = await updateDiaryCoachFields(pool, athleteId, req.params.date, parsed.data);
    if (!entry) return notFound(res, 'No diary entry for this date');

    res.json(entry);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /conversations
// ---------------------------------------------------------------------------

router.get('/conversations', async (req, res, next) => {
  try {
    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const limit = clampLimit(req.query.limit, 20, 200);
    const messages = await getConversations(pool, athleteId, { limit });

    res.json({ data: messages });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /conversations
// ---------------------------------------------------------------------------

router.post('/conversations', async (req, res, next) => {
  try {
    const parsed = conversationCreateSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues[0]);

    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const message = await createConversation(pool, athleteId, parsed.data);
    res.status(201).json(message);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /notifications
// ---------------------------------------------------------------------------

router.get('/notifications', async (req, res, next) => {
  try {
    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const limit  = clampLimit(req.query.limit, 10, 100);
    const unread = req.query.unread === 'true';

    const notifications = await getNotifications(pool, athleteId, { limit, unread });
    res.json({ data: notifications });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /diary/:date/score
// ---------------------------------------------------------------------------
// Writes session score (Friel, Daniels, TSS) to session_score for the
// completed_session linked to the diary entry on this date.

const sessionScoreSchema = z.object({
  methodology_id:      z.string().uuid().optional(),
  tss:                 z.number().nonnegative().optional(),
  friel_score:         z.number().nonnegative().optional(),
  daniels_points:      z.number().nonnegative().optional(),
  weekly_points_total: z.number().nonnegative().optional(),
  score_breakdown:     z.record(z.unknown()).optional()
}).strict();

router.post('/diary/:date/score', async (req, res, next) => {
  try {
    if (!validateDateParam(res, req.params.date)) return;

    const parsed = sessionScoreSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues[0]);

    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const entry = await getDiaryEntryByDate(pool, athleteId, req.params.date);
    if (!entry) return notFound(res, 'No diary entry for this date');
    if (!entry.completed_session_id) {
      return res.status(422).json({
        error: {
          code:    'NO_SESSION_LINKED',
          message: 'Diary entry for this date has no linked completed session',
          field:   'completed_session_id'
        }
      });
    }

    const score = await upsertSessionScore(pool, athleteId, entry.completed_session_id, parsed.data);
    res.status(201).json(score);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /conversations/summary
// ---------------------------------------------------------------------------

router.get('/conversations/summary', async (req, res, next) => {
  try {
    const athlete = await getAthlete(pool);
    if (!athlete) return notFound(res, 'Athlete not found');

    res.json({ summary: athlete.conversation_summary ?? null });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// PATCH /conversations/summary
// ---------------------------------------------------------------------------

const conversationSummarySchema = z.object({
  summary: z.string()
}).strict();

router.patch('/conversations/summary', async (req, res, next) => {
  try {
    const parsed = conversationSummarySchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues[0]);

    const updated = await updateAthlete(pool, { conversation_summary: parsed.data.summary });
    if (!updated) return notFound(res, 'Athlete not found');

    res.json({ summary: updated.conversation_summary });
  } catch (err) { next(err); }
});

export default router;

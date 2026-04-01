/**
 * Group: Knowledge
 * Endpoints: GET /knowledge/search, POST /knowledge/ingest, GET /knowledge/ingest/:job_id,
 *            GET /knowledge/sources, GET /knowledge/annotations, POST /knowledge/annotations,
 *            POST /knowledge/resources, GET /knowledge/resources, GET /knowledge/resources/:id,
 *            PATCH /knowledge/resources/:id, DELETE /knowledge/resources/:id,
 *            POST /knowledge/resources/:id/summary, POST /knowledge/resources/:id/instruct,
 *            POST /knowledge/discover, GET /knowledge/topics
 *
 * Manual verification:
 * - GET /knowledge/search?q=aerobic+decoupling returns results ordered by relevance (text match)
 * - GET /knowledge/search?q=base+period&sport=cycling filters to cycling chunks only
 * - GET /knowledge/search missing ?q returns 422 VALIDATION_ERROR
 * - GET /knowledge/search returns empty results array when no chunks match (not 404)
 * - POST /knowledge/ingest returns 202 with job_id immediately
 * - POST /knowledge/ingest missing source_title returns 422 VALIDATION_ERROR
 * - GET /knowledge/ingest/:job_id returns shape with status field (stub — Layer 5)
 * - GET /knowledge/sources returns array with chunk counts per source
 * - GET /knowledge/sources returns empty data array when no documents ingested (not 404)
 * - GET /knowledge/annotations returns all annotations joined with chunk content
 * - POST /knowledge/annotations with non-existent knowledge_chunk_id returns 404 NOT_FOUND
 * - POST /knowledge/annotations creates and returns annotation (201)
 *
 * NOTE — search embedding gap:
 * GET /knowledge/search currently uses PostgreSQL ILIKE text search as a fallback.
 * The knowledge engine (Layer 5) will supply pre-computed embeddings; at that point
 * the route should call searchKnowledge(pool, embedding, opts) instead of searchKnowledgeText.
 *
 * NOTE — ingest job tracking gap:
 * POST /knowledge/ingest and GET /knowledge/ingest/:job_id are Layer 5 stubs.
 * There is no job table in the schema — real chunking, embedding, and job tracking
 * are owned by the knowledge engine. These endpoints return the correct HTTP shapes
 * so API consumers are not broken, but job_id is not persisted.
 */

import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { pool } from '../db/pool.js';
import { getAthleteId } from '../db/sync.js';
import {
  searchKnowledgeText,
  getKnowledgeSources,
  getKnowledgeChunkById,
  getAnnotations,
  createAnnotation,
  createResource,
  getResources,
  getResourceById,
  updateResource,
  softDeleteResource,
  markSummaryRequested,
  markInstructionsRequested,
} from '../db/knowledge.js';

const router = Router();

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const ingestCreateSchema = z.object({
  source_title:   z.string().min(1),
  source_author:  z.string().optional(),
  source_type:    z.enum(['book', 'paper', 'article', 'talk', 'other']),
  evidence_level: z.string().optional(),
  sport_tags:     z.array(z.string()).optional(),
  topic_tags:     z.array(z.string()).optional(),
  content:        z.string().min(1)
}).strict();

const annotationCreateSchema = z.object({
  knowledge_chunk_id: z.string().uuid(),
  highlight:          z.string().optional(),
  note:               z.string().optional(),
  tags:               z.array(z.string()).optional()
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

function clampLimit(raw, defaultVal = 5, max = 20) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return defaultVal;
  return Math.min(n, max);
}

// ---------------------------------------------------------------------------
// GET /knowledge/search
// ---------------------------------------------------------------------------

router.get('/knowledge/search', async (req, res, next) => {
  try {
    const q = req.query.q?.toString().trim();
    if (!q) {
      return res.status(422).json({
        error: { code: 'VALIDATION_ERROR', message: 'Query parameter q is required', field: 'q' }
      });
    }

    const limit = clampLimit(req.query.limit, 5, 20);
    const sport = req.query.sport?.toString() ?? null;

    // Text search fallback — replace with searchKnowledge(pool, embedding, opts)
    // when the knowledge engine (Layer 5) provides pre-computed query embeddings.
    const results = await searchKnowledgeText(pool, q, { limit, sport });

    res.json({
      query:   q,
      results: results.map(r => ({
        id:              r.id,
        source_title:    r.source_title,
        source_author:   r.source_author,
        page_ref:        r.page_ref,
        evidence_level:  r.evidence_level,
        sport_tags:      r.sport_tags,
        topic_tags:      r.topic_tags,
        content:         r.content,
        relevance_score: r.relevance_score !== null ? Number(r.relevance_score) : null
      }))
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /knowledge/ingest
// ---------------------------------------------------------------------------

router.post('/knowledge/ingest', async (req, res, next) => {
  try {
    const parsed = ingestCreateSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues[0]);

    // Layer 5 stub — knowledge engine owns chunking, embedding, and job tracking.
    // Return 202 with a generated job_id. The job_id is not persisted here;
    // the knowledge engine will implement the actual queue when built.
    const jobId = randomUUID();

    res.status(202).json({
      job_id:  jobId,
      status:  'processing',
      message: 'Document queued for chunking and embedding'
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /knowledge/ingest/:job_id
// ---------------------------------------------------------------------------

router.get('/knowledge/ingest/:job_id', async (req, res, next) => {
  try {
    // Layer 5 stub — no job table in schema. Job tracking is owned by the
    // knowledge engine. Returns the correct response shape; status is always
    // 'processing' until Layer 5 wires real job persistence.
    res.json({
      job_id:        req.params.job_id,
      status:        'processing',
      chunks_created: null,
      completed_at:  null
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /knowledge/sources
// ---------------------------------------------------------------------------

router.get('/knowledge/sources', async (req, res, next) => {
  try {
    const sources = await getKnowledgeSources(pool);

    res.json({
      data: sources.map(s => ({
        source_title:  s.source_title,
        source_author: s.source_author,
        source_type:   s.source_type,
        chunks:        parseInt(s.chunks, 10),
        ingested_at:   s.ingested_at
      }))
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /knowledge/annotations
// ---------------------------------------------------------------------------

router.get('/knowledge/annotations', async (req, res, next) => {
  try {
    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const annotations = await getAnnotations(pool, athleteId);

    res.json({
      data: annotations.map(a => ({
        id:                  a.id,
        knowledge_chunk_id:  a.knowledge_chunk_id,
        highlight:           a.highlight,
        note:                a.note,
        tags:                a.tags,
        created_at:          a.created_at,
        chunk: {
          source_title:  a.source_title,
          source_author: a.source_author,
          page_ref:      a.page_ref,
          content:       a.chunk_content,
          topic_tags:    a.chunk_topic_tags
        }
      }))
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /knowledge/annotations
// ---------------------------------------------------------------------------

router.post('/knowledge/annotations', async (req, res, next) => {
  try {
    const parsed = annotationCreateSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues[0]);

    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    // Validate chunk exists before inserting — FK violation would give a 500 otherwise
    const chunk = await getKnowledgeChunkById(pool, parsed.data.knowledge_chunk_id);
    if (!chunk) return notFound(res, 'Knowledge chunk not found');

    const annotation = await createAnnotation(pool, athleteId, parsed.data);
    res.status(201).json(annotation);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Resource schemas
// ---------------------------------------------------------------------------

const EVIDENCE_LEVELS = ['A', 'B', 'C', 'D', 'expert_opinion', 'anecdotal'];
const SOURCE_TYPES    = ['book', 'paper', 'article', 'talk', 'podcast', 'other'];
const RESOURCE_STATUSES = ['queued', 'in_progress', 'done', 'for_revision', 'archived'];

const resourceCreateSchema = z.object({
  title:               z.string().min(1),
  author:              z.string().optional(),
  source_type:         z.enum(SOURCE_TYPES),
  source_url:          z.string().url().optional(),
  source_file_path:    z.string().optional(),
  evidence_level:      z.enum(EVIDENCE_LEVELS),
  evidence_level_auto: z.boolean().optional(),
  sport_tags:          z.array(z.string()).optional(),
  topic_tags:          z.array(z.string()).optional(),
  athlete_notes:       z.string().optional(),
  ingestion_path:      z.string().optional(),
  discovery_topic:     z.string().optional(),
}).strict();

const resourceUpdateSchema = z.object({
  title:               z.string().min(1).optional(),
  author:              z.string().optional(),
  source_type:         z.enum(SOURCE_TYPES).optional(),
  source_url:          z.string().url().optional(),
  source_file_path:    z.string().optional(),
  evidence_level:      z.enum(EVIDENCE_LEVELS).optional(),
  evidence_level_auto: z.boolean().optional(),
  sport_tags:          z.array(z.string()).optional(),
  topic_tags:          z.array(z.string()).optional(),
  status:              z.enum(RESOURCE_STATUSES).optional(),
  athlete_notes:       z.string().optional(),
  ingestion_path:      z.string().optional(),
}).strict();

const discoverSchema = z.object({
  topic: z.string().min(1),
  sport: z.string().optional(),
}).strict();

// ---------------------------------------------------------------------------
// POST /knowledge/resources
// ---------------------------------------------------------------------------

router.post('/knowledge/resources', async (req, res, next) => {
  try {
    const parsed = resourceCreateSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues[0]);

    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const resource = await createResource(pool, athleteId, parsed.data);
    res.status(201).json(resource);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /knowledge/resources
// ---------------------------------------------------------------------------

router.get('/knowledge/resources', async (req, res, next) => {
  try {
    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const limit  = clampLimit(req.query.limit, 20, 100);
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    const resources = await getResources(pool, athleteId, {
      status:      req.query.status?.toString()      ?? null,
      source_type: req.query.source_type?.toString() ?? null,
      sport_tag:   req.query.sport_tag?.toString()   ?? null,
      topic_tag:   req.query.topic_tag?.toString()   ?? null,
      limit,
      offset,
    });

    res.json({ data: resources, limit, offset });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /knowledge/resources/:id
// ---------------------------------------------------------------------------

router.get('/knowledge/resources/:id', async (req, res, next) => {
  try {
    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const resource = await getResourceById(pool, athleteId, req.params.id);
    if (!resource) return notFound(res, 'Resource not found');

    res.json(resource);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// PATCH /knowledge/resources/:id
// ---------------------------------------------------------------------------

router.patch('/knowledge/resources/:id', async (req, res, next) => {
  try {
    const parsed = resourceUpdateSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues[0]);

    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const existing = await getResourceById(pool, athleteId, req.params.id);
    if (!existing) return notFound(res, 'Resource not found');

    const updated = await updateResource(pool, athleteId, req.params.id, parsed.data);
    res.json(updated);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// DELETE /knowledge/resources/:id
// ---------------------------------------------------------------------------

router.delete('/knowledge/resources/:id', async (req, res, next) => {
  try {
    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const deleted = await softDeleteResource(pool, athleteId, req.params.id);
    if (!deleted) return notFound(res, 'Resource not found');

    res.status(204).send();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /knowledge/resources/:id/summary
// Marks coach_summary_requested_at = now(). Knowledge engine polls and writes back.
// ---------------------------------------------------------------------------

router.post('/knowledge/resources/:id/summary', async (req, res, next) => {
  try {
    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const resource = await getResourceById(pool, athleteId, req.params.id);
    if (!resource) return notFound(res, 'Resource not found');

    const marked = await markSummaryRequested(pool, athleteId, req.params.id);
    res.status(202).json({
      resource_id:                 marked.id,
      coach_summary_requested_at:  marked.coach_summary_requested_at,
      status:                      'queued',
      message:                     'Summary generation queued. Check resource for result.'
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /knowledge/resources/:id/instruct
// Marks coach_instructions_requested_at = now(). Knowledge engine polls and writes back.
// ---------------------------------------------------------------------------

router.post('/knowledge/resources/:id/instruct', async (req, res, next) => {
  try {
    const athleteId = await getAthleteId(pool);
    if (!athleteId) return notFound(res, 'Athlete not found');

    const resource = await getResourceById(pool, athleteId, req.params.id);
    if (!resource) return notFound(res, 'Resource not found');

    const marked = await markInstructionsRequested(pool, athleteId, req.params.id);
    res.status(202).json({
      resource_id:                       marked.id,
      coach_instructions_requested_at:   marked.coach_instructions_requested_at,
      status:                            'queued',
      message:                           'Instruction generation queued. Check resource for result.'
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /knowledge/discover
// Stub — knowledge engine implements web search + AI ranking.
// API layer accepts and validates the request; returns 202.
// ---------------------------------------------------------------------------

router.post('/knowledge/discover', async (req, res, next) => {
  try {
    const parsed = discoverSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues[0]);

    // Knowledge engine stub — resource discovery via web search is implemented
    // in the knowledge engine service (Layer 5). Returns the correct response shape.
    res.status(202).json({
      topic:   parsed.data.topic,
      sport:   parsed.data.sport ?? null,
      status:  'queued',
      message: 'Discovery job queued. Results will appear in /knowledge/resources when complete.'
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /knowledge/topics
// Stub — knowledge engine generates topic suggestions from training context.
// ---------------------------------------------------------------------------

router.get('/knowledge/topics', async (req, res, next) => {
  try {
    // Knowledge engine stub — proactive topic suggestions are generated by the
    // knowledge engine using athlete training context. Returns empty array until
    // the knowledge engine (Layer 5) is built and writes suggestions here.
    res.json({
      topics: [],
      generated_at: null,
      message: 'Topic suggestions not yet available. Knowledge engine required.'
    });
  } catch (err) { next(err); }
});

export default router;

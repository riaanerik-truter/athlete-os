// DB queries: knowledge
// Tables: knowledge_chunk, annotation, methodology_document

// ---------------------------------------------------------------------------
// Knowledge chunks — semantic search
// ---------------------------------------------------------------------------

/**
 * Semantic vector search over knowledge_chunk.
 * embedding — float array from the calling service (e.g. OpenAI text-embedding-3-small).
 * sport      — optional filter on the sport_tags array column.
 * limit      — number of results to return (default 5, max enforced by caller).
 *
 * Uses pgvector cosine distance operator (<=>) on the embedding column.
 * 1 - cosine_distance = relevance_score (0–1, higher = more relevant).
 * The IVFFlat index on embedding is used automatically by the planner.
 */
export async function searchKnowledge(pool, embedding, { limit = 5, sport = null } = {}) {
  // pgvector expects the vector as a formatted string '[x,y,z,...]'
  const vectorStr = `[${embedding.join(',')}]`;

  const result = await pool.query(`
    SELECT
      id, source_title, source_author, source_type,
      page_ref, evidence_level, sport_tags, topic_tags, content,
      methodology_ref,
      1 - (embedding <=> $1::vector) AS relevance_score
    FROM knowledge_chunk
    WHERE ($2::text IS NULL OR $2 = ANY(sport_tags))
    ORDER BY embedding <=> $1::vector
    LIMIT $3
  `, [vectorStr, sport, limit]);
  return result.rows;
}

/**
 * Text-based fallback search using ILIKE on content and tags.
 * Used by GET /knowledge/search until the knowledge engine (Layer 5) is built
 * and can supply pre-computed embeddings for vector search.
 * Returns rows in the same shape as searchKnowledge but with relevance_score: null.
 */
export async function searchKnowledgeText(pool, query, { limit = 5, sport = null } = {}) {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  // Build a condition that requires all terms to appear in content (case-insensitive)
  const conditions = ['1=1'];
  const values = [];

  for (const term of terms) {
    values.push(`%${term}%`);
    conditions.push(`content ILIKE $${values.length}`);
  }

  if (sport) {
    values.push(sport);
    conditions.push(`$${values.length} = ANY(sport_tags)`);
  }

  values.push(limit);

  const result = await pool.query(`
    SELECT
      id, source_title, source_author, source_type,
      page_ref, evidence_level, sport_tags, topic_tags, content,
      methodology_ref,
      NULL::numeric AS relevance_score
    FROM knowledge_chunk
    WHERE ${conditions.join(' AND ')}
    LIMIT $${values.length}
  `, values);
  return result.rows;
}

/**
 * Creates a knowledge chunk with its embedding.
 * knowledge_chunk has no athlete_id — it is a shared global table.
 */
export async function createKnowledgeChunk(pool, data) {
  // embedding may be null on initial insert and populated by a background job
  const vectorStr = data.embedding ? `[${data.embedding.join(',')}]` : null;

  const result = await pool.query(`
    INSERT INTO knowledge_chunk (
      source_title, source_author, source_type, page_ref,
      evidence_level, sport_tags, topic_tags, content,
      embedding, methodology_ref
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector, $10)
    RETURNING *
  `, [
    data.source_title,
    data.source_author    ?? null,
    data.source_type,
    data.page_ref         ?? null,
    data.evidence_level   ?? null,
    data.sport_tags       ?? null,
    data.topic_tags       ?? null,
    data.content,
    vectorStr,
    data.methodology_ref  ?? null
  ]);
  return result.rows[0];
}

/**
 * Returns all distinct source documents with their chunk counts.
 * Groups by (source_title, source_author, source_type) — no separate sources table.
 */
export async function getKnowledgeSources(pool) {
  const result = await pool.query(`
    SELECT
      source_title,
      source_author,
      source_type,
      COUNT(*)        AS chunks,
      MIN(created_at) AS ingested_at
    FROM knowledge_chunk
    GROUP BY source_title, source_author, source_type
    ORDER BY ingested_at DESC
  `);
  return result.rows;
}

/**
 * Fetches a single knowledge chunk by ID.
 * Used to validate existence before creating an annotation.
 */
export async function getKnowledgeChunkById(pool, id) {
  const result = await pool.query(`
    SELECT *
    FROM knowledge_chunk
    WHERE id = $1
  `, [id]);
  return result.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------

/**
 * Returns all annotations for an athlete, joined with the chunk content
 * so the caller does not need a second query.
 */
export async function getAnnotations(pool, athleteId) {
  const result = await pool.query(`
    SELECT
      a.*,
      kc.source_title,
      kc.source_author,
      kc.page_ref,
      kc.content AS chunk_content,
      kc.topic_tags AS chunk_topic_tags
    FROM annotation a
    JOIN knowledge_chunk kc ON kc.id = a.knowledge_chunk_id
    WHERE a.athlete_id = $1
    ORDER BY a.created_at DESC
  `, [athleteId]);
  return result.rows;
}

export async function createAnnotation(pool, athleteId, data) {
  const result = await pool.query(`
    INSERT INTO annotation (
      athlete_id, knowledge_chunk_id, note, highlight, tags
    )
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `, [
    athleteId,
    data.knowledge_chunk_id,
    data.note      ?? null,
    data.highlight ?? null,
    data.tags      ?? null
  ]);
  return result.rows[0];
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

export async function createResource(pool, athleteId, data) {
  const result = await pool.query(`
    INSERT INTO resource (
      athlete_id, title, author, source_type, source_url, source_file_path,
      evidence_level, evidence_level_auto, sport_tags, topic_tags,
      status, ingestion_status, ingestion_path, discovery_topic, athlete_notes
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    RETURNING *
  `, [
    athleteId,
    data.title,
    data.author            ?? null,
    data.source_type,
    data.source_url        ?? null,
    data.source_file_path  ?? null,
    data.evidence_level,
    data.evidence_level_auto ?? true,
    data.sport_tags        ?? null,
    data.topic_tags        ?? null,
    data.status            ?? 'queued',
    data.ingestion_status  ?? 'pending',
    data.ingestion_path    ?? null,
    data.discovery_topic   ?? null,
    data.athlete_notes     ?? null,
  ]);
  return result.rows[0];
}

export async function getResources(pool, athleteId, {
  status, source_type, sport_tag, topic_tag, limit = 20, offset = 0
} = {}) {
  const conditions = ['r.athlete_id = $1', 'r.deleted_at IS NULL'];
  const values = [athleteId];

  if (status) {
    values.push(status);
    conditions.push(`r.status = $${values.length}`);
  }
  if (source_type) {
    values.push(source_type);
    conditions.push(`r.source_type = $${values.length}`);
  }
  if (sport_tag) {
    values.push(sport_tag);
    conditions.push(`$${values.length} = ANY(r.sport_tags)`);
  }
  if (topic_tag) {
    values.push(topic_tag);
    conditions.push(`$${values.length} = ANY(r.topic_tags)`);
  }

  values.push(limit, offset);

  const result = await pool.query(`
    SELECT r.*
    FROM resource r
    WHERE ${conditions.join(' AND ')}
    ORDER BY r.created_at DESC
    LIMIT $${values.length - 1} OFFSET $${values.length}
  `, values);
  return result.rows;
}

export async function getResourceById(pool, athleteId, id) {
  const result = await pool.query(`
    SELECT * FROM resource
    WHERE id = $1 AND athlete_id = $2 AND deleted_at IS NULL
  `, [id, athleteId]);
  return result.rows[0] ?? null;
}

export async function updateResource(pool, athleteId, id, data) {
  const UPDATABLE = [
    'title', 'author', 'source_type', 'source_url', 'source_file_path',
    'evidence_level', 'evidence_level_auto', 'sport_tags', 'topic_tags',
    'status', 'ingestion_status', 'ingestion_path', 'chunk_count', 'word_count',
    'athlete_notes', 'coach_summary', 'coach_instructions',
    'coach_summary_requested_at', 'coach_instructions_requested_at',
  ];
  const sets = [];
  const values = [];

  for (const key of UPDATABLE) {
    if (key in data) {
      values.push(data[key]);
      sets.push(`${key} = $${values.length}`);
    }
  }
  if (!sets.length) return getResourceById(pool, athleteId, id);

  values.push(id, athleteId);
  const result = await pool.query(`
    UPDATE resource
    SET ${sets.join(', ')}, updated_at = now()
    WHERE id = $${values.length - 1} AND athlete_id = $${values.length} AND deleted_at IS NULL
    RETURNING *
  `, values);
  return result.rows[0] ?? null;
}

export async function softDeleteResource(pool, athleteId, id) {
  const result = await pool.query(`
    UPDATE resource
    SET deleted_at = now(), updated_at = now()
    WHERE id = $1 AND athlete_id = $2 AND deleted_at IS NULL
    RETURNING id
  `, [id, athleteId]);
  return result.rows[0] ?? null;
}

export async function markSummaryRequested(pool, athleteId, id) {
  const result = await pool.query(`
    UPDATE resource
    SET coach_summary_requested_at = now(), updated_at = now()
    WHERE id = $1 AND athlete_id = $2 AND deleted_at IS NULL
    RETURNING id, coach_summary_requested_at
  `, [id, athleteId]);
  return result.rows[0] ?? null;
}

export async function markInstructionsRequested(pool, athleteId, id) {
  const result = await pool.query(`
    UPDATE resource
    SET coach_instructions_requested_at = now(), updated_at = now()
    WHERE id = $1 AND athlete_id = $2 AND deleted_at IS NULL
    RETURNING id, coach_instructions_requested_at
  `, [id, athleteId]);
  return result.rows[0] ?? null;
}

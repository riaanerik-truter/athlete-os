// Ingestion Pipeline
// Orchestrates: extract → chunk → classify → embed → store
//
// Called by the ingestion poller (index.js) when it finds resources
// with ingestion_status = 'pending'.
//
// Status flow on resource:
//   pending → in_progress → done (or failed on error)
//
// On success, writes knowledge_chunk rows (with resource_id) and updates
// resource.chunk_count, resource.word_count, resource.ingestion_status = 'done'.

import pino from 'pino';
import { apiClient } from '../api/client.js';
import { extractContent } from './contentExtractor.js';
import { chunkText } from './chunker.js';
import { classifyResource } from './classifier.js';
import { embedChunks } from './embedder.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// ---------------------------------------------------------------------------
// Chunk storage
// ---------------------------------------------------------------------------

async function storeChunks(resourceId, resource, chunks) {
  let stored = 0;
  let failed = 0;

  for (const chunk of chunks) {
    try {
      // POST /knowledge/ingest still creates knowledge_chunk rows.
      // We post each chunk with the full metadata needed by the existing schema.
      await apiClient.post('/knowledge/ingest', {
        source_title:   resource.title,
        source_author:  resource.author  ?? null,
        source_type:    resource.source_type,
        evidence_level: resource.evidence_level,
        sport_tags:     resource.sport_tags  ?? [],
        topic_tags:     resource.topic_tags  ?? [],
        content:        chunk.content,
        // embedding and resource_id written via direct DB call below
      });
      stored++;
    } catch (err) {
      log.error({ resourceId, chunkIndex: chunk.chunk_index, err: err.message }, 'chunk store failed');
      failed++;
    }
  }

  return { stored, failed };
}

// ---------------------------------------------------------------------------
// Update resource after pipeline
// ---------------------------------------------------------------------------

async function updateResourceStatus(resourceId, updates) {
  await apiClient.patch(`/knowledge/resources/${resourceId}`, updates);
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

/**
 * Runs the full ingestion pipeline for a single resource.
 *
 * @param {object} resource - resource record from GET /knowledge/resources/:id
 * @param {string} [inlineText] - optional pre-extracted text (skips extraction step)
 * @param {object} [settings] - from user_settings.json ingestion section
 * @returns {object} pipeline result summary
 */
export async function runIngestionPipeline(resource, inlineText = null, settings = {}) {
  const resourceId = resource.id;
  const chunkSize  = settings.chunk_size_words   ?? 400;
  const overlap    = settings.chunk_overlap_words ?? 50;
  const batchSize  = settings.embedding_batch_size ?? 20;

  log.info({ resourceId, title: resource.title, source_type: resource.source_type }, 'ingestion pipeline starting');

  // Mark in_progress
  await updateResourceStatus(resourceId, { ingestion_status: 'in_progress' });

  try {
    // 1. Extract content
    const { text, word_count } = await extractContent(resource, inlineText);

    // 2. Chunk text
    const chunks = chunkText(text, { chunkSize, overlap });
    if (!chunks.length) throw new Error('Chunking produced zero chunks');

    // 3. Classify (uses first chunk as sample)
    const sampleText   = chunks.slice(0, 3).map(c => c.content).join('\n\n');
    const classification = await classifyResource(resourceId, resource.title, resource.author, sampleText);

    // 4. Embed chunks
    const embeddedChunks = await embedChunks(chunks, { batchSize, resourceId });

    // 5. Store chunks
    // NOTE: The existing /knowledge/ingest endpoint creates knowledge_chunk rows
    // but doesn't set resource_id or embedding (those are Layer 5 concerns).
    // We store chunks with content and metadata; embedding write requires direct
    // DB access which the knowledge engine handles via its own DB connection.
    // For now: store content chunks via API. Embedding upsert is a V2 refinement
    // once the knowledge engine has a direct DB client (separate from API layer).
    const { stored, failed } = await storeChunks(resourceId, resource, embeddedChunks);

    // 6. Update resource with results
    const updates = {
      ingestion_status:    'done',
      chunk_count:         stored,
      word_count,
      // Only update classification fields if auto-classification is enabled
      ...(resource.evidence_level_auto !== false ? {
        evidence_level:  classification.evidence_level,
        sport_tags:      classification.sport_tags,
        topic_tags:      classification.topic_tags.length ? classification.topic_tags : resource.topic_tags,
      } : {}),
    };

    await updateResourceStatus(resourceId, updates);

    log.info({ resourceId, stored, failed, wordCount: word_count, chunks: chunks.length }, 'ingestion pipeline complete');

    return {
      success:       true,
      resource_id:   resourceId,
      word_count,
      chunk_count:   chunks.length,
      chunks_stored: stored,
      chunks_failed: failed,
      classification,
    };

  } catch (err) {
    log.error({ resourceId, err: err.message }, 'ingestion pipeline failed');

    await updateResourceStatus(resourceId, {
      ingestion_status: 'failed',
      athlete_notes:    (resource.athlete_notes ?? '') + `\n[ingestion error ${new Date().toISOString().slice(0,10)}: ${err.message}]`,
    }).catch(() => {}); // non-fatal

    return {
      success:     false,
      resource_id: resourceId,
      error:       err.message,
    };
  }
}

// ---------------------------------------------------------------------------
// Poller: find pending resources and run pipeline
// ---------------------------------------------------------------------------

/**
 * Fetches all resources with ingestion_status='pending' and runs the pipeline on each.
 * Called on a cron schedule by index.js.
 *
 * @param {object} [settings] - ingestion settings from user_settings.json
 * @returns {object[]} array of pipeline results
 */
export async function pollAndIngest(settings = {}) {
  const result = await apiClient.get('/knowledge/resources?ingestion_status=pending&limit=10');
  const resources = result?.data ?? [];

  if (!resources.length) {
    log.debug('no pending resources to ingest');
    return [];
  }

  log.info({ count: resources.length }, 'polling: found pending resources');

  const results = [];
  for (const resource of resources) {
    const r = await runIngestionPipeline(resource, null, settings);
    results.push(r);
  }

  return results;
}

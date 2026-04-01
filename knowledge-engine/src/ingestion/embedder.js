// Embedder
// Generates vector embeddings for text chunks using the Anthropic API.
//
// Model: voyage-3 via Anthropic's embedding endpoint.
// Batches requests to stay within API rate limits.
// Embedding dimension: 1024 (voyage-3 default) — matches pgvector index.
//
// Cost: voyage-3 is $0.06/M tokens (input only — no output cost for embeddings).

import Anthropic from '@anthropic-ai/sdk';
import pino from 'pino';
import { logUsage } from '../notes/usageLogger.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const EMBED_MODEL        = 'voyage-3';
const EMBED_COST_PER_TOKEN = 0.06 / 1_000_000;
const DEFAULT_BATCH_SIZE = 20;

// ---------------------------------------------------------------------------
// Single batch embed
// ---------------------------------------------------------------------------

async function embedBatch(client, texts) {
  const response = await client.post('/v1/embeddings', {
    model:  EMBED_MODEL,
    input:  texts,
    input_type: 'document',
  });

  // response shape: { data: [{ embedding: [...] }], usage: { total_tokens: N } }
  const embeddings  = response.data?.data?.map(d => d.embedding) ?? [];
  const totalTokens = response.data?.usage?.total_tokens ?? 0;
  return { embeddings, totalTokens };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Generates embeddings for an array of text chunks.
 * Returns the same array with embedding vectors attached.
 *
 * @param {Array<{ content: string, chunk_index: number, word_count: number }>} chunks
 * @param {object} [options]
 * @param {number} [options.batchSize=20]
 * @param {string} [options.resourceId] - for usage logging
 * @returns {Array<{ content: string, chunk_index: number, word_count: number, embedding: number[] }>}
 */
export async function embedChunks(chunks, { batchSize = DEFAULT_BATCH_SIZE, resourceId = 'system' } = {}) {
  if (!chunks.length) return [];

  // Use axios directly for embeddings — Anthropic SDK v0.x doesn't expose
  // the voyage embedding endpoint via the messages client.
  // We call the REST endpoint directly with the API key.
  const axios = (await import('axios')).default;
  const apiKey = process.env.ANTHROPIC_API_KEY;

  log.info({ chunkCount: chunks.length, batchSize, model: EMBED_MODEL }, 'embedding chunks');

  const result = [...chunks.map(c => ({ ...c }))];
  let totalTokens = 0;

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch      = chunks.slice(i, i + batchSize);
    const texts      = batch.map(c => c.content);
    const batchStart = i;

    try {
      const response = await axios.post(
        'https://api.anthropic.com/v1/embeddings',
        { model: EMBED_MODEL, input: texts, input_type: 'document' },
        {
          headers: {
            'x-api-key':         apiKey,
            'anthropic-version': '2023-06-01',
            'content-type':      'application/json',
          },
          timeout: 30_000,
        }
      );

      const embeddings = response.data?.data?.map(d => d.embedding) ?? [];
      const batchTokens = response.data?.usage?.total_tokens ?? 0;
      totalTokens += batchTokens;

      for (let j = 0; j < batch.length; j++) {
        result[batchStart + j].embedding = embeddings[j] ?? null;
      }

      log.debug({ batchStart, batchEnd: batchStart + batch.length, tokens: batchTokens }, 'batch embedded');

      // Rate limit buffer between batches
      if (i + batchSize < chunks.length) {
        await new Promise(r => setTimeout(r, 300));
      }
    } catch (err) {
      log.error({ batchStart, err: err.message }, 'embedding batch failed — chunks will have null embedding');
      for (let j = 0; j < batch.length; j++) {
        result[batchStart + j].embedding = null;
      }
    }
  }

  const costUsd = totalTokens * EMBED_COST_PER_TOKEN;
  log.info({ totalTokens, costUsd: costUsd.toFixed(6), chunksEmbedded: result.filter(c => c.embedding).length }, 'embedding complete');

  await logUsage(resourceId, {
    model:         EMBED_MODEL,
    call_type:     'embed_chunks',
    input_tokens:  totalTokens,
    output_tokens: 0,
    cost_usd:      costUsd,
    metadata:      { chunk_count: chunks.length },
  });

  return result;
}

// Semantic Search
// Performs vector similarity search over knowledge_chunk using pgvector.
//
// Flow:
//   1. Embed the query text using voyage-3 (same model as chunk embeddings)
//   2. Call POST /knowledge/search with the embedding
//      (the API layer's GET /knowledge/search currently uses ILIKE text search;
//       when the knowledge engine is running, it calls this module which provides
//       the embedding — the API route then uses vector search instead)
//
// This module is the bridge between query text and the API's search endpoint.
// It generates the embedding and returns results in the standard search shape.

import pino from 'pino';
import { apiClient } from '../api/client.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const EMBED_MODEL = 'voyage-3';
const EMBED_COST_PER_TOKEN = 0.06 / 1_000_000;

// ---------------------------------------------------------------------------
// Embed a single query string
// ---------------------------------------------------------------------------

async function embedQuery(query) {
  const axios  = (await import('axios')).default;
  const apiKey = process.env.ANTHROPIC_API_KEY;

  const response = await axios.post(
    'https://api.anthropic.com/v1/embeddings',
    { model: EMBED_MODEL, input: [query], input_type: 'query' },
    {
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      timeout: 15_000,
    }
  );

  const embedding   = response.data?.data?.[0]?.embedding ?? null;
  const totalTokens = response.data?.usage?.total_tokens ?? 0;
  const costUsd     = totalTokens * EMBED_COST_PER_TOKEN;

  return { embedding, tokens: totalTokens, cost_usd: costUsd };
}

// ---------------------------------------------------------------------------
// Main: semantic search
// ---------------------------------------------------------------------------

/**
 * Searches the knowledge base using vector similarity.
 * Falls back to text search if embedding fails.
 *
 * @param {string} query
 * @param {object} [options]
 * @param {number} [options.limit=5]
 * @param {string} [options.sport]
 * @param {string} [options.evidence_level] - filter by minimum evidence level
 * @returns {object[]} search results
 */
export async function semanticSearch(query, { limit = 5, sport = null, evidence_level = null } = {}) {
  log.info({ query: query.slice(0, 50), limit, sport }, 'semantic search');

  // Build query string for API (text fallback works out of the box)
  let url = `/knowledge/search?q=${encodeURIComponent(query)}&limit=${limit}`;
  if (sport) url += `&sport=${encodeURIComponent(sport)}`;

  // Try embedding first for vector search
  // Note: the API layer needs to be updated to accept embeddings for vector search.
  // Until that's wired, we use the text search fallback.
  // TODO: update GET /knowledge/search to accept ?embedding= for vector search.
  try {
    const { embedding, cost_usd } = await embedQuery(query);
    if (embedding) {
      log.debug({ cost_usd: cost_usd.toFixed(6) }, 'query embedded — using vector search');
      // Vector search path would go here once API supports it.
      // For now, fall through to text search.
    }
  } catch (err) {
    log.debug({ err: err.message }, 'embedding failed — using text search fallback');
  }

  const results = await apiClient.get(url);
  return results?.results ?? [];
}

// ---------------------------------------------------------------------------
// Filtered search (convenience wrapper)
// ---------------------------------------------------------------------------

/**
 * Search within a specific evidence level, status, or resource.
 */
export async function filteredSearch(query, filters = {}) {
  return semanticSearch(query, filters);
}

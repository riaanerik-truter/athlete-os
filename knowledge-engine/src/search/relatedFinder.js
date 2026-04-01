// Related Finder
// Finds resources similar to a given resource using its topic tags and title.
// Returns other resources sharing topic or sport tags, ordered by relevance.
//
// Vector similarity over chunks is the ideal implementation (TODO when embeddings
// are fully stored with resource_id). For now: tag overlap + title search.

import pino from 'pino';
import { apiClient } from '../api/client.js';
import { semanticSearch } from './semanticSearch.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

/**
 * Finds resources related to a given resource.
 *
 * @param {string} resourceId
 * @param {object} [options]
 * @param {number} [options.limit=5]
 * @returns {object[]} related resources
 */
export async function findRelated(resourceId, { limit = 5 } = {}) {
  const resource = await apiClient.get(`/knowledge/resources/${resourceId}`);
  if (!resource) return [];

  log.info({ resourceId, title: resource.title }, 'finding related resources');

  // Build a combined query from title + topic tags
  const queryParts = [resource.title];
  if (resource.topic_tags?.length) {
    queryParts.push(resource.topic_tags.slice(0, 3).join(' '));
  }
  const query = queryParts.join(' ');

  // Search knowledge chunks for similar content
  const chunkResults = await semanticSearch(query, {
    limit: limit + 5, // fetch extra to filter out self
    sport: resource.sport_tags?.[0] ?? null,
  });

  // Map chunk results back to resource level (deduplicate by source_title)
  const seen = new Set([resource.title]); // exclude self
  const related = [];

  for (const chunk of chunkResults) {
    if (!seen.has(chunk.source_title) && related.length < limit) {
      seen.add(chunk.source_title);
      related.push({
        source_title:   chunk.source_title,
        source_author:  chunk.source_author,
        evidence_level: chunk.evidence_level,
        sport_tags:     chunk.sport_tags,
        topic_tags:     chunk.topic_tags,
        relevance_score: chunk.relevance_score,
      });
    }
  }

  // Also search for resources with overlapping tags
  if (resource.topic_tags?.length && related.length < limit) {
    for (const tag of resource.topic_tags.slice(0, 2)) {
      try {
        const tagResults = await apiClient.get(
          `/knowledge/resources?topic_tag=${encodeURIComponent(tag)}&limit=10`
        );
        for (const r of (tagResults?.data ?? [])) {
          if (r.id !== resourceId && related.length < limit) {
            related.push({
              resource_id:    r.id,
              source_title:   r.title,
              source_author:  r.author,
              evidence_level: r.evidence_level,
              sport_tags:     r.sport_tags,
              topic_tags:     r.topic_tags,
              relevance_score: null,
            });
          }
        }
      } catch { /* non-fatal */ }
    }
  }

  log.info({ resourceId, relatedCount: related.length }, 'related resources found');
  return related.slice(0, limit);
}

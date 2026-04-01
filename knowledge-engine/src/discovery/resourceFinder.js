// Resource Finder
// Discovers sports science resources on a given topic using Anthropic's
// web_search tool (paths B and C).
//
// Flow:
//   1. Receive topic + optional sport filter
//   2. Call Claude with web_search tool enabled
//   3. Parse 3 resource suggestions from the response
//   4. Create resource records via POST /knowledge/resources (status='queued')
//   5. Update the discover request (stored as a resource with source_type='discovery')
//
// Model: Sonnet — needs reasoning to evaluate source quality.

import Anthropic from '@anthropic-ai/sdk';
import pino from 'pino';
import { apiClient } from '../api/client.js';
import { logUsage } from '../notes/usageLogger.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const MODEL = 'claude-sonnet-4-6';
const SONNET_INPUT_COST_PER_TOKEN  = 3.00  / 1_000_000;
const SONNET_OUTPUT_COST_PER_TOKEN = 15.00 / 1_000_000;
const MAX_TOKENS = 1500;

const DISCOVER_PROMPT = (topic, sport) => `You are a sports science research assistant helping an endurance athlete build their knowledge library.

Find 3 high-quality resources (books, papers, or articles) on the topic: "${topic}"${sport ? ` relevant to ${sport}` : ''}.

For each resource, search the web and find:
- The exact title and author
- The publication type (book, paper, article)
- Evidence quality (A=RCT/systematic review, B=controlled study, C=expert consensus, D=anecdotal)
- A URL or reference where the athlete can find it
- A one-sentence description of why this is valuable for their training

Return a JSON array of 3 objects with these exact fields:
{
  "title": "...",
  "author": "...",
  "source_type": "book" | "paper" | "article",
  "evidence_level": "A" | "B" | "C" | "D" | "expert_opinion",
  "source_url": "https://...",
  "relevance_sentence": "..."
}

Prioritise peer-reviewed sources and books by established practitioners. Return only the JSON array.`;

// ---------------------------------------------------------------------------
// Parse discovery response
// ---------------------------------------------------------------------------

function parseDiscoveryResults(text) {
  // Extract JSON array from response (may be wrapped in markdown)
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) {
    log.warn({ text: text.slice(0, 200) }, 'no JSON array found in discovery response');
    return [];
  }
  try {
    const results = JSON.parse(match[0]);
    return Array.isArray(results) ? results.slice(0, 3) : [];
  } catch {
    log.warn('failed to parse discovery JSON');
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main: discover resources for a topic
// ---------------------------------------------------------------------------

/**
 * Discovers resources on a topic and creates resource records.
 *
 * @param {string} topic
 * @param {string|null} sport
 * @param {string} contextId - for usage logging
 * @returns {{ resources_created: number, resources: object[] }}
 */
export async function discoverResources(topic, sport = null, contextId = 'discovery') {
  log.info({ topic, sport }, 'discovering resources');

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let response;
  try {
    response = await client.messages.create({
      model:      MODEL,
      max_tokens: MAX_TOKENS,
      tools:      [{ type: 'web_search_20250305', name: 'web_search' }],
      messages:   [{ role: 'user', content: DISCOVER_PROMPT(topic, sport) }],
    });
  } catch (err) {
    // web_search tool may not be available in all regions/tiers
    // Fallback: ask Claude to recommend from training data
    log.warn({ err: err.message }, 'web_search tool unavailable — using knowledge fallback');
    response = await client.messages.create({
      model:      MODEL,
      max_tokens: MAX_TOKENS,
      messages:   [{ role: 'user', content: DISCOVER_PROMPT(topic, sport) + '\n\nNote: Use your training knowledge to recommend resources, no live search available.' }],
    });
  }

  const inputTokens = response.usage?.input_tokens  ?? 0;
  const outTokens   = response.usage?.output_tokens ?? 0;
  const costUsd     = inputTokens * SONNET_INPUT_COST_PER_TOKEN + outTokens * SONNET_OUTPUT_COST_PER_TOKEN;

  await logUsage(contextId, {
    model:         MODEL,
    call_type:     'discover_resources',
    input_tokens:  inputTokens,
    output_tokens: outTokens,
    cost_usd:      costUsd,
    metadata:      { topic, sport },
  });

  // Extract text content from response
  const textBlock = response.content.find(b => b.type === 'text');
  const text = textBlock?.text ?? '';
  const discovered = parseDiscoveryResults(text);

  log.info({ topic, found: discovered.length }, 'discovery complete');

  // Create resource records for each discovered resource
  const created = [];
  for (const r of discovered) {
    try {
      const resource = await apiClient.post('/knowledge/resources', {
        title:           r.title,
        author:          r.author            ?? null,
        source_type:     r.source_type       ?? 'other',
        source_url:      r.source_url        ?? null,
        evidence_level:  r.evidence_level    ?? 'C',
        sport_tags:      sport ? [sport] : [],
        topic_tags:      [topic.toLowerCase().replace(/\s+/g, '_')],
        discovery_topic: topic,
        ingestion_path:  'discovery',
      });
      if (resource) created.push(resource);
    } catch (err) {
      log.error({ title: r.title, err: err.message }, 'failed to create discovered resource');
    }
  }

  return { resources_created: created.length, resources: created, raw_results: discovered };
}

// ---------------------------------------------------------------------------
// Poller: process pending discovery requests
// ---------------------------------------------------------------------------

export async function pollAndDiscover() {
  // Discovery requests are stored as resources with ingestion_path='discovery_request'
  // and ingestion_status='pending'. When found, run discovery and mark done.
  const result = await apiClient.get('/knowledge/resources?limit=20');
  const pending = (result?.data ?? []).filter(r =>
    r.ingestion_path === 'discovery_request' && r.ingestion_status === 'pending'
  );

  if (!pending.length) {
    log.debug('no pending discovery requests');
    return [];
  }

  log.info({ count: pending.length }, 'processing pending discovery requests');
  const results = [];

  for (const req of pending) {
    try {
      const r = await discoverResources(req.discovery_topic, req.sport_tags?.[0], req.id);
      await apiClient.patch(`/knowledge/resources/${req.id}`, { ingestion_status: 'done' });
      results.push({ request_id: req.id, ...r });
    } catch (err) {
      log.error({ requestId: req.id, err: err.message }, 'discovery failed');
      results.push({ request_id: req.id, success: false, error: err.message });
    }
  }

  return results;
}

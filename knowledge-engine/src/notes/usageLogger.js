// Usage Logger
// Writes Anthropic API call costs to api_usage_log via POST /usage/log.
// Shared by all modules that make Anthropic calls.
// Non-critical — never throws; logs a warning on failure.
//
// Pattern mirrors coaching-engine/src/coach/conversationSummary.js logUsage().

import pino from 'pino';
import { apiClient } from '../api/client.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

/**
 * @param {string} contextId - resource ID, 'system', or any identifier for logging
 * @param {object} data
 * @param {string} data.model
 * @param {string} data.call_type
 * @param {number} data.input_tokens
 * @param {number} data.output_tokens
 * @param {number} data.cost_usd
 * @param {object} [data.metadata]
 */
export async function logUsage(contextId, data) {
  try {
    await apiClient.post('/usage/log', {
      service:       'anthropic',
      call_type:     data.call_type,
      model:         data.model,
      input_tokens:  data.input_tokens,
      output_tokens: data.output_tokens,
      cost_usd:      data.cost_usd,
      currency:      'USD',
      context_mode:  null,
      engine_mode:   null,
      metadata:      { context_id: contextId, ...(data.metadata ?? {}) },
    });
  } catch (err) {
    log.warn({ err: err.message, contextId }, 'usage log write failed (non-fatal)');
  }
}

// Athlete OS API HTTP client
// Thin axios wrapper — identical pattern to coaching-engine and knowledge-engine.

import axios from 'axios';
import pino from 'pino';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const MAX_RETRIES   = 3;
const RETRY_BASE_MS = 500;

const api = axios.create({
  baseURL: process.env.API_BASE_URL,
  headers: {
    'X-API-Key':    process.env.API_KEY,
    'Content-Type': 'application/json',
  },
  timeout: 30_000,
});

async function request(method, path, data, attempt = 1) {
  try {
    const res = await api.request({ method, url: path, data });
    return res.data;
  } catch (err) {
    const status = err.response?.status;
    if (status === 409) { log.debug({ path, method }, 'conflict'); return null; }
    if (status === 404) { log.debug({ path, method }, 'not found'); return null; }

    const retryable = !status || status >= 500;
    if (retryable && attempt <= MAX_RETRIES) {
      const delay = RETRY_BASE_MS * 2 ** (attempt - 1);
      log.warn({ path, method, attempt, delay, status }, 'retrying');
      await new Promise(r => setTimeout(r, delay));
      return request(method, path, data, attempt + 1);
    }

    log.error({ path, method, status, message: err.message }, 'api request failed');
    throw err;
  }
}

export const apiClient = {
  get:   (path)       => request('GET',   path),
  post:  (path, data) => request('POST',  path, data),
  patch: (path, data) => request('PATCH', path, data),
};

// Usage logger — all Anthropic calls in this service use this.
// Non-critical: never throws.
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
      context_mode:  data.context_mode ?? null,
      engine_mode:   data.engine_mode  ?? null,
      metadata:      { context_id: contextId, ...(data.metadata ?? {}) },
    });
  } catch (err) {
    log.warn({ err: err.message, contextId }, 'usage log write failed (non-fatal)');
  }
}

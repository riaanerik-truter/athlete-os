import axios from 'axios';
import pino from 'pino';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;

const api = axios.create({
  baseURL: process.env.API_BASE_URL,
  headers: {
    'X-API-Key': process.env.API_KEY,
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

    // 409 Conflict — caller decides what to do with null
    if (status === 409) {
      log.debug({ path, method }, 'conflict — skipping');
      return null;
    }

    // Retry on 5xx or network error
    const retryable = !status || status >= 500;
    if (retryable && attempt <= MAX_RETRIES) {
      const delay = RETRY_BASE_MS * 2 ** (attempt - 1);
      log.warn({ path, method, attempt, delay, status }, 'retrying after error');
      await new Promise(r => setTimeout(r, delay));
      return request(method, path, data, attempt + 1);
    }

    log.error({ path, method, status, message: err.message }, 'api request failed');
    throw err;
  }
}

export const apiClient = {
  get: (path) => request('GET', path),
  post: (path, data) => request('POST', path, data),
  patch: (path, data) => request('PATCH', path, data),
};

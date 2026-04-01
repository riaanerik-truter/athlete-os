import axios from 'axios';
import pino from 'pino';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
const STRAVA_API_BASE = 'https://www.strava.com/api/v3';

// In-memory token cache — refreshed as needed within the process lifetime
let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * Returns true if Strava credentials are configured in environment.
 */
export function stravaConfigured() {
  return !!(
    process.env.STRAVA_CLIENT_ID &&
    process.env.STRAVA_CLIENT_SECRET &&
    process.env.STRAVA_REFRESH_TOKEN
  );
}

/**
 * Returns a valid Strava access token, refreshing if expired or missing.
 * Throws if Strava is not configured.
 *
 * @returns {Promise<string>}
 */
export async function getAccessToken() {
  if (!stravaConfigured()) {
    throw new Error('Strava credentials not configured in .env');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  // Refresh if token is missing or expires within 60 seconds
  if (cachedToken && nowSec < tokenExpiresAt - 60) {
    return cachedToken;
  }

  log.debug('strava: refreshing access token');

  const res = await axios.post(STRAVA_TOKEN_URL, {
    client_id: process.env.STRAVA_CLIENT_ID,
    client_secret: process.env.STRAVA_CLIENT_SECRET,
    refresh_token: process.env.STRAVA_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });

  cachedToken = res.data.access_token;
  tokenExpiresAt = res.data.expires_at;

  log.info({ expiresAt: new Date(tokenExpiresAt * 1000).toISOString() }, 'strava: token refreshed');
  return cachedToken;
}

/**
 * Makes an authenticated GET request to the Strava API.
 * Handles 429 rate limiting: waits until reset epoch and retries once.
 *
 * @param {string} path  - e.g. '/athlete/activities'
 * @param {object} params - query params
 * @returns {Promise<any>}
 */
export async function stravaGet(path, params = {}) {
  const token = await getAccessToken();

  try {
    const res = await axios.get(`${STRAVA_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      params,
      timeout: 30_000,
    });
    return res.data;
  } catch (err) {
    const status = err.response?.status;

    if (status === 429) {
      // Rate limited — wait until reset window
      const resetEpoch = Number(err.response.headers['x-ratelimit-reset'] ?? 0);
      const waitMs = resetEpoch ? (resetEpoch * 1000 - Date.now() + 1000) : 60_000;
      log.warn({ waitMs, path }, 'strava: rate limited — waiting for reset');
      await new Promise(r => setTimeout(r, Math.max(waitMs, 1000)));
      // Retry once after wait
      const retryToken = await getAccessToken();
      const retryRes = await axios.get(`${STRAVA_API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${retryToken}` },
        params,
        timeout: 30_000,
      });
      return retryRes.data;
    }

    log.error({ path, status, message: err.message }, 'strava: request failed');
    throw err;
  }
}

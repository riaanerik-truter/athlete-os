// Message Handler
// Main inbound message router.
//
// Flow:
//   1. Check for slash command → route to commandHandler
//   2. Log inbound message to /conversations via API
//   3. Route to coaching engine (POST /conversations, coachHandler reads it)
//   4. Log response to /conversations
//   5. Return response string to provider
//
// This module is channel-agnostic. Providers call handleInboundMessage()
// and receive back a plain string. The provider handles channel-specific
// delivery (markdown rendering, send method selection).

import pino from 'pino';
import { apiClient } from '../api/client.js';
import { isCommand, routeCommand } from './commandHandler.js';
import { renderMarkdown } from '../formatting/markdown.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// ---------------------------------------------------------------------------
// Athlete identity resolution
// ---------------------------------------------------------------------------

// Cache athlete ID — single-athlete system, doesn't change at runtime
let _athleteId = null;

export async function resolveAthleteId() {
  if (_athleteId) return _athleteId;
  try {
    const athlete = await apiClient.get('/athlete');
    _athleteId = athlete?.id ?? null;
    return _athleteId;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Conversation logging
// ---------------------------------------------------------------------------

// Map messaging-service role names → API conversation role enum
const ROLE_MAP = { user: 'athlete', assistant: 'coach' };

async function logMessage(role, content, channel) {
  try {
    await apiClient.post('/conversations', {
      role:       ROLE_MAP[role] ?? role,
      content,
      channel,
      message_ts: new Date().toISOString(),
    });
  } catch (err) {
    log.warn({ err: err.message }, 'failed to log message to conversation table');
  }
}

// ---------------------------------------------------------------------------
// Coaching engine — direct HTTP call
// POST to coaching engine's /message endpoint for real-time responses.
// COACHING_ENGINE_URL defaults to http://localhost:3002
// ---------------------------------------------------------------------------

const COACHING_ENGINE_URL = process.env.COACHING_ENGINE_URL ?? 'http://localhost:3002';
const COACHING_ENGINE_TIMEOUT_MS = 60_000; // Anthropic calls can take up to ~30s

async function callCoachingEngine(athleteId, message, channel) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), COACHING_ENGINE_TIMEOUT_MS);

    const res = await fetch(`${COACHING_ENGINE_URL}/message`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key':    process.env.API_KEY ?? '',
      },
      body:   JSON.stringify({ athleteId, message, channel }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      log.error({ status: res.status, url: COACHING_ENGINE_URL }, 'coaching engine returned error');
      return "Sorry, the coaching engine returned an error. Please try again.";
    }

    const data = await res.json();
    return data.response ?? '';
  } catch (err) {
    if (err.name === 'AbortError') {
      log.error('coaching engine request timed out');
      return "The coach is taking longer than expected. Please try again in a moment.";
    }
    log.error({ err: err.message }, 'coaching engine call failed');
    return "Sorry, I couldn't reach the coaching engine. Check that it is running.";
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * Handles an inbound message from any channel.
 *
 * @param {string} athleteId - resolved athlete UUID
 * @param {string} text      - raw message text
 * @param {string} channel   - 'telegram' | 'whatsapp' | 'web'
 * @param {object} [file]    - optional attached file { name, path, mimeType }
 * @returns {string} response text (unrendered — caller renders for channel)
 */
export async function handleInboundMessage(athleteId, text, channel, file = null) {
  log.info({ channel, messageLength: text?.length, hasFile: !!file }, 'inbound message');

  // 1. Slash command check — intercept before logging or coaching engine
  if (isCommand(text)) {
    const response = await routeCommand(text, athleteId, channel);
    // Commands log their own output — don't double-log
    return response;
  }

  // 2. Log inbound message
  await logMessage('user', text, channel);

  // 3. Handle attached file if present
  if (file) {
    const { handleInboundFile } = await import('./fileHandler.js');
    const fileResult = await handleInboundFile(file, channel, athleteId);
    if (fileResult?.message) {
      await logMessage('assistant', fileResult.message, channel);
      return fileResult.message;
    }
  }

  // 4. Route to coaching engine
  const response = await callCoachingEngine(athleteId, text, channel);

  // 5. Log response
  if (response) {
    await logMessage('assistant', response, channel);
  }

  return response ?? '';
}

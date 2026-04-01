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
// Coaching engine poll
// The coaching engine is a separate process that polls the conversation table
// on a 30-second cycle. messageHandler logs the inbound user message, then
// polls the conversation table for up to 15 seconds waiting for a coach reply.
// If the coaching engine hasn't responded in time, a holding message is returned.
// ---------------------------------------------------------------------------

async function callCoachingEngine(athleteId, message, channel) {
  // The coaching engine doesn't yet expose an HTTP server.
  // In the integrated deployment (all services co-located), we import
  // the coaching engine handler directly.
  //
  // For now: post the message to the conversation table and trigger
  // the coaching engine via POST /sync/trigger.
  // The coaching engine will pick this up on its next poll cycle.
  //
  // Phase 2: add a lightweight HTTP endpoint to the coaching engine
  // and call it here for real-time responses.

  // The coaching engine polls the conversation table independently (30s cycle).
  // We log the user message above, then poll here for up to 15s for a coach reply.
  // If the coaching engine hasn't responded in time, return a holding message.
  try {
    // Snapshot the latest coach message before we start polling.
    // Use limit=10 so we look past the athlete message we just logged.
    const before = await apiClient.get('/conversations?limit=10');
    const lastCoachMsg = (before?.data ?? []).find(m => m.role === 'coach')?.content ?? null;

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 1_500));
      const conv = await apiClient.get('/conversations?limit=5');
      const messages = conv?.data ?? [];
      const latest = messages.find(m => m.role === 'coach');
      if (latest && latest.content !== lastCoachMsg) {
        return latest.content;
      }
    }

    return "I'm processing your message. I'll respond shortly.";
  } catch (err) {
    log.error({ err: err.message }, 'coaching engine poll failed');
    return "Sorry, I had trouble processing that. Please try again.";
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

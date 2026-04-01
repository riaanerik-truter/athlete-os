// Notification Handler
// Sends proactive notifications to the athlete via the active channel provider.
//
// Each notification type has a proactive_scale threshold (set in user_settings.json).
// A notification is only sent if the athlete's proactive_scale >= threshold.
//
// Routing:
//   Active primary provider (Discord or Telegram) → sendMarkdown()
//   Web chat (if running) → broadcast()
//   All notifications logged to /conversations as role: 'coach'

import pino from 'pino';
import { readFileSync } from 'fs';
import { shouldSend } from '../formatting/markdown.js';
import { apiClient } from '../api/client.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// Lazily loaded to avoid circular imports — providers import messageHandler
// which imports nothing from providers. notificationHandler is called from
// index.js after all modules are loaded.
let _send = null;
let _broadcast = null;

export function registerSenders({ send, broadcast }) {
  _send = send;
  _broadcast = broadcast;
}

// ---------------------------------------------------------------------------
// Core send — checks scale, sends, logs to conversation table
// ---------------------------------------------------------------------------

/**
 * Sends a proactive notification if the athlete's proactive_scale allows it.
 *
 * @param {string} type     - notification type key (e.g. 'morning_digest')
 * @param {string} message  - formatted markdown message string
 * @param {string} channel  - active channel name (for conversation log)
 */
export async function sendNotification(type, message, channel = 'discord') {
  const settings = loadSettings();
  const scale    = settings.proactive_scale ?? 3;

  if (!shouldSend(type, scale)) {
    log.debug({ type, scale }, 'notification suppressed by proactive_scale');
    return;
  }

  log.info({ type, channel }, 'sending proactive notification');

  // Send via primary provider
  if (_send) {
    try {
      await _send(message);
    } catch (err) {
      log.error({ err: err.message, type }, 'primary provider send failed');
    }
  } else {
    log.warn({ type }, 'no primary provider registered — notification not sent');
  }

  // Broadcast to web chat clients if any are connected
  if (_broadcast) {
    try {
      _broadcast(message);
    } catch (err) {
      log.warn({ err: err.message }, 'web chat broadcast failed');
    }
  }

  // Log to conversation table
  try {
    await apiClient.post('/conversations', {
      role:       'coach',
      content:    message,
      channel,
      message_ts: new Date().toISOString(),
      intent:     type,
    });
  } catch (err) {
    log.warn({ err: err.message, type }, 'failed to log notification to conversation table');
  }
}

// ---------------------------------------------------------------------------
// Settings loader — reads fresh each call (settings can change at runtime)
// ---------------------------------------------------------------------------

function loadSettings() {
  try {
    return JSON.parse(readFileSync(new URL('../../user_settings.json', import.meta.url)));
  } catch {
    return { proactive_scale: 3 };
  }
}

// ---------------------------------------------------------------------------
// Active channel helper — used by index.js to know what channel label to log
// ---------------------------------------------------------------------------

export function activeChannelName() {
  if (process.env.DISCORD_BOT_TOKEN) return 'discord';
  if (process.env.TELEGRAM_BOT_TOKEN) return 'telegram';
  return 'api';
}

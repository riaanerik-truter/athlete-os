// Telegram Provider
// Polling mode — no webhook, no public URL required for development.
//
// Inbound: parses message → routes to handleInboundMessage → sends response
// Outbound: send(), sendMarkdown() — channel-specific rendering handled here
//
// File handling:
//   photo    → downloads largest photo, passes as file { name, path, mimeType }
//   document → downloads document, passes as file { name, path, mimeType }
//   Other file types not yet supported.

import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import { handleInboundMessage, resolveAthleteId } from '../handlers/messageHandler.js';
import { renderMarkdown } from '../formatting/markdown.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// Download dir for incoming files
const DOWNLOAD_DIR = path.join(process.cwd(), 'tmp', 'telegram-downloads');
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Bot lifecycle
// ---------------------------------------------------------------------------

let _bot = null;

export async function startTelegram() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    log.warn('TELEGRAM_BOT_TOKEN not set — Telegram provider disabled');
    return null;
  }

  _bot = new TelegramBot(token, { polling: true });

  // Log bot identity on startup
  const me = await _bot.getMe();
  log.info({ username: me.username, id: me.id }, 'Telegram bot connected');

  _bot.on('message', onMessage);
  _bot.on('polling_error', err => {
    log.error({ err: err.message }, 'Telegram polling error');
  });

  return _bot;
}

export function stopTelegram() {
  if (_bot) {
    _bot.stopPolling();
    _bot = null;
  }
}

// ---------------------------------------------------------------------------
// Inbound message handler
// ---------------------------------------------------------------------------

async function onMessage(msg) {
  log.info({ msg }, 'Telegram raw message received');

  const chatId = msg.chat.id;
  const text = msg.text ?? msg.caption ?? '';

  // Resolve athlete ID — cached after first call
  const athleteId = await resolveAthleteId();
  if (!athleteId) {
    log.error('Cannot resolve athlete ID — skipping message');
    await sendRaw(chatId, 'System error: athlete not found. Check API connection.');
    return;
  }

  // Handle file attachment if present
  let file = null;
  try {
    file = await resolveFile(msg);
  } catch (err) {
    log.warn({ err: err.message }, 'file download failed');
  }

  // Route to message handler
  let response;
  try {
    response = await handleInboundMessage(athleteId, text, 'telegram', file);
  } catch (err) {
    log.error({ err: err.message }, 'message handler failed');
    response = 'Sorry, something went wrong. Please try again.';
  }

  if (response) {
    await sendMarkdown(chatId, response);
  }
}

// ---------------------------------------------------------------------------
// File resolution
// ---------------------------------------------------------------------------

async function resolveFile(msg) {
  if (!_bot) return null;

  // Photo — use the largest size
  if (msg.photo?.length) {
    const photo = msg.photo[msg.photo.length - 1];
    return downloadFile(photo.file_id, `photo_${photo.file_id}.jpg`, 'image/jpeg');
  }

  // Document
  if (msg.document) {
    const { file_id, file_name, mime_type } = msg.document;
    return downloadFile(file_id, file_name ?? `doc_${file_id}`, mime_type ?? 'application/octet-stream');
  }

  return null;
}

async function downloadFile(fileId, fileName, mimeType) {
  const fileLink = await _bot.getFileLink(fileId);
  const filePath = path.join(DOWNLOAD_DIR, fileName);

  // axios-free fetch via the bot's internal axios instance
  const response = await fetch(fileLink);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

  return { name: fileName, path: filePath, mimeType };
}

// ---------------------------------------------------------------------------
// Outbound methods
// ---------------------------------------------------------------------------

/**
 * Sends a plain text message.
 */
export async function send(chatId, text) {
  await sendRaw(chatId, text);
}

/**
 * Renders text for Telegram and sends.
 * Uses parse_mode: 'Markdown' (legacy, simpler than MarkdownV2).
 */
export async function sendMarkdown(chatId, text) {
  const rendered = renderMarkdown(text, 'telegram');
  await sendRaw(chatId, rendered, { parse_mode: 'Markdown' });
}

async function sendRaw(chatId, text, options = {}) {
  if (!_bot) {
    log.warn({ chatId }, 'send called but Telegram bot not started');
    return;
  }
  try {
    // Telegram message limit is 4096 characters — split if needed
    if (text.length <= 4096) {
      await _bot.sendMessage(chatId, text, options);
    } else {
      const chunks = splitMessage(text, 4096);
      for (const chunk of chunks) {
        await _bot.sendMessage(chatId, chunk, options);
      }
    }
  } catch (err) {
    log.error({ err: err.message, chatId }, 'Telegram send failed');
  }
}

function splitMessage(text, maxLen) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    // Try to split on a newline near the boundary
    let end = start + maxLen;
    if (end < text.length) {
      const breakAt = text.lastIndexOf('\n', end);
      if (breakAt > start) end = breakAt;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

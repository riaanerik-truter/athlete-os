// WhatsApp Provider — Twilio
// Activated only when TWILIO_ACCOUNT_SID is set in .env.
//
// Inbound: Twilio webhook POST → Express route → onMessage → handleInboundMessage
// Outbound: send(), sendMarkdown() → Twilio Messages API
//
// WhatsApp markdown: *bold*, _italic_ — same conversion as Telegram.
// Twilio sandbox number format: 'whatsapp:+<number>'
//
// Webhook setup:
//   Twilio Console → Messaging → Sandbox → Webhook URL:
//   http://<your-host>:3002/webhook/whatsapp
//   (or expose via ngrok for local dev: ngrok http 3002)

import twilio from 'twilio';
import express from 'express';
import pino from 'pino';
import { handleInboundMessage, resolveAthleteId } from '../handlers/messageHandler.js';
import { renderMarkdown } from '../formatting/markdown.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const WHATSAPP_PORT = parseInt(process.env.WHATSAPP_WEBHOOK_PORT ?? '3002', 10);

let _client = null;
let _from   = null;   // 'whatsapp:+<number>'
let _server = null;

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function startWhatsApp() {
  if (_client) {
    log.warn('startWhatsApp called while already running — skipping');
    return _client;
  }

  const sid    = process.env.TWILIO_ACCOUNT_SID;
  const token  = process.env.TWILIO_AUTH_TOKEN;
  const number = process.env.TWILIO_WHATSAPP_NUMBER;

  if (!sid || !token || !number) {
    log.warn('Twilio credentials incomplete — WhatsApp provider disabled');
    return null;
  }

  _client = twilio(sid, token);
  _from   = number.startsWith('whatsapp:') ? number : `whatsapp:${number}`;

  // Verify credentials with a lightweight API call
  try {
    await _client.api.accounts(sid).fetch();
    log.info({ from: _from }, 'WhatsApp (Twilio) provider connected');
  } catch (err) {
    log.error({ err: err.message }, 'Twilio credential verification failed');
    _client = null;
    return null;
  }

  // Start webhook server
  _server = startWebhookServer();

  return _client;
}

export function stopWhatsApp() {
  if (_server) {
    _server.close();
    _server = null;
  }
  _client = null;
  _from   = null;
}

// ---------------------------------------------------------------------------
// Webhook server — receives inbound messages from Twilio
// ---------------------------------------------------------------------------

function startWebhookServer() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));

  app.post('/webhook/whatsapp', async (req, res) => {
    // Twilio sends form-encoded body
    const from    = req.body.From ?? '';    // 'whatsapp:+27...'
    const body    = req.body.Body ?? '';
    const mediaUrl  = req.body.MediaUrl0 ?? null;
    const mediaType = req.body.MediaContentType0 ?? null;
    const numMedia  = parseInt(req.body.NumMedia ?? '0', 10);

    log.info(
      { from, bodyLength: body.length, numMedia },
      'WhatsApp message received',
    );

    // Respond to Twilio immediately with empty TwiML (we send separately)
    res.set('Content-Type', 'text/xml');
    res.send('<Response></Response>');

    const athleteId = await resolveAthleteId();
    if (!athleteId) {
      log.error('Cannot resolve athlete ID — skipping WhatsApp message');
      return;
    }

    // Resolve media attachment if present
    let file = null;
    if (numMedia > 0 && mediaUrl) {
      try {
        file = await downloadMedia(mediaUrl, mediaType);
      } catch (err) {
        log.warn({ err: err.message }, 'WhatsApp media download failed');
      }
    }

    // Route to message handler
    let response;
    try {
      response = await handleInboundMessage(athleteId, body, 'whatsapp', file);
    } catch (err) {
      log.error({ err: err.message }, 'message handler failed');
      response = 'Sorry, something went wrong. Please try again.';
    }

    if (response) {
      await send(from, response);
    }
  });

  const server = app.listen(WHATSAPP_PORT, () => {
    log.info({ port: WHATSAPP_PORT }, 'WhatsApp webhook server listening');
  });

  server.on('error', err => {
    log.error({ err: err.message }, 'WhatsApp webhook server error');
  });

  return server;
}

// ---------------------------------------------------------------------------
// Media download
// ---------------------------------------------------------------------------

import fs from 'fs';
import path from 'path';

const DOWNLOAD_DIR = path.join(process.cwd(), 'tmp', 'whatsapp-downloads');
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

async function downloadMedia(url, mimeType) {
  const ext      = mimeType ? '.' + mimeType.split('/')[1] : '.bin';
  const fileName = `wa_${Date.now()}${ext}`;
  const filePath = path.join(DOWNLOAD_DIR, fileName);

  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;

  // Twilio media URLs require Basic auth
  const res = await fetch(url, {
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching WhatsApp media`);

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

  return { name: fileName, path: filePath, mimeType: mimeType ?? 'application/octet-stream' };
}

// ---------------------------------------------------------------------------
// Outbound methods
// ---------------------------------------------------------------------------

/**
 * Sends a plain text message to a WhatsApp number.
 * @param {string} to - 'whatsapp:+<number>'
 */
export async function send(to, text) {
  await sendRaw(to, text);
}

/**
 * Renders markdown for WhatsApp and sends.
 * @param {string} to - 'whatsapp:+<number>'
 */
export async function sendMarkdown(to, text) {
  const rendered = renderMarkdown(text, 'whatsapp');
  await sendRaw(to, rendered);
}

async function sendRaw(to, text) {
  if (!_client || !_from) {
    log.warn('WhatsApp send called but provider not started');
    return;
  }
  try {
    // WhatsApp messages via Twilio have a 1600-char limit
    const chunks = text.length <= 1600 ? [text] : splitMessage(text, 1600);
    for (const chunk of chunks) {
      await _client.messages.create({ from: _from, to, body: chunk });
    }
  } catch (err) {
    log.error({ err: err.message, to }, 'WhatsApp send failed');
  }
}

function splitMessage(text, maxLen) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
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

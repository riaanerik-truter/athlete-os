// Web Chat Provider
// WebSocket server for the web dashboard chat interface.
//
// Flow:
//   connect → assign athlete_id from API
//   message received → JSON parse → route to handleInboundMessage
//   response → push { role: 'coach', content, timestamp } JSON
//
// Protocol:
//   Client sends:  { text: string, file?: { name, mimeType, dataBase64 } }
//   Server sends:  { role: 'coach' | 'user', content: string, timestamp: ISO }
//                  { type: 'error', message: string }
//
// Single-athlete system — one athlete_id shared by all connections.

import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import { handleInboundMessage, resolveAthleteId } from '../handlers/messageHandler.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const DOWNLOAD_DIR = path.join(process.cwd(), 'tmp', 'webchat-uploads');
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

let _wss = null;

export function startWebChat(port) {
  const wsPort = port ?? parseInt(process.env.WEB_CHAT_PORT ?? '3001', 10);

  _wss = new WebSocketServer({ port: wsPort });

  _wss.on('listening', () => {
    log.info({ port: wsPort }, 'Web chat WebSocket server listening');
  });

  _wss.on('connection', onConnection);

  _wss.on('error', err => {
    log.error({ err: err.message }, 'WebSocket server error');
  });

  return _wss;
}

export function stopWebChat() {
  if (_wss) {
    _wss.close();
    _wss = null;
  }
}

// ---------------------------------------------------------------------------
// Connection handler
// ---------------------------------------------------------------------------

async function onConnection(ws) {
  log.info('Web chat client connected');

  const athleteId = await resolveAthleteId();
  if (!athleteId) {
    log.error('Cannot resolve athlete ID — closing web chat connection');
    sendError(ws, 'System error: athlete not found. Check API connection.');
    ws.close();
    return;
  }

  ws.on('message', async (raw) => {
    let parsed;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      sendError(ws, 'Invalid message format. Expected JSON.');
      return;
    }

    const { text, file: filePayload } = parsed;

    if (!text && !filePayload) {
      sendError(ws, 'Message must include text or a file.');
      return;
    }

    // Echo user message back to client
    sendMessage(ws, 'user', text ?? '');

    // Resolve file if attached
    let file = null;
    if (filePayload) {
      try {
        file = saveBase64File(filePayload);
      } catch (err) {
        log.warn({ err: err.message }, 'failed to save uploaded file');
      }
    }

    // Route to message handler
    let response;
    try {
      response = await handleInboundMessage(athleteId, text ?? '', 'web', file);
    } catch (err) {
      log.error({ err: err.message }, 'message handler failed');
      response = 'Sorry, something went wrong. Please try again.';
    }

    if (response) {
      sendMessage(ws, 'coach', response);
    }
  });

  ws.on('close', () => {
    log.info('Web chat client disconnected');
  });

  ws.on('error', err => {
    log.error({ err: err.message }, 'WebSocket connection error');
  });
}

// ---------------------------------------------------------------------------
// File handling
// ---------------------------------------------------------------------------

function saveBase64File({ name, mimeType, dataBase64 }) {
  if (!name || !dataBase64) return null;
  const safeFileName = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = path.join(DOWNLOAD_DIR, `${Date.now()}_${safeFileName}`);
  const buffer = Buffer.from(dataBase64, 'base64');
  fs.writeFileSync(filePath, buffer);
  return { name: safeFileName, path: filePath, mimeType: mimeType ?? 'application/octet-stream' };
}

// ---------------------------------------------------------------------------
// Outbound helpers
// ---------------------------------------------------------------------------

function sendMessage(ws, role, content) {
  if (ws.readyState !== 1) return; // OPEN = 1
  ws.send(JSON.stringify({
    role,
    content,
    timestamp: new Date().toISOString(),
  }));
}

function sendError(ws, message) {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'error', message }));
}

/**
 * Broadcast a message to all connected clients.
 * Used by notificationHandler for proactive alerts.
 */
export function broadcast(content) {
  if (!_wss) return;
  const payload = JSON.stringify({
    role: 'coach',
    content,
    timestamp: new Date().toISOString(),
  });
  for (const client of _wss.clients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}

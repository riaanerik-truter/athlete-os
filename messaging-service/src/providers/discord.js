// Discord Provider
// Uses discord.js v14. Bot listens on a single coach channel (DISCORD_CHANNEL_ID).
//
// Inbound: messageCreate on the coach channel → route to handleInboundMessage
// Outbound: send(), sendMarkdown() — writes back to the same coach channel
//
// Attachment handling:
//   Any attachment on the message is downloaded to tmp/discord-downloads/
//   and passed to handleInboundMessage as { name, path, mimeType }
//   Only the first attachment is processed per message.
//
// Bot filter: messages from bots are always ignored to prevent feedback loops.

import { Client, GatewayIntentBits } from 'discord.js';
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import { handleInboundMessage, resolveAthleteId } from '../handlers/messageHandler.js';
import { renderMarkdown } from '../formatting/markdown.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const DOWNLOAD_DIR = path.join(process.cwd(), 'tmp', 'discord-downloads');
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

// Discord message character limit
const DISCORD_MAX_LEN = 2000;

// ---------------------------------------------------------------------------
// Client setup
// ---------------------------------------------------------------------------

let _client = null;
let _channel = null;

export async function startDiscord() {
  if (_client) {
    log.warn('startDiscord called while client already running — skipping');
    return _client;
  }

  const token     = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.DISCORD_CHANNEL_ID;

  if (!token) {
    log.warn('DISCORD_BOT_TOKEN not set — Discord provider disabled');
    return null;
  }
  if (!channelId) {
    log.warn('DISCORD_CHANNEL_ID not set — Discord provider disabled');
    return null;
  }

  _client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  _client.once('ready', async () => {
    // Fetch and cache the coach channel
    try {
      _channel = await _client.channels.fetch(channelId);
    } catch (err) {
      log.error({ err: err.message, channelId }, 'could not fetch Discord channel');
    }

    const guild = _channel?.guild?.name ?? process.env.DISCORD_GUILD_ID ?? 'unknown guild';
    log.info(
      { username: _client.user.tag, guild, channel: _channel?.name ?? channelId },
      'Discord bot connected',
    );

    // Register the message listener exactly once, after the channel is available.
    // removeAllListeners guards against any stale registrations from prior runs.
    _client.removeAllListeners('messageCreate');
    _client.on('messageCreate', onMessage);
  });

  _client.on('error', err => {
    log.error({ err: err.message }, 'Discord client error');
  });

  await _client.login(token);
  return _client;
}

export function stopDiscord() {
  if (_client) {
    _client.destroy();
    _client = null;
    _channel = null;
  }
}

// ---------------------------------------------------------------------------
// Inbound message handler
// ---------------------------------------------------------------------------

async function onMessage(message) {
  // Ignore bots (including self)
  if (message.author.bot) return;

  // Only handle messages in the designated coach channel
  if (message.channelId !== process.env.DISCORD_CHANNEL_ID) return;

  log.info(
    {
      author: message.author.tag,
      channelId: message.channelId,
      contentLength: message.content.length,
      attachments: message.attachments.size,
    },
    'Discord message received',
  );

  const athleteId = await resolveAthleteId();
  if (!athleteId) {
    log.error('Cannot resolve athlete ID — skipping Discord message');
    await sendRaw('System error: athlete not found. Check API connection.');
    return;
  }

  // Resolve first attachment if present
  let file = null;
  const attachment = message.attachments.first();
  if (attachment) {
    try {
      file = await downloadAttachment(attachment);
    } catch (err) {
      log.warn({ err: err.message }, 'Discord attachment download failed');
    }
  }

  let response;
  try {
    response = await handleInboundMessage(athleteId, message.content, 'discord', file);
  } catch (err) {
    log.error({ err: err.message }, 'message handler failed');
    response = 'Sorry, something went wrong. Please try again.';
  }

  if (response) {
    await sendMarkdown(response);
  }
}

// ---------------------------------------------------------------------------
// Attachment download
// ---------------------------------------------------------------------------

async function downloadAttachment(attachment) {
  const fileName = attachment.name ?? `attachment_${attachment.id}`;
  const safeName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = path.join(DOWNLOAD_DIR, `${Date.now()}_${safeName}`);

  const res = await fetch(attachment.url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching attachment`);

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

  return {
    name: safeName,
    path: filePath,
    mimeType: attachment.contentType ?? 'application/octet-stream',
  };
}

// ---------------------------------------------------------------------------
// Outbound methods
// ---------------------------------------------------------------------------

/**
 * Sends plain text to the coach channel.
 */
export async function send(text) {
  await sendRaw(text);
}

/**
 * Renders markdown for Discord and sends to the coach channel.
 */
export async function sendMarkdown(text) {
  const rendered = renderMarkdown(text, 'discord');
  await sendRaw(rendered);
}

async function sendRaw(text) {
  if (!_channel) {
    log.warn('sendRaw called but Discord channel not available');
    return;
  }
  try {
    if (text.length <= DISCORD_MAX_LEN) {
      await _channel.send(text);
    } else {
      for (const chunk of splitMessage(text, DISCORD_MAX_LEN)) {
        await _channel.send(chunk);
      }
    }
  } catch (err) {
    log.error({ err: err.message }, 'Discord send failed');
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

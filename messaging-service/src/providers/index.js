// Providers index
// Starts the appropriate providers based on .env and user_settings.json.
//
// Primary provider priority (one chat provider at a time):
//   1. DISCORD_BOT_TOKEN set → Discord
//   2. TELEGRAM_BOT_TOKEN set + telegram.enabled → Telegram
//   3. TWILIO_ACCOUNT_SID set + whatsapp.enabled → WhatsApp (via webhook)
//
// Web chat always starts alongside any primary provider (if web_chat.enabled).
//
// After startup, registers sendMarkdown and broadcast with notificationHandler
// so proactive notifications can reach the athlete.

import pino from 'pino';
import { startDiscord, stopDiscord, sendMarkdown as discordSend } from './discord.js';
import { startTelegram, stopTelegram } from './telegram.js';
import { startWebChat, stopWebChat, broadcast } from './webChat.js';
import { startWhatsApp, stopWhatsApp } from './whatsapp.js';
import { registerSenders } from '../handlers/notificationHandler.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

let _activeProvider = null; // 'discord' | 'telegram' | 'whatsapp' | null

// Telegram's sendMarkdown takes (chatId, text) — for notifications we need
// a single-arg wrapper. Telegram notifies the configured chat ID.
import { sendMarkdown as telegramSendMarkdown } from './telegram.js';
import { sendMarkdown as whatsappSendMarkdown } from './whatsapp.js';

async function telegramSend(text) {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) {
    log.warn('TELEGRAM_CHAT_ID not set — cannot send proactive Telegram notification');
    return;
  }
  return telegramSendMarkdown(chatId, text);
}

// WhatsApp notifies the verified athlete number.
async function whatsappSend(text) {
  const number = process.env.TWILIO_WHATSAPP_NUMBER;
  if (!number) {
    log.warn('TWILIO_WHATSAPP_NUMBER not set — cannot send proactive WhatsApp notification');
    return;
  }
  const to = number.startsWith('whatsapp:') ? number : `whatsapp:${number}`;
  return whatsappSendMarkdown(to, text);
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

export async function startProviders(settings) {
  const channels = settings.channels ?? {};
  let primarySend = null;

  // Primary chat provider — first matching wins
  if (process.env.DISCORD_BOT_TOKEN) {
    try {
      await startDiscord();
      _activeProvider = 'discord';
      primarySend = text => discordSend(text);
      log.info('primary provider: discord');
    } catch (err) {
      log.error({ err: err.message }, 'Discord failed to start');
    }
  }

  if (!_activeProvider && process.env.TELEGRAM_BOT_TOKEN && channels.telegram?.enabled) {
    try {
      await startTelegram();
      _activeProvider = 'telegram';
      primarySend = telegramSend;
      log.info('primary provider: telegram');
    } catch (err) {
      log.error({ err: err.message }, 'Telegram failed to start');
    }
  }

  if (!_activeProvider && process.env.TWILIO_ACCOUNT_SID && channels.whatsapp?.enabled) {
    try {
      await startWhatsApp();
      _activeProvider = 'whatsapp';
      primarySend = whatsappSend;
      log.info('primary provider: whatsapp');
    } catch (err) {
      log.error({ err: err.message }, 'WhatsApp failed to start');
    }
  }

  if (!_activeProvider) {
    log.warn('no primary chat provider configured');
  }

  // Web chat — always alongside primary if enabled
  if (channels.web_chat?.enabled) {
    startWebChat(channels.web_chat.port);
  }

  // Wire notification senders so proactive notifications reach the athlete
  registerSenders({
    send:      primarySend,
    broadcast: broadcast,
  });
}

// ---------------------------------------------------------------------------
// Stop
// ---------------------------------------------------------------------------

export function stopProviders() {
  stopDiscord();
  stopTelegram();
  stopWhatsApp();
  stopWebChat();
}

export function activeProvider() {
  return _activeProvider;
}

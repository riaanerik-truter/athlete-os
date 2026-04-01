// Markdown Renderer
// Renders a message template differently per channel:
//   telegram  — native MarkdownV2 passthrough (Telegram renders it natively)
//   whatsapp  — ** → *, underscores preserved, no HTML
//   web       — full HTML via marked()
//
// Message style guidelines (enforced by callers, not this module):
//   - Minimal bold/italic — only genuinely critical information
//   - Generous bullet points and numbered lists
//   - Short paragraphs — mobile-first
//   - Never exceed 3 paragraphs without a list break

import { marked } from 'marked';

// ---------------------------------------------------------------------------
// Telegram MarkdownV2 escaping
// Telegram MarkdownV2 requires escaping: _ * [ ] ( ) ~ ` > # + - = | { } . !
// We escape everything EXCEPT formatting characters we intentionally use.
// ---------------------------------------------------------------------------

const TG_ESCAPE_RE = /([_[\]()~`>#+\-=|{}.!])/g;

/**
 * Escapes special characters for Telegram MarkdownV2.
 * Preserves ** (bold) and * (italic) intentional markers.
 * Call this on plain-text segments — not on the whole message.
 */
export function escapeTelegram(text) {
  // Only escape chars that Telegram requires; leave * and _ for formatting
  return text.replace(/([[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

// ---------------------------------------------------------------------------
// Main renderer
// ---------------------------------------------------------------------------

/**
 * Renders markdown text for a specific channel.
 *
 * @param {string} text     - source message (uses ** bold, _italic_, bullet lists)
 * @param {string} channel  - 'telegram' | 'whatsapp' | 'web'
 * @returns {string} rendered text ready to send
 */
export function renderMarkdown(text, channel) {
  if (!text) return '';

  switch (channel) {
    case 'discord':
      // Discord renders ** bold, * italic, ` code natively — passthrough.
      return text;

    case 'telegram':
      // Telegram supports native markdown — pass through with light cleanup.
      // Convert **bold** to *bold* (Telegram MarkdownV2 uses single * for bold
      // when using legacy Markdown mode; we use parse_mode: 'Markdown').
      return text
        .replace(/\*\*(.*?)\*\*/g, '*$1*');   // **bold** → *bold*

    case 'whatsapp':
      // WhatsApp uses *bold*, _italic_ — same as Telegram legacy Markdown.
      return text
        .replace(/\*\*(.*?)\*\*/g, '*$1*');   // **bold** → *bold*
                                               // _italic_ already correct

    case 'web':
      // Full HTML via marked — dashboard renders HTML in a chat bubble.
      return marked.parse(text, { breaks: true, gfm: true });

    default:
      // Strip all markdown for unknown channels
      return text
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/_(.*?)_/g, '$1')
        .replace(/\*(.*?)\*/g, '$1');
  }
}

// ---------------------------------------------------------------------------
// Plain text stripper — used when channel doesn't support any formatting
// ---------------------------------------------------------------------------

export function stripMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .replace(/^#+\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .trim();
}

// ---------------------------------------------------------------------------
// shouldSend — proactive notification scale check
// Lives here because it has no channel dependency and is used by all senders.
// ---------------------------------------------------------------------------

const THRESHOLDS = {
  recovery_alert:      1,
  milestone:           2,
  morning_digest:      3,
  plan_revision:       3,
  weekly_summary:      4,
  session_reminder:    4,
  knowledge_suggestion: 5,
};

/**
 * Returns true if this notification type should be sent at the configured scale.
 * @param {string} notificationType
 * @param {number} proactiveScale   - from user_settings.json (1-5)
 */
export function shouldSend(notificationType, proactiveScale) {
  const threshold = THRESHOLDS[notificationType] ?? 3;
  return proactiveScale >= threshold;
}

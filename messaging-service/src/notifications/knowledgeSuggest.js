// Knowledge Suggestion builder
// Sent when the knowledge engine identifies a relevant resource for the athlete.
// Path C from the knowledge engine design: topic_suggester job posts suggestions here.
// Scale threshold: 5 — only at maximum proactive setting.

import pino from 'pino';
import { sendNotification, activeChannelName } from '../handlers/notificationHandler.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// ---------------------------------------------------------------------------
// Message builder
// ---------------------------------------------------------------------------

/**
 * @param {object} suggestion
 * @param {string}   suggestion.title       - resource title
 * @param {string}   suggestion.author      - resource author (optional)
 * @param {string}   suggestion.topic       - why it was suggested (topic keyword)
 * @param {string}   suggestion.summary     - brief description of the resource
 * @param {string[]} [suggestion.topicTags] - relevant tags
 */
export function buildKnowledgeSuggestion({ title, author, topic, summary, topicTags = [] }) {
  const lines = [
    '📚 **Knowledge suggestion**',
    '',
    `Based on your current focus on **${topic}**, you might find this useful:`,
    '',
    `**${title}**${author ? ` — _${author}_` : ''}`,
  ];

  if (summary) {
    lines.push('', summary);
  }

  if (topicTags.length) {
    lines.push('', `Tags: ${topicTags.map(t => `\`${t}\``).join(', ')}`);
  }

  lines.push('', 'Use `/find ' + topic + '` to search your knowledge base on this topic.');

  return lines.join('\n').trim();
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function sendKnowledgeSuggestion(suggestion) {
  log.info({ title: suggestion.title, topic: suggestion.topic }, 'sending knowledge suggestion');
  const message = buildKnowledgeSuggestion(suggestion);
  await sendNotification('knowledge_suggestion', message, activeChannelName());
}

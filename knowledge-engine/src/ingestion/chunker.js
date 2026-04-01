// Chunker
// Splits extracted text into overlapping chunks for embedding.
//
// Strategy:
//   1. Split on paragraph boundaries first (double newline)
//   2. If a paragraph exceeds chunk_size, split on sentence boundaries
//   3. Merge short paragraphs into the same chunk until size is reached
//   4. Each chunk overlaps with the previous by overlap_words at the start
//
// Default sizes from user_settings.json:
//   chunk_size_words:    400
//   chunk_overlap_words:  50

import pino from 'pino';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const DEFAULT_CHUNK_SIZE    = 400;
const DEFAULT_CHUNK_OVERLAP = 50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

function splitSentences(text) {
  // Split on sentence-ending punctuation followed by whitespace
  return text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
}

/**
 * Given a list of word tokens from the previous chunk,
 * returns a prefix string of `overlapWords` tokens.
 */
function buildOverlapPrefix(prevChunkText, overlapWords) {
  if (!overlapWords || !prevChunkText) return '';
  const words = prevChunkText.split(/\s+/).filter(Boolean);
  const startIdx = Math.max(0, words.length - overlapWords);
  return words.slice(startIdx).join(' ');
}

// ---------------------------------------------------------------------------
// Main chunker
// ---------------------------------------------------------------------------

/**
 * Splits text into overlapping chunks.
 *
 * @param {string} text - full extracted text
 * @param {object} [options]
 * @param {number} [options.chunkSize=400]   - target words per chunk
 * @param {number} [options.overlap=50]      - overlap words between chunks
 * @returns {Array<{ content: string, chunk_index: number, word_count: number }>}
 */
export function chunkText(text, { chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_CHUNK_OVERLAP } = {}) {
  if (!text?.trim()) return [];

  // Split into paragraphs
  const paragraphs = text
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  const chunks   = [];
  let current    = '';
  let currentWc  = 0;

  const flush = (lastChunkText) => {
    if (!current.trim()) return;
    chunks.push({
      content:     current.trim(),
      chunk_index: chunks.length,
      word_count:  wordCount(current),
    });

    // Prepare overlap prefix from the flushed chunk
    const prefix = buildOverlapPrefix(lastChunkText ?? current, overlap);
    current  = prefix ? prefix + ' ' : '';
    currentWc = wordCount(current);
  };

  for (const para of paragraphs) {
    const paraWc = wordCount(para);

    // Paragraph fits in current chunk
    if (currentWc + paraWc <= chunkSize) {
      current   = current ? current + '\n\n' + para : para;
      currentWc += paraWc;
      continue;
    }

    // Paragraph would overflow — flush what we have first
    if (currentWc > 0) {
      const prev = current;
      flush(prev);
    }

    // If the paragraph itself is larger than chunkSize, split it by sentences
    if (paraWc > chunkSize) {
      const sentences = splitSentences(para);
      for (const sent of sentences) {
        const sentWc = wordCount(sent);
        if (currentWc + sentWc <= chunkSize) {
          current   = current ? current + ' ' + sent : sent;
          currentWc += sentWc;
        } else {
          if (currentWc > 0) {
            const prev = current;
            flush(prev);
          }
          current   = sent;
          currentWc = sentWc;
        }
      }
    } else {
      // Paragraph fits as a new chunk start
      current   = (current ? current + ' ' : '') + para;
      currentWc += paraWc;
    }
  }

  // Flush remaining content
  if (current.trim()) flush(null);

  log.info({ chunkCount: chunks.length, avgWords: Math.round(chunks.reduce((a, c) => a + c.word_count, 0) / (chunks.length || 1)) }, 'text chunked');

  return chunks;
}

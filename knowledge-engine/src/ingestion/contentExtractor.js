// Content Extractor
// Extracts plain text from three source types:
//   PDF          — local file path, uses pdf-parse
//   URL          — fetches HTML, strips tags
//   text/plain   — passed through directly
//
// Returns: { text: string, word_count: number, source_type: string }

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import pino from 'pino';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// ---------------------------------------------------------------------------
// PDF extraction
// ---------------------------------------------------------------------------

async function extractPdf(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`PDF file not found: ${filePath}`);
  }
  // Dynamic import — pdf-parse is CJS and large; only load when needed
  const pdfParse = (await import('pdf-parse')).default;
  const buffer = await readFile(filePath);
  const result = await pdfParse(buffer);
  return result.text?.trim() ?? '';
}

// ---------------------------------------------------------------------------
// URL extraction
// ---------------------------------------------------------------------------

async function extractUrl(url) {
  // Use built-in fetch (Node 18+) or axios fallback
  let html;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'AthleteOS-KnowledgeEngine/1.0' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    html = await res.text();
  } catch (err) {
    throw new Error(`URL fetch failed: ${err.message}`);
  }

  // Strip HTML tags — simple but sufficient for articles/papers
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s{3,}/g, '\n\n')
    .trim();

  return text;
}

// ---------------------------------------------------------------------------
// Plain text — pass through
// ---------------------------------------------------------------------------

function extractText(content) {
  return content?.trim() ?? '';
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Extracts plain text from a resource.
 *
 * @param {object} resource - resource record from the DB
 * @param {string} [inlineText] - for source_type='text', content passed directly
 * @returns {{ text: string, word_count: number }}
 */
export async function extractContent(resource, inlineText = null) {
  const { source_type, source_file_path, source_url } = resource;

  log.info({ resourceId: resource.id, source_type }, 'extracting content');

  let text;

  if (source_type === 'book' || source_type === 'paper' || source_file_path) {
    if (inlineText) {
      text = extractText(inlineText);
    } else if (source_file_path) {
      const ext = source_file_path.toLowerCase().split('.').pop();
      if (ext === 'pdf') {
        text = await extractPdf(source_file_path);
      } else {
        // Assume plain text file
        text = (await readFile(source_file_path, 'utf8')).trim();
      }
    } else if (source_url) {
      text = await extractUrl(source_url);
    } else {
      throw new Error('No source_file_path, source_url, or inline text provided');
    }
  } else if (source_type === 'article' || source_type === 'talk' || source_type === 'podcast' || source_type === 'other') {
    if (inlineText) {
      text = extractText(inlineText);
    } else if (source_url) {
      text = await extractUrl(source_url);
    } else if (source_file_path) {
      text = (await readFile(source_file_path, 'utf8')).trim();
    } else {
      throw new Error('No content source available');
    }
  } else {
    // Fallback: if inline text provided, use it
    if (inlineText) {
      text = extractText(inlineText);
    } else {
      throw new Error(`Unknown source_type: ${source_type}`);
    }
  }

  if (!text) throw new Error('Extracted text is empty');

  const wordCount = countWords(text);
  log.info({ resourceId: resource.id, wordCount }, 'content extracted');

  return { text, word_count: wordCount };
}

// File Handler
// Routes inbound files by extension to the appropriate downstream system.
//
// Routing rules:
//   .pdf                     → POST /knowledge/resources (knowledge engine ingestion)
//   .csv / .json / .fit      → copy to watched-activities/ (ingestion service picks up)
//   anything else            → reply asking the athlete what to do with it
//
// Path A (PDF → knowledge):
//   Creates a resource record with source_file_path pointing to the downloaded file.
//   The knowledge engine's ingestion poller picks this up on its next cycle (every 2 min).
//
// Path B (activity files → watched-activities):
//   The ingestion service watches that folder and processes files on arrival.

import fs from 'fs';
import path from 'path';
import pino from 'pino';
import { apiClient } from '../api/client.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// Absolute path to the shared watched-activities folder (one level up from messaging-service)
const WATCHED_ACTIVITIES_DIR = path.resolve(
  process.cwd(),
  '..',
  'watched-activities',
);

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Routes an inbound file to the appropriate downstream system.
 *
 * @param {{ name: string, path: string, mimeType: string }} file
 * @param {string} channel
 * @param {string} athleteId
 * @returns {{ message: string }} response to send back to the athlete
 */
export async function handleInboundFile(file, channel, athleteId) {
  const ext = path.extname(file.name).toLowerCase();

  log.info({ name: file.name, ext, channel }, 'routing inbound file');

  if (ext === '.pdf') {
    return routeToPdf(file);
  }

  if (['.csv', '.json', '.fit'].includes(ext)) {
    return routeToActivityWatcher(file);
  }

  return {
    message: [
      `I received **${file.name}** but I'm not sure what to do with it.`,
      '',
      'I can process:',
      '- **PDF** files — added to your knowledge base',
      '- **CSV / JSON / FIT** files — imported as activity data',
      '',
      'Re-send as one of those formats, or describe what this file contains.',
    ].join('\n'),
  };
}

// ---------------------------------------------------------------------------
// Path A — PDF → knowledge resource
// ---------------------------------------------------------------------------

async function routeToPdf(file) {
  const title = path.basename(file.name, '.pdf').replace(/[-_]/g, ' ').trim();

  try {
    const resource = await apiClient.post('/knowledge/resources', {
      title,
      source_type:      'other',
      source_file_path: file.path,
      evidence_level:   'practice',
    });

    if (resource) {
      log.info({ title, resourceId: resource.id }, 'PDF queued for knowledge ingestion');
      return {
        message: [
          `**${file.name}** has been added to your knowledge base.`,
          '',
          `Title: _${title}_`,
          'The knowledge engine will process it in the next few minutes.',
          'Once indexed, you can search it with `/find <topic>`.',
        ].join('\n'),
      };
    }

    return { message: `Received **${file.name}** but could not queue it — the knowledge API returned no record. Check the knowledge engine.` };
  } catch (err) {
    log.error({ err: err.message, file: file.name }, 'failed to queue PDF as knowledge resource');
    return { message: `Received **${file.name}** but failed to add it to the knowledge base. Check the API connection.` };
  }
}

// ---------------------------------------------------------------------------
// Path B — activity files → watched-activities folder
// ---------------------------------------------------------------------------

async function routeToActivityWatcher(file) {
  const ext  = path.extname(file.name).toLowerCase();
  const dest = path.join(WATCHED_ACTIVITIES_DIR, file.name);

  try {
    // Ensure destination dir exists (it should — ingestion service creates it)
    fs.mkdirSync(WATCHED_ACTIVITIES_DIR, { recursive: true });

    // Copy downloaded file to watched-activities (don't move — original stays in tmp)
    fs.copyFileSync(file.path, dest);

    log.info({ src: file.path, dest }, 'activity file copied to watcher folder');

    const typeLabel = ext === '.csv' ? 'CSV' : ext === '.fit' ? 'FIT' : 'JSON';
    return {
      message: [
        `**${file.name}** has been sent to the ingestion queue.`,
        '',
        `The ${typeLabel} file will be processed by the data ingestion service.`,
        'Check your session log in a few minutes to confirm the import.',
      ].join('\n'),
    };
  } catch (err) {
    log.error({ err: err.message, file: file.name }, 'failed to copy activity file to watcher');
    return { message: `Received **${file.name}** but could not queue it for import. Check the ingestion service.` };
  }
}

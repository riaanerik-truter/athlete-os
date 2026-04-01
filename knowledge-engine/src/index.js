// Knowledge Engine — Entry Point
// Reads user_settings.json → registers cron jobs for:
//   - Ingestion poller  (every 2 min)  — finds pending resources and runs pipeline
//   - Summary poller    (every 5 min)  — generates pending coach summaries
//   - Instruct poller   (every 5 min)  — generates pending coach instructions
//   - Discovery poller  (every 10 min) — processes pending discovery requests
//   - Topic suggester   (daily 08:00)  — generates proactive topic suggestions

import 'dotenv/config';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import cron from 'node-cron';
import pino from 'pino';

import { apiClient }              from './api/client.js';
import { pollAndIngest }          from './ingestion/ingestionPipeline.js';
import { pollAndSummarise }       from './notes/summaryGenerator.js';
import { pollAndInstruct }        from './notes/instructionGenerator.js';
import { pollAndDiscover }        from './discovery/resourceFinder.js';
import { generateTopicSuggestions } from './discovery/topicSuggester.js';

const log   = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const __dir = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function loadSettings() {
  try {
    const raw = await readFile(join(__dir, '../user_settings.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return {
      jobs: {
        ingestion_poller:  { mode: 'auto', cron: '*/2 * * * *'  },
        summary_poller:    { mode: 'auto', cron: '*/5 * * * *'  },
        instruct_poller:   { mode: 'auto', cron: '*/5 * * * *'  },
        discovery_poller:  { mode: 'auto', cron: '*/10 * * * *' },
        topic_suggester:   { mode: 'auto', cron: '0 8 * * *'    },
      },
      ingestion: {},
    };
  }
}

// ---------------------------------------------------------------------------
// Job registry
// ---------------------------------------------------------------------------

const makeRunners = (settings) => ({
  ingestion_poller:  () => pollAndIngest(settings.ingestion ?? {}),
  summary_poller:    () => pollAndSummarise(),
  instruct_poller:   () => pollAndInstruct(),
  discovery_poller:  () => pollAndDiscover(),
  topic_suggester:   () => generateTopicSuggestions({ triggerDiscovery: false }),
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function start() {
  log.info('knowledge engine starting');

  if (!process.env.API_BASE_URL) throw new Error('API_BASE_URL not set');
  if (!process.env.API_KEY)      throw new Error('API_KEY not set');
  if (!process.env.ANTHROPIC_API_KEY) log.warn('ANTHROPIC_API_KEY not set — AI calls will fail');

  // Verify API is reachable
  const athlete = await apiClient.get('/athlete').catch(() => null);
  if (!athlete) {
    log.warn('could not reach API or athlete not found — continuing anyway');
  } else {
    log.info({ athlete: athlete.name ?? athlete.id }, 'API reachable, athlete confirmed');
  }

  const settings = await loadSettings();
  const runners  = makeRunners(settings);

  // Register cron jobs
  const tasks = [];
  for (const [name, cfg] of Object.entries(settings.jobs ?? {})) {
    if (cfg.mode !== 'auto') {
      log.info({ job: name, mode: cfg.mode }, 'job not in auto mode — skipped');
      continue;
    }
    if (!cron.validate(cfg.cron)) {
      log.error({ job: name, cron: cfg.cron }, 'invalid cron expression — skipped');
      continue;
    }
    const runner = runners[name];
    if (!runner) {
      log.warn({ job: name }, 'unknown job name — skipped');
      continue;
    }

    const task = cron.schedule(cfg.cron, async () => {
      log.info({ job: name }, 'cron triggered');
      try {
        const result = await runner();
        log.debug({ job: name, result }, 'job complete');
      } catch (err) {
        log.error({ job: name, err: err.message }, 'job failed');
      }
    });

    tasks.push({ name, task });
    log.info({ job: name, cron: cfg.cron }, 'cron registered');
  }

  log.info({ jobCount: tasks.length, jobs: tasks.map(t => t.name) }, 'knowledge engine ready');

  // Graceful shutdown
  const shutdown = (signal) => {
    log.info({ signal }, 'shutdown signal received');
    tasks.forEach(({ name, task }) => { task.stop(); log.info({ job: name }, 'stopped'); });
    log.info('knowledge engine stopped');
    process.exit(0);
  };

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch(err => {
  log.fatal({ err: err.message }, 'knowledge engine failed to start');
  process.exit(1);
});

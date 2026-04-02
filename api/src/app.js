import express from 'express';
import pinoHttp from 'pino-http';
import { requireApiKey } from './middleware/auth.js';
import { errorHandler } from './middleware/errors.js';

import systemRouter   from './routes/system.js';
import athleteRouter  from './routes/athlete.js';
import zonesRouter    from './routes/zones.js';
import seasonRouter   from './routes/season.js';
import sessionsRouter from './routes/sessions.js';
import fitnessRouter  from './routes/fitness.js';
import diaryRouter    from './routes/diary.js';
import knowledgeRouter from './routes/knowledge.js';
import syncRouter     from './routes/sync.js';
import snapshotRouter from './routes/snapshot.js';
import usageRouter    from './routes/usage.js';
import bugsRouter     from './routes/bugs.js';

export function buildApp() {
  const app = express();

  app.use(pinoHttp());
  app.use(express.json());

  // System router mounted first — /health is exempt from auth (auth handled per-route inside)
  app.use('/api/v1', systemRouter);

  // All remaining routes require a valid API key
  app.use('/api/v1', requireApiKey);
  app.use('/api/v1', athleteRouter);
  app.use('/api/v1', zonesRouter);
  app.use('/api/v1', seasonRouter);
  app.use('/api/v1', sessionsRouter);
  app.use('/api/v1', fitnessRouter);
  app.use('/api/v1', diaryRouter);
  app.use('/api/v1', knowledgeRouter);
  app.use('/api/v1', syncRouter);
  app.use('/api/v1', snapshotRouter);
  app.use('/api/v1', usageRouter);
  app.use('/api/v1', bugsRouter);

  app.use(errorHandler);

  return app;
}

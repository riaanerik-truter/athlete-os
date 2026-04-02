/**
 * POST /bugs — append a bug report to bug_reports.json in the project root.
 *
 * Body: { description, page, timestamp, userAgent }
 * Response: 201 { logged: true }
 *
 * Intentionally simple: writes to a JSON file, not the database.
 */

import { Router } from 'express';
import { z } from 'zod';
import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const router = Router();

// bug_reports.json sits in the AthleteOS project root (two levels above api/src/routes/)
const BUG_REPORT_FILE = resolve(fileURLToPath(new URL('../../..', import.meta.url)), 'bug_reports.json');

const bugSchema = z.object({
  description: z.string().min(1).max(2000),
  page:        z.string().max(500).optional().default(''),
  timestamp:   z.string().optional().default(() => new Date().toISOString()),
  userAgent:   z.string().max(500).optional().default(''),
}).strict();

router.post('/bugs', async (req, res, next) => {
  try {
    const parsed = bugSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message }
      });
    }

    const report = { id: crypto.randomUUID(), ...parsed.data };

    // Read existing reports (or start fresh)
    let reports = [];
    try {
      const text = await readFile(BUG_REPORT_FILE, 'utf8');
      reports = JSON.parse(text);
    } catch {
      // File doesn't exist yet — start with empty array
    }

    reports.push(report);
    await writeFile(BUG_REPORT_FILE, JSON.stringify(reports, null, 2), 'utf8');

    res.status(201).json({ logged: true });
  } catch (err) { next(err); }
});

export default router;

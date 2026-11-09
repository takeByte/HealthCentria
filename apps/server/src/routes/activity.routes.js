import { Router } from 'express';
import {
  activityPolicy,
  activitySummary,
  exportActivityCsv,
  exportActivityPdf,
  exportActivitySheets,
  listActivity,
  listMyActivity,
  listOwnActivity,
  purgeActivity,
} from '../controllers/activity.controller.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';

export const activityRouter = Router();

// Every entry is read-only. There is deliberately no PATCH and no per-entry
// DELETE route: the only removal is the retention purge below.
activityRouter.use(requireAuth);

activityRouter.get('/policy', activityPolicy);
activityRouter.get('/summary', requireRole('admin'), activitySummary);
activityRouter.get('/export', requireRole('admin'), exportActivityCsv);
activityRouter.post('/export/sheets', requireRole('admin'), exportActivitySheets);
activityRouter.post('/export/pdf', requireRole('admin'), exportActivityPdf);
activityRouter.get('/mine', requireRole('staff'), listMyActivity);
activityRouter.get('/me', requireRole('patient'), listOwnActivity);
activityRouter.post('/purge', requireRole('admin'), purgeActivity);
activityRouter.get('/', requireRole('admin'), listActivity);

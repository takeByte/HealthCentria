import { Router } from 'express';
import { syncAnnouncement } from '../controllers/sync.controller.js';
import { requireAuth, requirePermission, requireRole } from '../middleware/requireAuth.js';

export const syncRouter = Router();

// Same audience as editing: only people who can edit announcements need to sync an open editor.
syncRouter.get(
  '/announcements/:id',
  requireAuth,
  requireRole('staff', 'admin'),
  requirePermission('announcements.manage'),
  syncAnnouncement,
);

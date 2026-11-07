import { Router } from 'express';
import {
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
  updateAnnouncement,
} from '../controllers/announcement.controller.js';
import { requireAuth, requirePermission, requireRole } from '../middleware/requireAuth.js';

export const announcementRouter = Router();

// Public feed — no login needed.
announcementRouter.get('/', listAnnouncements);

// Any staff with the capability can post and edit; only admin can delete.
announcementRouter.post(
  '/',
  requireAuth,
  requireRole('staff', 'admin'),
  requirePermission('announcements.manage'),
  createAnnouncement,
);
announcementRouter.patch(
  '/:id',
  requireAuth,
  requireRole('staff', 'admin'),
  requirePermission('announcements.manage'),
  updateAnnouncement,
);
announcementRouter.delete('/:id', requireAuth, requireRole('admin'), deleteAnnouncement);

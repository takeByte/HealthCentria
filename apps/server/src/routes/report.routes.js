import { Router } from 'express';
import {
  exportVisitsPerServiceCsv,
  overview,
  visitsPerService,
} from '../controllers/report.controller.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';

export const reportRouter = Router();

reportRouter.get(
  '/visits-per-service/export',
  requireAuth,
  requireRole('staff', 'admin'),
  exportVisitsPerServiceCsv,
);
reportRouter.get(
  '/visits-per-service',
  requireAuth,
  requireRole('staff', 'admin'),
  visitsPerService,
);
reportRouter.get('/overview', requireAuth, requireRole('staff', 'admin'), overview);

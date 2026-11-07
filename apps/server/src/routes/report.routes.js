import { Router } from 'express';
import { overview, visitsPerService } from '../controllers/report.controller.js';
import { requireAuth, requirePermission, requireRole } from '../middleware/requireAuth.js';

export const reportRouter = Router();

reportRouter.get(
  '/visits-per-service',
  requireAuth,
  requireRole('staff', 'admin'),
  requirePermission('reports.view'),
  visitsPerService,
);
reportRouter.get(
  '/overview',
  requireAuth,
  requireRole('staff', 'admin'),
  requirePermission('reports.view'),
  overview,
);

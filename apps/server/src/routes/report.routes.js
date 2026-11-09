import { Router } from 'express';
import {
  exportVisitsPerServiceCsv,
  exportVisitsPerServicePdf,
  exportVisitsPerServiceSheets,
  listExportRecipients,
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
reportRouter.post(
  '/visits-per-service/sheets',
  requireAuth,
  requireRole('staff', 'admin'),
  exportVisitsPerServiceSheets,
);
reportRouter.post(
  '/visits-per-service/pdf',
  requireAuth,
  requireRole('staff', 'admin'),
  exportVisitsPerServicePdf,
);
reportRouter.get('/export-recipients', requireAuth, requireRole('staff', 'admin'), listExportRecipients);
reportRouter.get(
  '/visits-per-service',
  requireAuth,
  requireRole('staff', 'admin'),
  visitsPerService,
);
reportRouter.get('/overview', requireAuth, requireRole('staff', 'admin'), overview);

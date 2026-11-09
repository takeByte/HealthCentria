import { Router } from 'express';
import {
  exportVisitsPerServiceCsv,
  exportVisitsPerServicePdf,
  exportVisitsPerServiceSheets,
  listExportRecipients,
  overview,
  visitsPerService,
} from '../controllers/report.controller.js';
import { requireAuth, requirePermission, requireRole } from '../middleware/requireAuth.js';

export const reportRouter = Router();

reportRouter.get(
  '/visits-per-service/export',
  requireAuth,
  requireRole('staff', 'admin'),
  requirePermission('reports.view'),
  exportVisitsPerServiceCsv,
);
reportRouter.post(
  '/visits-per-service/sheets',
  requireAuth,
  requireRole('staff', 'admin'),
  requirePermission('reports.view'),
  exportVisitsPerServiceSheets,
);
reportRouter.post(
  '/visits-per-service/pdf',
  requireAuth,
  requireRole('staff', 'admin'),
  requirePermission('reports.view'),
  exportVisitsPerServicePdf,
);
reportRouter.get(
  '/export-recipients',
  requireAuth,
  requireRole('staff', 'admin'),
  requirePermission('reports.view'),
  listExportRecipients,
);
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

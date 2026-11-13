import { Router } from 'express';
import {
  appointmentsByStatus,
  exportReportPdf,
  exportVisitsPerServiceCsv,
  exportVisitsPerServicePdf,
  exportVisitsPerServiceSheets,
  listExportRecipients,
  monthlyTrends,
  overview,
  patientList,
  visitsPerService,
} from '../controllers/report.controller.js';
import { requireAuth, requirePermission, requireRole } from '../middleware/requireAuth.js';

export const reportRouter = Router();

const staffOnly = [requireAuth, requireRole('staff', 'admin'), requirePermission('reports.view')];

reportRouter.get('/visits-per-service', ...staffOnly, visitsPerService);
reportRouter.get('/appointments-by-status', ...staffOnly, appointmentsByStatus);
reportRouter.get('/monthly-trends', ...staffOnly, monthlyTrends);
reportRouter.get('/patients', ...staffOnly, patientList);
reportRouter.get('/export.pdf', ...staffOnly, exportReportPdf);
reportRouter.get('/visits-per-service/export', ...staffOnly, exportVisitsPerServiceCsv);
reportRouter.post('/visits-per-service/sheets', ...staffOnly, exportVisitsPerServiceSheets);
reportRouter.post('/visits-per-service/pdf', ...staffOnly, exportVisitsPerServicePdf);
reportRouter.get('/export-recipients', ...staffOnly, listExportRecipients);
reportRouter.get('/overview', ...staffOnly, overview);

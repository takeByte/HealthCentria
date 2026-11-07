import { Router } from 'express';
import {
  appointmentsByStatus,
  exportReportPdf,
  overview,
  patientList,
  visitsPerService,
} from '../controllers/report.controller.js';
import { requireAuth, requirePermission, requireRole } from '../middleware/requireAuth.js';

export const reportRouter = Router();

const staffOnly = [requireAuth, requireRole('staff', 'admin'), requirePermission('reports.view')];

reportRouter.get('/visits-per-service', ...staffOnly, visitsPerService);
reportRouter.get('/appointments-by-status', ...staffOnly, appointmentsByStatus);
reportRouter.get('/patients', ...staffOnly, patientList);
reportRouter.get('/export.pdf', ...staffOnly, exportReportPdf);
reportRouter.get('/overview', ...staffOnly, overview);

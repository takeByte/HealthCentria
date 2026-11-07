import { Router } from 'express';
import { createService, listServices, updateService, validDates } from '../controllers/service.controller.js';
import { requireAuth, requirePermission, requireRole } from '../middleware/requireAuth.js';

export const serviceRouter = Router();

// Public catalog (inactive hidden unless staff/admin token is sent).
serviceRouter.get('/', (req, _res, next) => {
  const header = req.headers.authorization ?? '';
  if (header.startsWith('Bearer ')) return requireAuth(req, _res, next);
  return next();
}, listServices);
serviceRouter.get('/:id/valid-dates', validDates);

// Staff/admin management.
serviceRouter.post(
  '/',
  requireAuth,
  requireRole('staff', 'admin'),
  requirePermission('services.manage'),
  createService,
);
serviceRouter.patch(
  '/:id',
  requireAuth,
  requireRole('staff', 'admin'),
  requirePermission('services.manage'),
  updateService,
);

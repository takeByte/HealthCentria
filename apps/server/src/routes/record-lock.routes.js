import { Router } from 'express';
import { requireAuth, requirePermission, requireRole } from '../middleware/requireAuth.js';
import { recordResource } from '../utils/record-resources.js';
import {
  claimRecordLock,
  getRecordLock,
  listRecordLocks,
  releaseRecordLockHandler,
} from '../controllers/record-lock.controller.js';

/**
 * Record-level edit locks, one route for every resource in
 * utils/record-resources.js. The caller needs the same permission that lets
 * them edit the record, so a lock cannot be used to probe records they cannot
 * see.
 */
export const recordLockRouter = Router();

recordLockRouter.use(requireAuth, requireRole('staff', 'admin'));

function requireResourcePermission(req, res, next) {
  const def = recordResource(req.params.resource);
  if (!def) return res.status(404).json({ success: false, message: 'Unknown record type.' });
  return requirePermission(def.permission)(req, res, next);
}

recordLockRouter.get('/:resource', requireResourcePermission, listRecordLocks);
recordLockRouter.get('/:resource/:id', requireResourcePermission, getRecordLock);
recordLockRouter.post('/:resource/:id/acquire', requireResourcePermission, claimRecordLock);
recordLockRouter.post('/:resource/:id/release', requireResourcePermission, releaseRecordLockHandler);

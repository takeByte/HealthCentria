import { Router } from 'express';
import { idempotent, requireVersion } from '../middleware/concurrency.js';
import { announcementRouter } from './announcement.routes.js';
import { appointmentRouter } from './appointment.routes.js';
import { patientRouter } from './patient.routes.js';
import { serviceRouter } from './service.routes.js';
import { staffRouter } from './staff.routes.js';

/**
 * API v2: the same resources and the same permission checks as v1, with safer writes.
 *
 *  - Edits (PATCH) must send the record's `version`. A stale version is refused
 *    with 409 EDIT_CONFLICT instead of overwriting someone else's change.
 *  - Creates (POST) accept an `Idempotency-Key` header. A repeat with the same key
 *    returns the first result instead of creating a duplicate.
 *
 * v1 (/api/...) keeps working unchanged for older clients. The v2 routers are the
 * very same router objects, so a permission or validation fix applies to both.
 */
export const v2Router = Router();

const VERSIONED_EDITS = [
  /^\/patients\/[^/]+$/,
  /^\/patients\/[^/]+\/medical$/,
  /^\/appointments\/[^/]+\/record$/,
  /^\/services\/[^/]+$/,
  /^\/announcements\/[^/]+$/,
  /^\/staff-accounts\/[^/]+$/,
];

const IDEMPOTENT_CREATES = [
  /^\/appointments$/,
  /^\/appointments\/walk-in$/,
  /^\/announcements$/,
  /^\/staff-accounts$/,
];

v2Router.use((req, res, next) => {
  res.set('X-API-Version', '2');
  if (req.method === 'PATCH' && VERSIONED_EDITS.some((re) => re.test(req.path))) return requireVersion(req, res, next);
  if (req.method === 'POST' && IDEMPOTENT_CREATES.some((re) => re.test(req.path))) return idempotent(req, res, next);
  return next();
});

v2Router.use('/patients', patientRouter);
v2Router.use('/appointments', appointmentRouter);
v2Router.use('/services', serviceRouter);
v2Router.use('/announcements', announcementRouter);
v2Router.use('/staff-accounts', staffRouter);

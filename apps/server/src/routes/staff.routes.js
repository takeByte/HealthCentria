import { Router } from 'express';
import mongoose from 'mongoose';
import { createStaff, listStaff, updateStaff } from '../controllers/staff.controller.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { requireSuperPin } from '../middleware/requireSuperPin.js';
import { User } from '../models/user.model.js';
import { effectivePermissions } from '../utils/permissions.js';

export const staffRouter = Router();

staffRouter.use(requireAuth, requireRole('admin'));

// Staff accounts control who can get into the workspace, so the sensitive
// changes need the superadmin PIN and an email confirmation, like integration
// settings. A superadmin whose own email is SU_EMAIL only needs the PIN.
const SU_OPTIONS = { skipEmailForSuperadmin: true };

const sameSet = (a, b) => a.length === b.length && a.every((k) => b.includes(k));

/**
 * Renaming an account stays free. The gate only applies when the request
 * changes the password, role, active flag or permissions — compared with the
 * stored account, because the edit form always resends role and permissions.
 */
async function gateSensitiveUpdate(req, res, next) {
  try {
    const body = req.body ?? {};
    let sensitive = body.password !== undefined;
    let target = null;
    if (!sensitive && mongoose.isValidObjectId(req.params.id)) {
      target = await User.findOne({ _id: req.params.id, role: { $in: ['staff', 'admin'] } })
        .select('fullName role active permissions')
        .lean();
      if (target) {
        if (body.role !== undefined && body.role !== target.role) sensitive = true;
        if (body.active !== undefined && body.active !== target.active) sensitive = true;
        if (
          Array.isArray(body.permissions) &&
          !sameSet(body.permissions, effectivePermissions(target))
        ) {
          sensitive = true;
        }
      }
    }
    if (!sensitive) return next();

    const name = target?.fullName ?? (await User.findById(req.params.id).select('fullName').lean())?.fullName;
    const parts = [];
    if (body.password !== undefined) parts.push('password');
    if (body.role !== undefined) parts.push('role');
    if (body.active !== undefined) parts.push(body.active === false ? 'deactivation' : 'activation');
    if (Array.isArray(body.permissions)) parts.push('permissions');
    const label = `Staff account changed: ${name ?? 'account'} (${parts.join(', ')})`;
    return requireSuperPin(label, SU_OPTIONS)(req, res, next);
  } catch (err) {
    return next(err);
  }
}

staffRouter.get('/', listStaff);
staffRouter.post(
  '/',
  (req, res, next) =>
    requireSuperPin(`Staff account created: ${req.body?.email ?? 'new account'}`, SU_OPTIONS)(req, res, next),
  createStaff,
);
staffRouter.patch('/:id', gateSensitiveUpdate, updateStaff);

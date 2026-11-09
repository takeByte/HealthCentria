import mongoose from 'mongoose';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { User } from '../models/user.model.js';
import { logActivity } from '../services/activity.js';
import { hashPassword, isValidPassword, PASSWORD_ERROR_MESSAGE } from '../utils/password.js';
import {
  DEFAULT_STAFF_PERMISSIONS,
  PERMISSION_KEYS,
  effectivePermissions,
} from '../utils/permissions.js';

function requireDB(res) {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({ success: false, message: 'Database is not connected. Try again later.' });
    return false;
  }
  return true;
}

function present(u) {
  const obj = typeof u.toObject === 'function' ? u.toObject() : u;
  return {
    id: String(obj._id),
    name: obj.fullName,
    email: obj.email,
    role: obj.role,
    active: obj.active,
    permissions: effectivePermissions(obj),
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

/** "Admin" or "Staff" — used in log text so the entry names the real role. */
function accountKind(role) {
  return role === 'admin' ? 'Admin' : 'Staff';
}

const createSchema = z.object({
  fullName: z.string().trim().min(1, 'Full name is required.'),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().refine(isValidPassword, PASSWORD_ERROR_MESSAGE),
  role: z.enum(['staff', 'admin']).optional().default('staff'),
  permissions: z.array(z.enum(PERMISSION_KEYS)).optional(),
});

const updateSchema = z
  .object({
    fullName: z.string().trim().min(1).optional(),
    role: z.enum(['staff', 'admin']).optional(),
    active: z.boolean().optional(),
    permissions: z.array(z.enum(PERMISSION_KEYS)).optional(),
    password: z.string().refine(isValidPassword, PASSWORD_ERROR_MESSAGE).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update.' });

export const listStaff = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const users = await User.find({ role: { $in: ['staff', 'admin'] } })
    .sort({ fullName: 1 })
    .lean();
  res.json({ success: true, accounts: users.map(present) });
});

export const createStaff = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }
  const existing = await User.findOne({ email: parsed.data.email }).lean();
  if (existing) {
    return res.status(409).json({ success: false, message: 'Email is already registered.' });
  }
  const user = await User.create({
    email: parsed.data.email,
    passwordHash: await hashPassword(parsed.data.password),
    role: parsed.data.role,
    fullName: parsed.data.fullName,
    permissions: parsed.data.permissions ?? DEFAULT_STAFF_PERMISSIONS,
  });
  await logActivity({
    req,
    action: 'staff.create',
    target: { type: 'staff', id: user._id, label: user.fullName, role: user.role },
    changes: [
      ['email', '', user.email],
      ['role', '', user.role],
      ['active', '', user.active],
      ['permissions', '', effectivePermissions(user).join(', ')],
    ],
    detail: `${accountKind(user.role)} account created.`,
  });
  res.status(201).json({ success: true, account: present(user) });
});

export const updateStaff = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ success: false, message: 'Account not found.' });
  }
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }
  const target = await User.findOne({ _id: req.params.id, role: { $in: ['staff', 'admin'] } });
  if (!target) {
    return res.status(404).json({ success: false, message: 'Account not found.' });
  }
  // Never lock yourself out: block self-demotion and self-deactivation.
  const isSelf = String(target._id) === String(req.user.id);
  if (isSelf && parsed.data.role && parsed.data.role !== 'admin') {
    return res.status(400).json({ success: false, message: 'You cannot change your own admin role.' });
  }
  if (isSelf && parsed.data.active === false) {
    return res.status(400).json({ success: false, message: 'You cannot deactivate your own account.' });
  }
  const before = {
    fullName: target.fullName,
    role: target.role,
    active: target.active,
    permissions: effectivePermissions(target),
  };
  if (parsed.data.fullName !== undefined) target.fullName = parsed.data.fullName;
  if (parsed.data.role !== undefined) target.role = parsed.data.role;
  if (parsed.data.active !== undefined) target.active = parsed.data.active;
  if (parsed.data.permissions !== undefined) target.permissions = parsed.data.permissions;
  if (parsed.data.password !== undefined) {
    target.passwordHash = await hashPassword(parsed.data.password);
    // An admin-forced reset must end that person's existing sessions too.
    target.tokenVersion = (target.tokenVersion ?? 0) + 1;
  }
  await target.save();

  const changedFields = Object.keys(parsed.data);
  await logActivity({
    req,
    action: 'staff.update',
    target: { type: 'staff', id: target._id, label: target.fullName, role: target.role },
    changes: [
      ['fullName', before.fullName, target.fullName],
      ['role', before.role, target.role],
      ['active', before.active, target.active],
      ...(parsed.data.permissions !== undefined
        ? [['permissions', before.permissions.join(', '), effectivePermissions(target).join(', ')]]
        : []),
      // Presence only — the password value never enters the log.
      ...(parsed.data.password !== undefined ? [['password', '', 'reset']] : []),
    ],
    detail: `${accountKind(target.role)} account updated: ${changedFields.join(', ')}.`,
  });

  res.json({ success: true, account: present(target) });
});

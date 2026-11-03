import { z } from 'zod';
import mongoose from 'mongoose';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { Service } from '../models/service.model.js';
import { logActivity, snapshotChanges } from '../services/activity.js';
import { scheduleText, todayYMD, upcomingValidDates } from '../utils/service-schedule.js';

const scheduleSchema = z
  .object({
    mode: z.enum(['weekly', 'nth-weekday', 'as-needed']),
    weekdays: z.array(z.number().int().min(0).max(6)).optional().default([]),
    nthWeek: z.number().int().min(1).max(5).optional(),
    weekday: z.number().int().min(0).max(6).optional(),
  })
  .superRefine((s, ctx) => {
    if (s.mode === 'weekly' && s.weekdays.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Weekly services need at least one weekday.' });
    }
    if (s.mode === 'nth-weekday' && (s.nthWeek == null || s.weekday == null)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Nth-weekday services need nthWeek and weekday.' });
    }
  });

const serviceBody = z.object({
  name: z.string().trim().min(1, 'Name is required.'),
  description: z.string().trim().optional().default(''),
  schedule: scheduleSchema,
  active: z.boolean().optional(),
});

function requireDB(res) {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({ success: false, message: 'Database is not connected. Try again later.' });
    return false;
  }
  return true;
}

function present(service) {
  return {
    id: String(service._id),
    name: service.name,
    description: service.description,
    schedule: service.schedule,
    scheduleText: scheduleText(service.schedule),
    active: service.active,
    createdAt: service.createdAt,
    updatedAt: service.updatedAt,
    updatedByName:
      service.updatedBy && typeof service.updatedBy === 'object' ? service.updatedBy.fullName ?? '' : '',
  };
}

export const listServices = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  // Staff/admin see inactive services too; everyone else sees bookable ones only.
  const isStaff = req.user && (req.user.role === 'staff' || req.user.role === 'admin');
  const filter = isStaff ? {} : { active: true };
  const services = await Service.find(filter).sort({ name: 1 }).lean();
  res.json({ success: true, services: services.map(present) });
});

export const createService = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const parsed = serviceBody.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }
  try {
    const service = await Service.create(parsed.data);
    await logActivity({
      req,
      action: 'service.create',
      target: { type: 'service', id: service._id, label: service.name },
      changes: [
        ['name', '', service.name],
        ['active', '', service.active],
        ['schedule', '', scheduleText(service.schedule)],
      ],
      detail: 'Service added to the catalog.',
    });
    res.status(201).json({ success: true, service: present(service.toObject()) });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ success: false, message: 'A service with this name already exists.' });
    }
    throw err;
  }
});

export const updateService = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const parsed = serviceBody.partial().safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }
  const service = await Service.findById(req.params.id);
  if (!service) return res.status(404).json({ success: false, message: 'Service not found.' });

  const tracked = ['name', 'description', 'schedule', 'active'];
  const before = { ...service.toObject(), schedule: scheduleText(service.schedule) };
  for (const [field, value] of Object.entries(parsed.data)) service.set(field, value);
  service.updatedBy = req.user.id;
  await service.save();

  await logActivity({
    req,
    action: 'service.update',
    target: { type: 'service', id: service._id, label: service.name },
    changes: snapshotChanges(
      before,
      { ...service.toObject(), schedule: scheduleText(service.schedule) },
      tracked,
    ),
    detail: `Service updated: ${Object.keys(parsed.data).join(', ')}.`,
  });

  res.json({ success: true, service: present(service.toObject()) });
});

export const validDates = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const service = await Service.findById(req.params.id).lean();
  if (!service || !service.active) return res.status(404).json({ success: false, message: 'Service not found.' });
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 60);
  res.json({ success: true, dates: upcomingValidDates(service, todayYMD(), days) });
});

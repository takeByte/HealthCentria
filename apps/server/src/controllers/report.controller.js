import mongoose from 'mongoose';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { Appointment } from '../models/appointment.model.js';
import { User } from '../models/user.model.js';
import { addDaysYMD, todayYMD } from '../utils/service-schedule.js';

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).optional().default(30),
});

function requireDB(res) {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({ success: false, message: 'Database is not connected. Try again later.' });
    return false;
  }
  return true;
}

// Shared by the JSON chart endpoint and the CSV export so both always agree.
async function loadVisitsPerService(days) {
  const today = todayYMD();
  const from = addDaysYMD(today, -(days - 1));
  const rows = await Appointment.aggregate([
    { $match: { status: 'completed', day: { $gte: from, $lte: today } } },
    { $group: { _id: '$service', count: { $sum: 1 } } },
    {
      $lookup: {
        from: 'services',
        localField: '_id',
        foreignField: '_id',
        as: 'service',
      },
    },
    { $unwind: { path: '$service', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        serviceId: { $toString: '$_id' },
        serviceName: { $ifNull: ['$service.name', 'Service'] },
        count: 1,
      },
    },
    { $sort: { count: -1 } },
  ]);
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  return { from, to: today, days, total, rows };
}

// Visits per service over the last N days (completed appointments only, v1).
export const visitsPerService = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: 'Invalid range.' });
  }
  const data = await loadVisitsPerService(parsed.data.days);
  res.json({ success: true, ...data });
});

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

/**
 * GET /api/reports/visits-per-service/export — the same report as a CSV file.
 * Staff and admins only, matching the chart endpoint.
 */
export const exportVisitsPerServiceCsv = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: 'Invalid range.' });
  }
  const data = await loadVisitsPerService(parsed.data.days);

  const lines = [
    ['E-Kalinga — Visits per service'],
    ['Period', `${data.from} to ${data.to}`],
    ['Days', data.days],
    [],
    ['Service', 'Completed visits'],
    ...data.rows.map((row) => [row.serviceName, row.count]),
    ['Total', data.total],
  ];
  const csv = lines.map((columns) => columns.map(csvCell).join(',')).join('\r\n');

  res.set('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  // The web app reads this header to keep the server-generated filename even
  // when the API is on a different origin (local dev).
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="e-kalinga-visits-per-service-${data.from}-to-${data.to}.csv"`,
  );
  // BOM so Excel opens UTF-8 correctly.
  res.send(`\uFEFF${csv}`);
});

// Daily-ops + system counts for the admin dashboard (staff see shared counts;
// staff-account count is admin-only).
export const overview = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const today = todayYMD();
  const [todayCount, pendingCount, totalPatients] = await Promise.all([
    Appointment.countDocuments({ day: today, status: { $in: ['confirmed', 'pending'] } }),
    Appointment.countDocuments({ status: 'pending' }),
    User.countDocuments({ role: 'patient' }),
  ]);
  const out = { success: true, today: todayCount, pending: pendingCount, totalPatients };
  if (req.user.role === 'admin') {
    out.activeStaff = await User.countDocuments({ role: 'staff', active: true });
  }
  res.json(out);
});

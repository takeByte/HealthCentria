import mongoose from 'mongoose';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { Appointment } from '../models/appointment.model.js';
import { User } from '../models/user.model.js';
import { logActivity } from '../services/activity.js';
import { exportStamp, exportToSheet } from '../services/google-sheets.js';
import {
  deliverPdf,
  describeDelivery,
  exportRecipientOptions,
  recipientsSchema,
  sendPdfResponse,
} from '../services/export-delivery.js';
import { buildReportPdf } from '../services/pdf-report.js';
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
    ['HealthCentria — Visits per service'],
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
    `attachment; filename="healthcentria-visits-per-service-${data.from}-to-${data.to}.csv"`,
  );
  // BOM so Excel opens UTF-8 correctly.
  res.send(`\uFEFF${csv}`);
});

/**
 * POST /api/reports/visits-per-service/sheets?days= — the same report written
 * to a new tab in the export spreadsheet. Staff and admins, like the CSV.
 */
export const exportVisitsPerServiceSheets = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: 'Invalid range.' });
  }
  const data = await loadVisitsPerService(parsed.data.days);
  const actor = await User.findById(req.user.id).select('fullName').lean();
  const stamp = exportStamp();

  let result;
  try {
    result = await exportToSheet({
      tabTitle: `Visits ${stamp}`,
      title: 'HealthCentria — Visits per service',
      details: `Completed visits, ${data.from} to ${data.to} (${data.days} days) · Exported by ${actor?.fullName || 'staff'}`,
      header: ['Service', 'Completed visits'],
      rows: [...data.rows.map((row) => [row.serviceName, row.count]), ['Total', data.total]],
    });
  } catch (error) {
    return res.status(502).json({
      success: false,
      message: error instanceof Error ? error.message : 'Could not export to Google Sheets.',
    });
  }

  await logActivity({
    req,
    action: 'report.export_sheets',
    target: { type: 'report', id: 'visits-per-service', label: `Visits per service (${data.days} days)` },
    detail: `Exported ${data.rows.length} service rows to Google Sheets tab "${result.tab}".`,
  });
  res.json({ success: true, url: result.url, tab: result.tab });
});

// Daily-ops + system counts for the admin dashboard (staff see shared counts;
// staff-account count is admin-only).
export const overview = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const today = todayYMD();
  const [todayCount, pendingCount, totalPatients] = await Promise.all([
    Appointment.countDocuments({ day: today, status: { $in: ['confirmed', 'pending'] } }),
    Appointment.countDocuments({ status: 'pending' }),
    User.countDocuments({ role: 'patient', deletedAt: null }),
  ]);
  const out = { success: true, today: todayCount, pending: pendingCount, totalPatients };
  if (req.user.role === 'admin') {
    out.activeStaff = await User.countDocuments({ role: 'staff', active: true });
  }
  res.json(out);
});

/** GET /api/reports/export-recipients — who can be picked to receive a PDF link. */
export const listExportRecipients = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, ...(await exportRecipientOptions()) });
});

/**
 * POST /api/reports/visits-per-service/pdf?days= — body { recipients: [userId] }.
 * Returns the PDF; it is also uploaded to Google Drive and the link emailed to
 * the superadmin and the picked staff/admins (outcome in X-Drive-* headers).
 */
export const exportVisitsPerServicePdf = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const parsed = querySchema.safeParse(req.query);
  const body = recipientsSchema.safeParse(req.body ?? {});
  if (!parsed.success || !body.success) {
    return res.status(400).json({ success: false, message: 'Invalid range or recipients.' });
  }
  const data = await loadVisitsPerService(parsed.data.days);
  const actor = await User.findById(req.user.id).select('fullName').lean();
  const details = `Completed visits, ${data.from} to ${data.to} (${data.days} days)`;
  const pct = (n) => (data.total ? `${((n / data.total) * 100).toFixed(1)}%` : '0%');

  const buffer = await buildReportPdf({
    title: 'Visits per service',
    details: `${details} · Exported by ${actor?.fullName || 'staff'}`,
    summary: [
      { label: 'Completed visits', value: data.total },
      { label: 'Services', value: data.rows.length },
      { label: 'Period', value: `${data.days} days` },
    ],
    columns: [
      { header: 'Service' },
      { header: 'Completed visits', width: 110, align: 'right' },
      { header: 'Share', width: 70, align: 'right' },
    ],
    rows: data.rows.map((r) => [r.serviceName, r.count, pct(r.count)]),
    totalRow: data.rows.length ? ['Total', data.total, '100%'] : undefined,
  });

  const fileName = `healthcentria-visits-per-service-${data.from}-to-${data.to}.pdf`;
  const delivery = await deliverPdf({
    req,
    buffer,
    fileName,
    reportTitle: `Visits per service (${data.days} days)`,
    details,
    recipientIds: body.data.recipients,
    upload: body.data.uploadToDrive,
  });

  await logActivity({
    req,
    action: 'report.export_pdf',
    target: { type: 'report', id: 'visits-per-service', label: `Visits per service (${data.days} days)` },
    detail: describeDelivery(delivery),
  });
  sendPdfResponse(res, { buffer, fileName, delivery });
});

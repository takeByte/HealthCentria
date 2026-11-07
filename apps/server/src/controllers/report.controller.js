import mongoose from 'mongoose';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { Appointment } from '../models/appointment.model.js';
import { User } from '../models/user.model.js';
import { streamReportPdf } from '../services/report-pdf.js';
import { addDaysYMD, todayYMD } from '../utils/service-schedule.js';

const RANGE_DAYS = { today: 1, week: 7, month: 30 };
const RANGE_SUFFIX = {
  today: 'today',
  week: 'last 7 days',
  month: 'last 30 days',
};
const STATUS_KEYS = ['pending', 'confirmed', 'declined', 'completed', 'cancelled'];
const REPORT_TITLES = {
  visits: 'Visits per service',
  status: 'Appointments by status',
  patients: 'Patient register',
};

const rangeSchema = z.object({
  range: z.enum(['today', 'week', 'month']).optional(),
  days: z.coerce.number().int().min(1).max(90).optional(),
});

const exportSchema = rangeSchema.extend({
  report: z.enum(['visits', 'status', 'patients']).default('visits'),
});

function requireDB(res) {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({ success: false, message: 'Database is not connected. Try again later.' });
    return false;
  }
  return true;
}

/**
 * `range` is the UI's Today/Week/Month preset. `days` stays supported for
 * older links and for ad-hoc windows; when both arrive, `days` wins.
 */
function parseRange(query) {
  const parsed = rangeSchema.safeParse(query);
  if (!parsed.success) return null;

  const { range, days } = parsed.data;
  const resolvedDays = days ?? (range ? RANGE_DAYS[range] : 30);
  const resolvedRange =
    range ?? (resolvedDays === 1 ? 'today' : resolvedDays === 7 ? 'week' : resolvedDays === 30 ? 'month' : null);
  const today = todayYMD();

  return {
    range: resolvedRange,
    days: resolvedDays,
    from: addDaysYMD(today, -(resolvedDays - 1)),
    to: today,
  };
}

function periodLabel({ range, days, from, to }) {
  const span = from === to ? from : `${from} – ${to}`;
  return `${span} (${RANGE_SUFFIX[range] ?? `last ${days} days`})`;
}

function generatedLabel() {
  return new Date().toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function ageFromBirthdate(birthdate) {  if (!birthdate) return null;
  const born = new Date(birthdate);
  if (Number.isNaN(born.getTime())) return null;

  const now = new Date();
  let age = now.getUTCFullYear() - born.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - born.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < born.getUTCDate())) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

function sexShort(sex) {
  if (sex === 'Female') return 'F';
  if (sex === 'Male') return 'M';
  if (sex === 'Other') return 'O';
  return '—';
}

async function loadVisitsReport({ from, to }) {
  const rows = await Appointment.aggregate([
    { $match: { status: 'completed', day: { $gte: from, $lte: to } } },
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
    { $sort: { count: -1, serviceName: 1 } },
  ]);

  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return { rows, total };
}

async function loadStatusReport({ from, to }) {
  const raw = await Appointment.aggregate([
    { $match: { day: { $gte: from, $lte: to } } },
    { $group: { _id: { service: '$service', status: '$status' }, count: { $sum: 1 } } },
    {
      $lookup: {
        from: 'services',
        localField: '_id.service',
        foreignField: '_id',
        as: 'service',
      },
    },
    { $unwind: { path: '$service', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        serviceId: { $toString: '$_id.service' },
        serviceName: { $ifNull: ['$service.name', 'Service'] },
        status: '$_id.status',
        count: 1,
      },
    },
  ]);

  const byService = new Map();
  for (const item of raw) {
    let entry = byService.get(item.serviceId);
    if (!entry) {
      entry = {
        serviceId: item.serviceId,
        serviceName: item.serviceName,
        pending: 0,
        confirmed: 0,
        declined: 0,
        completed: 0,
        cancelled: 0,
        total: 0,
      };
      byService.set(item.serviceId, entry);
    }
    if (STATUS_KEYS.includes(item.status)) {
      entry[item.status] += item.count;
    }
    entry.total += item.count;
  }

  const rows = [...byService.values()].sort(
    (a, b) => b.total - a.total || a.serviceName.localeCompare(b.serviceName),
  );

  const totals = { pending: 0, confirmed: 0, declined: 0, completed: 0, cancelled: 0, total: 0 };
  for (const row of rows) {
    for (const key of STATUS_KEYS) {
      totals[key] += row[key];
    }
    totals.total += row.total;
  }

  return { rows, totals: { ...totals, serviceName: 'Total' } };
}

async function loadPatientRows(to) {
  const patients = await User.find({ role: 'patient' })
    .select('fullName birthdate sex address barangay contactNumber householdNumber createdAt')
    .sort({ fullName: 1 })
    .lean();

  const lastVisits = await Appointment.aggregate([
    { $match: { status: 'completed', day: { $lte: to } } },
    { $group: { _id: '$patient', lastVisit: { $max: '$day' } } },
  ]);
  const lastVisitByPatient = new Map(lastVisits.map((visit) => [String(visit._id), visit.lastVisit]));

  return patients.map((patient) => ({
    id: String(patient._id),
    name: patient.fullName,
    age: ageFromBirthdate(patient.birthdate),
    sex: patient.sex ?? '',
    address: patient.address ?? '',
    barangay: patient.barangay ?? '',
    contactNumber: patient.contactNumber ?? '',
    householdNumber: patient.householdNumber ?? '',
    lastVisit: lastVisitByPatient.get(String(patient._id)) ?? null,
    registeredAt: patient.createdAt ? new Date(patient.createdAt).toISOString().slice(0, 10) : null,
  }));
}

async function loadSeenPatientIds({ from, to }) {
  const ids = await Appointment.distinct('patient', {
    status: 'completed',
    day: { $gte: from, $lte: to },
  });
  return new Set(ids.map((id) => String(id)));
}

function patientTotals(rows, meta, seenIds) {
  return {
    total: rows.length,
    newInPeriod: rows.filter(
      (row) => row.registeredAt && row.registeredAt >= meta.from && row.registeredAt <= meta.to,
    ).length,
    seenInPeriod: seenIds.size,
  };
}

// Visits per service over the selected window (completed appointments only, v1).
export const visitsPerService = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;

  const meta = parseRange(req.query);
  if (!meta) {
    return res.status(400).json({ success: false, message: 'Invalid range.' });
  }

  const { rows, total } = await loadVisitsReport(meta);
  res.json({ success: true, ...meta, total, rows });
});

// Appointment outcomes by service: one row per service, one column per status.
export const appointmentsByStatus = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;

  const meta = parseRange(req.query);
  if (!meta) {
    return res.status(400).json({ success: false, message: 'Invalid range.' });
  }

  const { rows, totals } = await loadStatusReport(meta);
  res.json({ success: true, ...meta, totals, rows });
});

// Basic patient register: demographics, contact details and last completed visit.
export const patientList = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;

  const meta = parseRange(req.query);
  if (!meta) {
    return res.status(400).json({ success: false, message: 'Invalid range.' });
  }

  const rows = await loadPatientRows(meta.to);
  const seenIds = await loadSeenPatientIds(meta);
  const totals = patientTotals(rows, meta, seenIds);
  res.json({ success: true, ...meta, ...totals, rows });
});

// GET /api/reports/export.pdf — authenticated PDF download with header/footer.
export const exportReportPdf = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;

  const parsed = exportSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: 'Invalid report or range.' });
  }

  const meta = parseRange(parsed.data);
  if (!meta) {
    return res.status(400).json({ success: false, message: 'Invalid range.' });
  }

  const { report } = parsed.data;
  let rows;
  let totals;

  if (report === 'visits') {
    const data = await loadVisitsReport(meta);
    rows = data.rows;
    totals = { total: data.total, serviceName: 'Total', count: data.total };
  } else if (report === 'status') {
    const data = await loadStatusReport(meta);
    rows = data.rows;
    totals = data.totals;
  } else {
    const patients = await loadPatientRows(meta.to);
    const seenIds = await loadSeenPatientIds(meta);
    const summary = patientTotals(patients, meta, seenIds);
    rows = patients.map((row) => ({
      ...row,
      ageSex: `${row.age ?? '—'} ${sexShort(row.sex)}`,
      address: [row.address, row.barangay].filter(Boolean).join(', ') || '—',
      contactNumber: row.contactNumber || '—',
      householdNumber: row.householdNumber || '—',
      lastVisit: row.lastVisit || 'No visits',
    }));
    totals = {
      name: 'Total',
      ageSex: '',
      address: `${summary.total} patients`,
      contactNumber: '',
      householdNumber: '',
      lastVisit: `${summary.seenInPeriod} seen`,
      ...summary,
    };
  }

  const filename = `healthcentria-${report}-${meta.from}_${meta.to}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');

  streamReportPdf(res, {
    report,
    meta: {
      title: REPORT_TITLES[report],
      period: periodLabel(meta),
      generatedAt: generatedLabel(),
    },
    rows,
    totals,
  });
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

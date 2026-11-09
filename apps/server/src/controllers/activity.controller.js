import mongoose from 'mongoose';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ACTIVITY_CATEGORIES, AuditLog, categoryForAction } from '../models/audit-log.model.js';
import { User } from '../models/user.model.js';
import { exportStamp, exportToSheet, footerTimestamp } from '../services/google-sheets.js';
import { deliverPdf, describeDelivery, recipientsSchema, sendPdfResponse } from '../services/export-delivery.js';
import { buildReportPdf } from '../services/pdf-report.js';
import { env } from '../config/env.js';
import {
  ACTIVITY_RETENTION_DAYS,
  logActivity,
  retentionCutoff,
} from '../services/activity.js';

function requireDB(res) {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({ success: false, message: 'Database is not connected. Try again later.' });
    return false;
  }
  return true;
}

const querySchema = z.object({
  category: z.enum(ACTIVITY_CATEGORIES).optional(),
  action: z.string().trim().max(60).optional(),
  actor: z.string().trim().max(120).optional(),
  targetType: z.string().trim().max(40).optional(),
  targetId: z.string().trim().max(80).optional(),
  outcome: z.enum(['success', 'failed']).optional(),
  q: z.string().trim().max(120).optional(),
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** YYYY-MM-DD is read as a local calendar day; anything else must be a real date. */
function parseDate(value, endOfDay = false) {
  if (!value) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Old entries predate `category`, so each bucket also matches its action prefix. */
const ACTION_PREFIX_BY_CATEGORY = {
  auth: 'auth',
  appointments: 'appointment',
  clinical: '(patient|record)',
  people: 'staff',
  content: '(announcement|service)',
  configuration: '(settings|integration)',
  system: 'activity',
};

function categoryClause(category) {
  const prefix = ACTION_PREFIX_BY_CATEGORY[category];
  const clauses = [{ category }];
  if (prefix) clauses.push({ action: { $regex: `^${prefix}\\.` } });
  return clauses.length === 1 ? clauses[0] : { $or: clauses };
}

const WORK_ACTIONS_PREFIX = '^(appointment|patient|record|announcement|service)\\.';

/**
 * The one place visibility is decided. Staff never see configuration events or
 * another person's sign-ins; patients only ever see their own record.
 */
function scopeFilter(user) {
  if (user.role === 'admin') return null;
  if (user.role === 'staff') {
    return {
      $or: [
        { category: { $in: ['appointments', 'clinical', 'content'] } },
        { action: { $regex: WORK_ACTIONS_PREFIX } },
        { actor: user.id },
      ],
    };
  }
  // Their own record, plus anything they did themselves (booking, profile edits,
  // sign-ins) — never another patient's activity.
  return {
    $or: [
      { patient: user.id },
      { targetType: 'patient', targetId: String(user.id) },
      { actor: user.id },
    ],
  };
}

function buildFilter(user, query) {
  const clauses = [];
  const scope = scopeFilter(user);
  if (scope) clauses.push(scope);

  if (query.category) clauses.push(categoryClause(query.category));

  const base = {};
  if (query.action) base.action = query.action;
  if (query.targetType) base.targetType = query.targetType;
  if (query.targetId) base.targetId = query.targetId;
  if (query.outcome) base.outcome = query.outcome;

  if (query.from || query.to) {
    const range = {};
    const from = parseDate(query.from, false);
    const to = parseDate(query.to, true);
    if (from) range.$gte = from;
    if (to) range.$lte = to;
    if (Object.keys(range).length) base.createdAt = range;
  }

  if (query.actor) {
    const rx = new RegExp(escapeRegex(query.actor), 'i');
    clauses.push({
      $or: [
        ...(mongoose.isValidObjectId(query.actor) ? [{ actor: query.actor }] : []),
        { actorName: rx },
      ],
    });
  }

  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), 'i');
    clauses.push({
      $or: [{ actorName: rx }, { targetLabel: rx }, { detail: rx }, { action: rx }],
    });
  }

  if (Object.keys(base).length) clauses.push(base);
  return clauses.length ? { $and: clauses } : {};
}

/**
 * Fill in the role of an affected account.
 *
 * Entries written before `targetRole` existed only record `targetType: 'staff'`
 * for both staff and admin accounts. A role change is also dropped from
 * `changes` when the diff is empty, so the stored change list cannot always be
 * trusted. Use the recorded role change when present, then fall back to the
 * account's current role so historical rows still read "Admin" vs "Staff".
 */
async function withTargetRoles(entries) {
  const pending = entries.filter(
    (e) =>
      !e.targetRole &&
      (e.targetType === 'staff' || e.targetType === 'patient') &&
      e.targetId &&
      mongoose.isValidObjectId(e.targetId),
  );
  if (!pending.length) return entries;

  const ids = [...new Set(pending.map((e) => String(e.targetId)))];
  const users = await User.find({ _id: { $in: ids } })
    .select('_id role')
    .lean();
  const roleById = new Map(users.map((u) => [String(u._id), u.role]));

  for (const entry of pending) {
    const roleChange = (entry.changes ?? []).find((c) => c.field === 'role');
    const recorded = ['patient', 'staff', 'admin'].includes(roleChange?.to) ? roleChange.to : '';
    entry.targetRole = recorded || roleById.get(String(entry.targetId)) || '';
  }
  return entries;
}

function present(e) {
  return {
    id: String(e._id),
    action: e.action,
    category: e.category ?? categoryForAction(e.action),
    actor: {
      id: e.actor ? String(e.actor) : null,
      name: e.actorName || '',
      role: e.actorRole || '',
    },
    target: {
      type: e.targetType || '',
      id: e.targetId || '',
      label: e.targetLabel || '',
      role: e.targetRole || '',
    },
    changes: (e.changes ?? []).map((c) => ({ field: c.field, from: c.from, to: c.to })),
    outcome: e.outcome ?? 'success',
    ip: e.ip ?? '',
    userAgent: e.userAgent ?? '',
    detail: e.detail ?? '',
    createdAt: e.createdAt,
  };
}

async function readPage(user, query) {
  const filter = buildFilter(user, query);
  const skip = (query.page - 1) * query.limit;
  const [entries, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit).lean(),
    AuditLog.countDocuments(filter),
  ]);
  await withTargetRoles(entries);
  return {
    entries: entries.map(present),
    total,
    page: query.page,
    limit: query.limit,
    pages: Math.max(1, Math.ceil(total / query.limit)),
  };
}

function parseQuery(req, res) {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: 'Invalid filters.' });
    return null;
  }
  return parsed.data;
}

/** GET /api/activity — admin: the full log. */
export const listActivity = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const query = parseQuery(req, res);
  if (!query) return;
  res.set('Cache-Control', 'no-store');
  const page = await readPage(req.user, query);
  res.json({ success: true, ...page, retentionDays: ACTIVITY_RETENTION_DAYS });
});

/** GET /api/activity/mine — staff: work events plus their own sign-ins. */
export const listMyActivity = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const query = parseQuery(req, res);
  if (!query) return;
  res.set('Cache-Control', 'no-store');
  const page = await readPage(req.user, query);
  res.json({ success: true, ...page, retentionDays: ACTIVITY_RETENTION_DAYS });
});

/** GET /api/activity/me — patients: only entries about their own record. */
export const listOwnActivity = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const query = parseQuery(req, res);
  if (!query) return;
  res.set('Cache-Control', 'no-store');
  const page = await readPage(req.user, query);
  res.json({ success: true, ...page, retentionDays: ACTIVITY_RETENTION_DAYS });
});

/** GET /api/activity/summary — admin stat strip. */
export const activitySummary = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  res.set('Cache-Control', 'no-store');
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [today, failedSignIns, recordsEdited, stored] = await Promise.all([
    AuditLog.countDocuments({ createdAt: { $gte: startOfDay } }),
    AuditLog.countDocuments({ action: 'auth.login_failed', createdAt: { $gte: dayAgo } }),
    AuditLog.countDocuments({
      action: { $in: ['patient.update', 'record.update'] },
      createdAt: { $gte: weekAgo },
    }),
    AuditLog.countDocuments({}),
  ]);

  res.json({ success: true, today, failedSignIns, recordsEdited, stored });
});

/** GET /api/activity/policy — retention window shown on the page. */
export const activityPolicy = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  res.set('Cache-Control', 'no-store');
  const cutoff = retentionCutoff();
  const oldest = await AuditLog.findOne({}).sort({ createdAt: 1 }).select('createdAt').lean();
  res.json({
    success: true,
    retentionDays: ACTIVITY_RETENTION_DAYS,
    cutoff,
    oldest: oldest?.createdAt ?? null,
  });
});

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

/** GET /api/activity/export — CSV of the current filters (admin only). */
export const exportActivityCsv = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const query = parseQuery(req, res);
  if (!query) return;

  const entries = await AuditLog.find(buildFilter(req.user, query))
    .sort({ createdAt: -1 })
    .limit(10000)
    .lean();
  await withTargetRoles(entries);

  const header = [
    'timestamp',
    'actor',
    'role',
    'action',
    'category',
    'outcome',
    'target_type',
    'target_role',
    'target',
    'target_id',
    'ip',
    'detail',
    'changes',
  ];
  const lines = [header.map(csvCell).join(',')];
  for (const e of entries) {
    const entry = present(e);
    const changes = entry.changes.map((c) => `${c.field}: ${c.from} → ${c.to}`).join(' | ');
    lines.push(
      [
        entry.createdAt ? new Date(entry.createdAt).toISOString() : '',
        entry.actor.name,
        entry.actor.role,
        entry.action,
        entry.category,
        entry.outcome,
        entry.target.type,
        entry.target.role,
        entry.target.label,
        entry.target.id,
        entry.ip,
        entry.detail,
        changes,
      ]
        .map(csvCell)
        .join(','),
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  res.set('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="activity-${stamp}.csv"`);
  // BOM so Excel opens UTF-8 correctly.
  res.send(`\uFEFF${lines.join('\r\n')}`);
});

/**
 * POST /api/activity/export/sheets — the current filters written to a new tab
 * in the export spreadsheet (admin only). Same columns and 10,000-row cap as CSV.
 */
export const exportActivitySheets = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const query = parseQuery(req, res);
  if (!query) return;

  const entries = await AuditLog.find(buildFilter(req.user, query))
    .sort({ createdAt: -1 })
    .limit(10000)
    .lean();

  const rows = entries.map((e) => {
    const entry = present(e);
    return [
      entry.createdAt ? new Date(entry.createdAt).toISOString() : '',
      entry.actor.name,
      entry.actor.role,
      entry.action,
      entry.category,
      entry.outcome,
      entry.target.type,
      entry.target.label,
      entry.target.id,
      entry.ip,
      entry.detail,
      entry.changes.map((c) => `${c.field}: ${c.from} → ${c.to}`).join(' | '),
    ];
  });

  const filters = ['category', 'action', 'actor', 'outcome', 'q', 'from', 'to']
    .filter((k) => query[k])
    .map((k) => `${k}=${query[k]}`)
    .join(', ');
  const stamp = exportStamp();
  const actor = await User.findById(req.user.id).select('fullName').lean();

  let result;
  try {
    result = await exportToSheet({
      tabTitle: `Activity ${stamp}`,
      title: 'HealthCentria — Activity log',
      details: `${rows.length} entries${filters ? ` · Filters: ${filters}` : ' · No filters'}${
        rows.length === 10000 ? ' · Capped at 10,000 rows' : ''
      } · Exported by ${actor?.fullName || 'admin'}`,
      header: [
        'timestamp',
        'actor',
        'role',
        'action',
        'category',
        'outcome',
        'target_type',
        'target',
        'target_id',
        'ip',
        'detail',
        'changes',
      ],
      rows,
    });
  } catch (error) {
    return res.status(502).json({
      success: false,
      message: error instanceof Error ? error.message : 'Could not export to Google Sheets.',
    });
  }

  await logActivity({
    req,
    action: 'activity.export_sheets',
    target: { type: 'activity', id: 'export', label: 'Activity log' },
    detail: `Exported ${rows.length} entries to Google Sheets tab "${result.tab}"${filters ? ` (filters: ${filters})` : ''}.`,
  });
  res.json({ success: true, url: result.url, tab: result.tab, rows: rows.length });
});

const PDF_ROW_CAP = 2000;

function pdfTime(date) {
  if (!date) return '';
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: env.GOOGLE_CALENDAR_TIMEZONE || 'Asia/Manila',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(date));
}

/**
 * POST /api/activity/export/pdf — the current filters as a PDF (admin only),
 * capped at 2,000 rows. Uploaded to Drive and emailed like the reports PDF.
 */
export const exportActivityPdf = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const query = parseQuery(req, res);
  if (!query) return;
  const body = recipientsSchema.safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ success: false, message: 'Invalid recipients.' });

  const filter = buildFilter(req.user, query);
  const [entries, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).limit(PDF_ROW_CAP).lean(),
    AuditLog.countDocuments(filter),
  ]);
  const filters = ['category', 'action', 'actor', 'outcome', 'q', 'from', 'to']
    .filter((k) => query[k])
    .map((k) => `${k}=${query[k]}`)
    .join(', ');
  const actor = await User.findById(req.user.id).select('fullName').lean();
  const failed = entries.filter((e) => (e.outcome ?? 'success') === 'failed').length;
  const details = `${filters ? `Filters: ${filters}` : 'All activity (no filters)'}`;

  const buffer = await buildReportPdf({
    title: 'Activity log',
    details: `${details} · Exported by ${actor?.fullName || 'admin'}`,
    summary: [
      { label: 'Entries in PDF', value: entries.length },
      { label: 'Matching entries', value: total },
      { label: 'Failed', value: failed },
    ],
    columns: [
      { header: 'Time', width: 78 },
      { header: 'Person', width: 92 },
      { header: 'Action', width: 108 },
      { header: 'Outcome', width: 44 },
      { header: 'Target', width: 100 },
      { header: 'Details' },
    ],
    rows: entries.map((e) => {
      const entry = present(e);
      return [
        pdfTime(entry.createdAt),
        `${entry.actor.name || 'System'}${entry.actor.role ? ` (${entry.actor.role})` : ''}`,
        entry.action,
        entry.outcome,
        entry.target.label || entry.target.type,
        entry.detail,
      ];
    }),
    note:
      total > entries.length
        ? `Showing the latest ${entries.length.toLocaleString('en-PH')} of ${total.toLocaleString('en-PH')} matching entries. Use Export CSV or Export to Sheets for the full log.`
        : undefined,
    landscape: true,
  });

  const stamp = new Date().toISOString().slice(0, 10);
  const fileName = `healthcentria-activity-log-${stamp}.pdf`;
  const delivery = await deliverPdf({
    req,
    buffer,
    fileName,
    reportTitle: 'Activity log',
    details: `${details} · ${entries.length} entries · Generated ${footerTimestamp()}`,
    recipientIds: body.data.recipients,
    upload: body.data.uploadToDrive,
  });

  await logActivity({
    req,
    action: 'activity.export_pdf',
    target: { type: 'activity', id: 'export', label: 'Activity log' },
    detail: describeDelivery(delivery),
  });
  sendPdfResponse(res, { buffer, fileName, delivery });
});

const purgeSchema = z.object({ confirm: z.literal(true) });

/**
 * POST /api/activity/purge — admin only.
 *
 * Deletes strictly-expired rows, then writes its own entry. The new entry is
 * created after the delete, so a purge can never remove its own record.
 */
export const purgeActivity = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const parsed = purgeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: 'Confirmation is required to purge the log.' });
  }

  const cutoff = retentionCutoff();
  const { deletedCount } = await AuditLog.deleteMany({ createdAt: { $lt: cutoff } });

  await logActivity({
    req,
    action: 'activity.purge',
    target: { type: 'activity', label: 'Activity log' },
    detail: `Purged ${deletedCount} entr${deletedCount === 1 ? 'y' : 'ies'} older than ${cutoff.toISOString()} (${ACTIVITY_RETENTION_DAYS}-day retention).`,
  });

  res.json({
    success: true,
    deleted: deletedCount,
    cutoff,
    retentionDays: ACTIVITY_RETENTION_DAYS,
  });
});

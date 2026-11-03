import mongoose from 'mongoose';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ACTIVITY_CATEGORIES, AuditLog, categoryForAction } from '../models/audit-log.model.js';
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

  const header = [
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

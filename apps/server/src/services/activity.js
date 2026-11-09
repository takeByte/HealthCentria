import { AuditLog, categoryForAction } from '../models/audit-log.model.js';
import { User } from '../models/user.model.js';

/** Entries older than this can be purged from the admin Activity screen. */
export const ACTIVITY_RETENTION_DAYS = 365;

const MAX_VALUE_CHARS = 500;
const MAX_CHANGES = 40;
const MAX_DETAIL_CHARS = 1000;

/**
 * Field names that must never carry a value into the log. Callers may still
 * report that the field changed — the values are replaced with a marker.
 */
const SENSITIVE_FIELD = [
  /pass(word|wd)/i,
  /secret/i,
  /token/i,
  /hash/i,
  /authorization/i,
  /cookie/i,
  /api[-_\s]?key/i,
  /credential/i,
  /googleid/i,
  /sessionid/i,
];

function isSensitiveField(field) {
  return SENSITIVE_FIELD.some((rx) => rx.test(field));
}

function truncate(value) {
  const text = String(value ?? '');
  return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS - 1)}…` : text;
}

/** Stable, human-readable rendering of any field value. */
function formatValue(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  if (Array.isArray(value)) return value.map(formatValue).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    if (typeof value.toHexString === 'function') return value.toHexString();
    if (typeof value.name === 'string') return value.name;
    try {
      return JSON.stringify(value);
    } catch {
      return '[unserializable]';
    }
  }
  return String(value);
}

/**
 * Turns raw [field, before, after] tuples into the stored change list.
 * Unchanged fields are dropped; sensitive fields keep the fact but not the value.
 */
export function diffChanges(entries) {
  const out = [];
  for (const entry of entries ?? []) {
    if (!entry) continue;
    const [field, from, to] = Array.isArray(entry) ? entry : [entry.field, entry.from, entry.to];
    if (!field) continue;

    if (isSensitiveField(field)) {
      out.push({ field: String(field), from: 'hidden', to: 'changed' });
    } else {
      const before = truncate(formatValue(from));
      const after = truncate(formatValue(to));
      if (before === after) continue;
      out.push({ field: String(field), from: before, to: after });
    }
    if (out.length >= MAX_CHANGES) break;
  }
  return out;
}

/** Convenience: diff a fixed set of field names between two snapshots. */
export function snapshotChanges(before, after, fields) {
  return diffChanges(fields.map((field) => [field, before?.[field], after?.[field]]));
}

/** Names are cached briefly so a burst of writes costs one lookup, and names
 *  still land in the entry as a snapshot for later renames. */
const nameCache = new Map();
const NAME_CACHE_MS = 5 * 60 * 1000;

async function resolveActorName(id) {
  const key = String(id);
  const hit = nameCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.name;
  try {
    const user = await User.findById(id).select('fullName').lean();
    const name = user?.fullName ?? '';
    nameCache.set(key, { name, expires: Date.now() + NAME_CACHE_MS });
    return name;
  } catch {
    return '';
  }
}

/**
 * Append one activity entry.
 *
 * Never throws: a logging failure must not break the action being logged. The
 * error is printed so it is still visible in the API log.
 */
export async function logActivity({
  req,
  action,
  target,
  changes,
  detail = '',
  outcome = 'success',
  actorId,
  actorName,
  actorRole,
  appointment,
  patient,
}) {
  try {
    const id = actorId ?? req?.user?.id ?? null;
    const role = actorRole ?? req?.user?.role ?? '';
    let name = actorName ?? '';
    if (!name && id) name = await resolveActorName(id);

    const label =
      target?.label !== undefined && target?.label !== null
        ? truncate(formatValue(target.label)).slice(0, 200)
        : '';

    await AuditLog.create({
      actor: id || null,
      actorName: name,
      actorRole: ['patient', 'staff', 'admin'].includes(role) ? role : '',
      action,
      category: categoryForAction(action),
      targetType: target?.type ?? '',
      targetId: target?.id ? String(target.id) : '',
      targetLabel: label,
      targetRole: ['patient', 'staff', 'admin'].includes(target?.role) ? target.role : '',
      changes: diffChanges(changes),
      outcome,
      ip: req?.ctx?.ip ?? '',
      userAgent: req?.ctx?.userAgent ?? '',
      detail: truncate(detail).slice(0, MAX_DETAIL_CHARS),
      ...(appointment ? { appointment } : {}),
      ...(patient ? { patient } : {}),
    });
  } catch (err) {
    console.error('Activity log write failed:', err instanceof Error ? err.message : 'unknown error');
  }
}

/** Start of the purgeable window: anything strictly older than this is expired. */
export function retentionCutoff(now = new Date()) {
  return new Date(now.getTime() - ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

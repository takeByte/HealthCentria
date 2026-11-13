import { createHash, randomBytes } from 'node:crypto';

/**
 * Second factor for superadmin-gated changes: an approval the superadmin grants
 * by clicking a link in an email sent to SU_EMAIL.
 *
 * Two separate secrets per approval:
 *  - `id`    stays in the requesting admin's browser and is used to poll status
 *            and to replay the change once approved. Bound to that user.
 *  - `token` goes only into the email link. Only its SHA-256 is stored here.
 *
 * Records live in memory, like the PIN attempt counters: a server restart drops
 * pending approvals and the admin simply requests a new one.
 */

export const APPROVAL_TTL_MS = 5 * 60 * 1000;
const MAX_PENDING_PER_USER = 3;
const KEEP_FINISHED_MS = 10 * 60 * 1000;

/** id -> record */
const approvals = new Map();

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function purge() {
  const now = Date.now();
  for (const [id, a] of approvals) {
    const dead = a.expiresAt <= now;
    if (dead && now - a.expiresAt > KEEP_FINISHED_MS) approvals.delete(id);
  }
}

/** Effective status: a pending or approved record past its deadline is expired. */
function statusOf(a) {
  if ((a.status === 'pending' || a.status === 'approved') && a.expiresAt <= Date.now()) return 'expired';
  return a.status;
}

function view(a) {
  return {
    id: a.id,
    status: statusOf(a),
    label: a.label,
    requestedBy: a.requestedBy,
    requestedAt: a.createdAt,
    expiresAt: a.expiresAt,
    ip: a.ip,
  };
}

/** Identifies the action an approval covers: HTTP method + path of the gated route. */
export function approvalFingerprint(req) {
  return `${req.method} ${req.baseUrl}${req.path}`;
}

export function pendingCount(userId) {
  let n = 0;
  for (const a of approvals.values()) {
    if (a.userId === userId && statusOf(a) === 'pending') n += 1;
  }
  return n;
}

export function canCreateApproval(userId) {
  purge();
  return pendingCount(userId) < MAX_PENDING_PER_USER;
}

export function createApproval({ userId, fingerprint, label, requestedBy, ip }) {
  const id = randomBytes(24).toString('hex');
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  approvals.set(id, {
    id,
    tokenHash: sha256(token),
    userId: String(userId),
    fingerprint,
    label,
    requestedBy,
    ip: ip ?? '',
    status: 'pending',
    createdAt: now,
    expiresAt: now + APPROVAL_TTL_MS,
  });
  return { id, token, expiresAt: now + APPROVAL_TTL_MS };
}

export function discardApproval(id) {
  approvals.delete(id);
}

/** The requesting admin's own approval, or null when unknown / someone else's. */
export function getOwnedApproval(id, userId) {
  const a = approvals.get(String(id ?? ''));
  if (!a || a.userId !== String(userId)) return null;
  return { record: a, status: statusOf(a), view: view(a) };
}

/**
 * An approval this admin already got for this exact action that has not been
 * used up yet (the change failed validation after approval). Lets a retry within
 * the window skip a second email.
 */
export function findApprovedFor(userId, fingerprint) {
  for (const a of approvals.values()) {
    if (a.userId === String(userId) && a.fingerprint === fingerprint && statusOf(a) === 'approved') return a;
  }
  return null;
}

/** Called once the gated change went through; the approval is spent. */
export function markUsed(id) {
  const a = approvals.get(id);
  if (a && a.status === 'approved') a.status = 'used';
}

/** The requesting admin closed the dialog while waiting. */
export function cancelApproval(id, userId) {
  const a = approvals.get(String(id ?? ''));
  if (!a || a.userId !== String(userId)) return false;
  if (statusOf(a) === 'pending') a.status = 'cancelled';
  return true;
}

function byToken(token) {
  if (typeof token !== 'string' || token.length < 32 || token.length > 128) return null;
  const hash = sha256(token);
  for (const a of approvals.values()) {
    if (a.tokenHash === hash) return a;
  }
  return null;
}

/** What the confirmation page shows. No ids, no secrets. */
export function describeByToken(token) {
  const a = byToken(token);
  if (!a) return null;
  const v = view(a);
  return {
    status: v.status,
    label: v.label,
    requestedBy: v.requestedBy,
    requestedAt: v.requestedAt,
    expiresAt: v.expiresAt,
    ip: v.ip,
  };
}

/**
 * Superadmin decision from the email link. Only a pending, unexpired approval
 * can be decided, and only once.
 * @returns {{ ok: boolean, status: string, record?: object }}
 */
export function decideByToken(token, decision) {
  const a = byToken(token);
  if (!a) return { ok: false, status: 'unknown' };
  const current = statusOf(a);
  if (current !== 'pending') return { ok: false, status: current };
  a.status = decision === 'confirm' ? 'approved' : 'denied';
  return { ok: true, status: a.status, record: a };
}

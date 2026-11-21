import { RecordLock } from '../models/record-lock.model.js';

/**
 * Record-level edit locks for forms that save one record at a time
 * (announcements and services today).
 *
 * A screen claims the record when it opens the editor, renews while it stays
 * open, and gives it back on save, cancel, or leaving. Another tab sees who
 * holds it instead of opening a form whose save would be refused.
 *
 * This is the courtesy layer. The version check in utils/concurrency.js is
 * still what makes a save safe.
 */

/** How long a claim stays valid without a heartbeat. */
export const RECORD_LOCK_TTL_MS = 600_000;

/** How often the open editor renews it. */
export const RECORD_LOCK_HEARTBEAT_MS = 60_000;

function publicRecordLock(lock, owner) {
  if (!lock) return null;
  return {
    heldBy: lock.userName,
    expiresAt: new Date(lock.expiresAt).toISOString(),
    mine: lock.owner === owner,
  };
}

/** The live lock on a record, or null when it is free. */
export async function readRecordLock(resource, resourceId, owner) {
  const row = await RecordLock.findOne({
    resource,
    resourceId,
    expiresAt: { $gt: new Date() },
  }).lean();
  return publicRecordLock(row, owner);
}

/**
 * Claim or renew the record.
 *
 * `{ acquired: true, lock }` means this tab now holds it (fresh claim or a
 * heartbeat). `{ acquired: false, lock }` means another tab still holds a live
 * claim.
 */
export async function acquireRecordLock({
  resource,
  resourceId,
  owner,
  userId,
  userName,
  nonce,
  ttlMs = RECORD_LOCK_TTL_MS,
}) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);

  // Renew our own claim, or take over one whose lease has run out, in one
  // atomic write so a renewal and a takeover cannot both win.
  const renewed = await RecordLock.findOneAndUpdate(
    { resource, resourceId, $or: [{ owner }, { expiresAt: { $lte: now } }] },
    { $set: { owner, userId, userName, nonce, expiresAt } },
    { new: true },
  ).lean();
  if (renewed) return { acquired: true, lock: publicRecordLock(renewed, owner) };

  try {
    const created = await RecordLock.create({
      resource,
      resourceId,
      owner,
      userId,
      userName,
      nonce,
      expiresAt,
    });
    return { acquired: true, lock: publicRecordLock(created.toObject(), owner) };
  } catch (err) {
    if (err?.code !== 11000) throw err;
    // Somebody else won the race between the read and the insert.
    const held = await RecordLock.findOne({
      resource,
      resourceId,
      expiresAt: { $gt: new Date() },
    }).lean();
    return { acquired: false, lock: publicRecordLock(held, owner) };
  }
}

/**
 * Return the record. Filtered by owner, and by nonce when sent, so a late
 * release from an earlier claim cannot delete a newer one. Without an owner it
 * clears the record entirely (used when the record itself is deleted).
 */
export async function releaseRecordLock({ resource, resourceId, owner, nonce }) {
  const filter = { resource, resourceId };
  if (owner) filter.owner = owner;
  if (nonce) filter.nonce = nonce;
  const result = await RecordLock.deleteMany(filter);
  return result.deletedCount;
}

/**
 * The live lock when somebody else holds the record, or null. Used by the
 * save paths to refuse a write from a tab that never claimed it.
 */
export async function recordHeldByOther({ resource, resourceId, owner }) {
  const filter = { resource, resourceId, expiresAt: { $gt: new Date() } };
  if (owner) filter.owner = { $ne: owner };
  const row = await RecordLock.findOne(filter).lean();
  return row ? { heldBy: row.userName, expiresAt: new Date(row.expiresAt).toISOString() } : null;
}

/**
 * Who is editing each record on a page, keyed by record id.
 *
 * `mine` compares the account, not the tab, so the list can say "you are
 * editing this in another tab" instead of pretending a stranger holds it.
 */
export async function recordLocksByIds(resource, resourceIds, viewerId) {
  const map = new Map();
  if (resourceIds.length === 0) return map;

  const rows = await RecordLock.find({
    resource,
    resourceId: { $in: resourceIds.map(String) },
    expiresAt: { $gt: new Date() },
  }).lean();

  for (const row of rows) {
    map.set(row.resourceId, {
      heldBy: row.userName,
      mine: String(row.userId) === String(viewerId),
      expiresAt: new Date(row.expiresAt).toISOString(),
    });
  }
  return map;
}

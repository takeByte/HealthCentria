import { VisitFieldLock } from '../models/visit-field-lock.model.js';

/**
 * Pessimistic section locks for a visit record.
 *
 * The optimistic version check in utils/concurrency.js protects the save. This
 * protects the *editing session*: when the view/edit screen opens, its tab
 * claims Diagnosis, Prescription and Visit Notes, and another tab is told who
 * holds each section instead of typing into a record someone else is changing.
 *
 * It is a lease, not a permanent claim:
 *   - the holder renews it every 30 s and it expires after 90 s;
 *   - the claim is one atomic write, so two tabs cannot both win;
 *   - an expired row never blocks, even before Mongo's TTL monitor removes it.
 *
 * The version check keeps the data safe on its own. The lock exists so two
 * people cannot type for five minutes and only then discover the collision.
 */

export const VISIT_LOCK_SECTIONS = ['diagnosis', 'prescription', 'visitNotes'];

/** How long a claim stays valid without a heartbeat. */
export const VISIT_LOCK_TTL_MS = 90_000;

/** How often the browser renews it (three chances before it expires). */
export const VISIT_LOCK_HEARTBEAT_MS = 30_000;

export const SECTION_LABELS = {
  diagnosis: 'Diagnosis',
  prescription: 'Prescription',
  visitNotes: 'Visit notes',
};

function publicLock(lock, owner) {
  if (!lock) return null;
  return {
    section: lock.section,
    heldBy: lock.userName,
    expiresAt: new Date(lock.expiresAt).toISOString(),
    mine: lock.owner === owner,
  };
}

/** Every live lock on a visit, as a map keyed by section (null when free). */
export async function readVisitLocks(appointmentId, owner) {
  const rows = await VisitFieldLock.find({
    appointmentId,
    expiresAt: { $gt: new Date() },
  }).lean();

  const locks = Object.fromEntries(VISIT_LOCK_SECTIONS.map((section) => [section, null]));
  for (const row of rows) locks[row.section] = publicLock(row, owner);
  return locks;
}

/**
 * Claim or renew one section.
 *
 * Returns `{ acquired: true, lock }` when this tab now holds it (fresh claim or
 * a heartbeat from the same tab), and `{ acquired: false, lock }` when another
 * tab still holds a live claim.
 */
export async function acquireVisitLock({
  appointmentId,
  section,
  owner,
  userId,
  userName,
  nonce,
  ttlMs = VISIT_LOCK_TTL_MS,
}) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);

  // Renew our own claim, or take over one whose lease has run out. One atomic
  // find-and-update, so a takeover and a renewal cannot interleave.
  const renewed = await VisitFieldLock.findOneAndUpdate(
    { appointmentId, section, $or: [{ owner }, { expiresAt: { $lte: now } }] },
    { $set: { owner, userId, userName, nonce, expiresAt } },
    { new: true },
  ).lean();
  if (renewed) return { acquired: true, lock: publicLock(renewed, owner) };

  try {
    const created = await VisitFieldLock.create({ appointmentId, section, owner, userId, userName, nonce, expiresAt });
    return { acquired: true, lock: publicLock(created.toObject(), owner) };
  } catch (err) {
    if (err?.code !== 11000) throw err;
    // Somebody else won the race between our read and our insert.
    const held = await VisitFieldLock.findOne({
      appointmentId,
      section,
      expiresAt: { $gt: new Date() },
    }).lean();
    return { acquired: false, lock: publicLock(held, owner) };
  }
}

/** Claim every section of a visit. Sections held by others are reported, not retried. */
export async function acquireVisitLocks({ appointmentId, owner, userId, userName, nonce, ttlMs }) {
  const locks = {};
  const blocked = [];

  for (const section of VISIT_LOCK_SECTIONS) {
    const result = await acquireVisitLock({
      appointmentId,
      section,
      owner,
      userId,
      userName,
      nonce,
      ttlMs,
    });
    locks[section] = result.lock;
    if (!result.acquired) blocked.push(section);
  }

  return { locks, blocked };
}

/**
 * Give back this tab's sections. Filtered by owner and, when sent, nonce, so a
 * late release from an earlier acquisition cannot delete a newer claim.
 */
export async function releaseVisitLocks({ appointmentId, owner, nonce }) {
  const filter = { appointmentId, owner };
  if (nonce) filter.nonce = nonce;
  const result = await VisitFieldLock.deleteMany(filter);
  return result.deletedCount;
}

/**
 * Live locks on the given sections that belong to somebody else.
 * Used by the write paths to refuse a save that would type over another editor.
 */
export async function sectionsHeldByOthers({ appointmentId, sections, owner }) {
  if (sections.length === 0) return [];

  const filter = {
    appointmentId,
    section: { $in: sections },
    expiresAt: { $gt: new Date() },
  };
  if (owner) filter.owner = { $ne: owner };

  const rows = await VisitFieldLock.find(filter).lean();
  return rows.map((row) => ({ section: row.section, heldBy: row.userName }));
}

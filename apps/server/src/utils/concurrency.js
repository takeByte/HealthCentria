/**
 * Optimistic concurrency helpers (version stamps).
 *
 * Every record carries a version number. Collections that already moved to the visible
 * `version` field (announcements, patients/users, appointments) use `field = 'version'`;
 * collections that still use Mongoose's hidden counter (services) use the default `__v`.
 *
 * The API v2 write routes require the client to send the version it loaded (`version` in
 * the body). If the stored version has moved on, somebody else saved first, so we answer 409
 * instead of silently overwriting their change ("lost update"). The race between this check
 * and the save itself is closed either by Mongoose (save() carries the version in its filter)
 * or by versionedUpdate() in controllers/mvcc.controller.js (one atomic findOneAndUpdate).
 *
 * Why a counter and not a timestamp: two servers' clocks can disagree and two
 * saves can land in the same millisecond, so wall-clock ordering can miss a
 * conflict. A counter that only ever goes up cannot. `updatedAt` is still sent,
 * for people to read.
 */

export function currentVersion(doc, field = '__v') {
  return Number(doc?.[field] ?? 0);
}

/**
 * True when the request may go ahead. Sends the 409 itself and returns false when
 * the client's version is out of date. v1 requests carry no version and are left
 * to Mongoose's save-time check, exactly as before.
 *
 * @param {import('express').Request & { expectedVersion?: number }} req
 * @param {string} [field] which field holds the version ('__v' or 'version')
 */
export function versionMatches(req, res, doc, what, field = '__v') {
  if (req.expectedVersion === undefined) return true;
  if (currentVersion(doc, field) === req.expectedVersion) return true;
  res.status(409).json({
    success: false,
    code: 'EDIT_CONFLICT',
    message: `This ${what} was changed by someone else while you were editing it. Reload to see the latest version, then make your change again.`,
    currentVersion: currentVersion(doc, field),
    updatedAt: doc?.updatedAt ?? null,
  });
  return false;
}

/** Mongo filter fragment that pins an update to the version the client loaded. */
export function versionFilter(req, field = '__v') {
  if (req.expectedVersion === undefined) return {};
  // A document that has no `version` yet (migration not run) counts as version 0.
  if (field !== '__v' && req.expectedVersion === 0) {
    return { $or: [{ [field]: 0 }, { [field]: { $exists: false } }] };
  }
  return { [field]: req.expectedVersion };
}

/**
 * Optimistic concurrency helpers (version stamps).
 *
 * Every record carries a version number (`__v`, kept by Mongoose's
 * optimisticConcurrency). The API v2 write routes require the client to send the
 * version it loaded (`version` in the body). If the stored version has moved on,
 * somebody else saved first, so we answer 409 instead of silently overwriting
 * their change ("lost update"). The race between this check and the save itself
 * is closed by Mongoose, which saves with `__v` in the filter.
 *
 * Why a counter and not a timestamp: two servers' clocks can disagree and two
 * saves can land in the same millisecond, so wall-clock ordering can miss a
 * conflict. A counter that only ever goes up cannot. `updatedAt` is still sent,
 * for people to read.
 */

export function currentVersion(doc) {
  return Number(doc?.__v ?? 0);
}

/**
 * True when the request may go ahead. Sends the 409 itself and returns false when
 * the client's version is out of date. v1 requests carry no version and are left
 * to Mongoose's save-time check, exactly as before.
 *
 * @param {import('express').Request & { expectedVersion?: number }} req
 */
export function versionMatches(req, res, doc, what) {
  if (req.expectedVersion === undefined) return true;
  if (currentVersion(doc) === req.expectedVersion) return true;
  res.status(409).json({
    success: false,
    code: 'EDIT_CONFLICT',
    message: `This ${what} was changed by someone else while you were editing it. Reload to see the latest version, then make your change again.`,
    currentVersion: currentVersion(doc),
    updatedAt: doc?.updatedAt ?? null,
  });
  return false;
}

/**
 * Mongo filter fragment that pins an update to a version.
 *
 * Mongoose's `optimisticConcurrency` only protects `save()`. It does NOT add
 * `__v` to `findOneAndUpdate`, `findByIdAndUpdate` or `updateOne`, so every
 * update query on a versioned record must add the filter itself or it will
 * silently overwrite a newer write.
 *
 * When the client sent a version (v2), pin that. When it did not (v1), pin the
 * version that was just read: the write then becomes compare-and-set, so a
 * change landing between the read and the write makes the update miss instead
 * of overwriting it. v1 keeps working, but it is no longer last-write-wins.
 *
 * @param {import('express').Request & { expectedVersion?: number }} req
 * @param {unknown} doc the record as it was read, before the update
 */
export function versionFilterFor(req, doc) {
  return { __v: req.expectedVersion ?? currentVersion(doc) };
}

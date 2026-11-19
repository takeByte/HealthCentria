/**
 * MVCC-style versioned writes (optimistic concurrency, tied to the database operation).
 *
 * Every document has a `version` number stored in MongoDB. An edit says which version it
 * was written against (`expectedVersion`). The check and the write are ONE atomic MongoDB
 * operation:
 *
 *     findOneAndUpdate(
 *       { _id, version: expectedVersion },                // only matches if nobody saved first
 *       { $set: changes, $inc: { version: 1 } },          // edit + version bump, together
 *       { new: true },
 *     )
 *
 * MongoDB applies a single-document update atomically, so if two saves start from the same
 * version, exactly one of them matches the filter. The other gets `null` back, nothing is
 * overwritten, and we answer with the latest data so the client can sync to it.
 *
 * Legacy documents without a `version` field count as version 0 (and the first edit
 * creates the field with the value 1), so nothing breaks before the migration script runs.
 *
 * This file is generic: pass any Mongoose model that has a numeric `version` field.
 */

/** version === n, treating a missing field as 0. */
function versionFilter(expectedVersion) {
  if (expectedVersion === 0) return { $or: [{ version: 0 }, { version: { $exists: false } }] };
  return { version: expectedVersion };
}

/**
 * @param {object} args
 * @param {import('mongoose').Model} args.Model
 * @param {string} args.id
 * @param {number | undefined} args.expectedVersion  undefined = unversioned (legacy v1 client): last write wins, but still bumps the version
 * @param {Record<string, unknown>} args.changes      fields to $set
 * @param {Array<object | string>} [args.populate]
 * @returns {Promise<
 *   | { status: 'ok'; doc: object; previousVersion: number }
 *   | { status: 'not_found' }
 *   | { status: 'conflict'; current: object }
 * >}  `doc` / `current` are plain objects (lean).
 */
export async function versionedUpdate({ Model, id, expectedVersion, changes, populate = [] }) {
  const filter = { _id: id };
  if (expectedVersion !== undefined) Object.assign(filter, versionFilter(expectedVersion));

  // The atomic step: compare version + write + increment in one operation.
  let query = Model.findOneAndUpdate(
    filter,
    { $set: changes, $inc: { version: 1 } },
    { new: true, runValidators: true },
  );
  for (const p of populate) query = query.populate(p);
  const doc = await query.lean();

  if (doc) {
    return { status: 'ok', doc, previousVersion: Number(doc.version) - 1 };
  }

  // Nothing matched: either the document is gone or the version was stale. Read the
  // latest copy so the caller can sync the user to it.
  let read = Model.findById(id);
  for (const p of populate) read = read.populate(p);
  const current = await read.lean();
  if (!current) return { status: 'not_found' };
  return { status: 'conflict', current };
}

/**
 * Sends the standard 409 body for a refused edit. It carries the latest document so the
 * browser can show it immediately, with no reload and no second request.
 *
 * @param {import('express').Response} res
 * @param {object} current       latest document (lean)
 * @param {(doc: object) => object} present  turns it into the API shape
 */
export function sendVersionConflict(res, current, present, what) {
  const latest = present(current);
  return res.status(409).json({
    success: false,
    code: 'EDIT_CONFLICT',
    message: `This ${what} was changed by someone else (now version ${latest.version}). Showing the latest version.`,
    currentVersion: latest.version,
    updatedAt: latest.updatedAt ?? null,
    current: latest,
  });
}

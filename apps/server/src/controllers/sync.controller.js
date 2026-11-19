import mongoose from 'mongoose';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { Announcement } from '../models/announcement.model.js';
import { POPULATE, present } from './announcement.controller.js';

/**
 * Automatic sync (no page reload).
 *
 * How the pieces fit together:
 *
 *   1. PUSH (fast path). When an edit succeeds, announcement.controller calls
 *      live.announcements(id, req, { version }) -> socket.io tells every open browser
 *      "announcement <id> is now version <n>". Nothing but the id and the number travels.
 *
 *   2. DETECT + FETCH (this file). A browser that holds an older version calls
 *      GET /api/sync/announcements/:id?since=<version it holds>
 *        - same version  -> { changed: false, version }           (tiny reply, nothing to apply)
 *        - newer version -> { changed: true, version, announcement } (the latest data)
 *      The server compares the number with the one stored in MongoDB Atlas, so the answer
 *      always comes from the database, never from a cache.
 *
 *   3. SAFETY NET. The same endpoint is what the browser calls when the tab regains focus,
 *      after a reconnect, and on a slow timer while the socket is down - so a missed push
 *      never leaves a screen stale for long.
 *
 * Why this and not MongoDB change streams: the project already runs a socket.io layer and one
 * server process, so a push after a successful write is exact (it only fires when `version`
 * really moved), costs nothing while idle, and needs no long-lived cursor, resume tokens or
 * special Atlas tier. Change streams would only add value with several server processes or
 * writers that bypass this API - and then the socket.io Redis adapter is also needed.
 */

function requireDB(res) {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({ success: false, message: 'Database is not connected. Try again later.' });
    return false;
  }
  return true;
}

/** GET /api/sync/announcements/:id?since=<version> */
export const syncAnnouncement = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid announcement id.' });
  }

  const sinceRaw = req.query.since;
  const since = sinceRaw === undefined ? undefined : Number(sinceRaw);
  if (since !== undefined && (!Number.isInteger(since) || since < 0)) {
    return res.status(400).json({ success: false, message: '"since" must be a whole number.' });
  }

  // Cheap check first: read only the version number.
  const head = await Announcement.findById(req.params.id).select('version updatedAt').lean();
  if (!head) return res.status(404).json({ success: false, code: 'GONE', message: 'Announcement not found.' });
  const version = Number(head.version ?? 0);

  res.set('Cache-Control', 'no-store');
  if (since !== undefined && since === version) {
    return res.json({ success: true, changed: false, version });
  }

  // The version moved (or the caller did not say what it has): send the latest data.
  const doc = await Announcement.findById(req.params.id).populate(POPULATE).lean();
  if (!doc) return res.status(404).json({ success: false, code: 'GONE', message: 'Announcement not found.' });
  const latest = present(doc);
  return res.json({ success: true, changed: true, version: latest.version, announcement: latest });
});

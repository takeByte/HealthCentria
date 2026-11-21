import mongoose from 'mongoose';
import { User } from '../models/user.model.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { readEditNonce, readEditOwner } from '../utils/edit-owner.js';
import { recordResource } from '../utils/record-resources.js';
import {
  RECORD_LOCK_HEARTBEAT_MS,
  acquireRecordLock,
  readRecordLock,
  recordLocksByIds,
  releaseRecordLock,
} from '../services/record-locks.js';

/**
 * Record-level edit locks for the announcement and service editors.
 *
 * A screen claims the record when it opens the editor, so another tab sees who
 * is editing it and cannot start a save that would be refused. Claims are
 * renewed while the editor stays open and released on save, cancel or expiry.
 */

function requireDB(res) {
  if (mongoose.connection.readyState === 1) return true;
  res.status(503).json({ success: false, message: 'Database is not connected. Try again later.' });
  return false;
}

function missingOwner(res) {
  return res
    .status(400)
    .json({ success: false, code: 'EDIT_OWNER_REQUIRED', message: 'Missing or invalid edit owner.' });
}

function missingNonce(res) {
  return res
    .status(400)
    .json({ success: false, code: 'EDIT_NONCE_REQUIRED', message: 'Missing or invalid edit nonce.' });
}

/** Every live lock for a page of records (one query). */
export const listRecordLocks = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const def = recordResource(req.params.resource);
  if (!def) return res.status(404).json({ success: false, message: 'Unknown record type.' });

  const ids = String(req.query.ids ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => mongoose.isValidObjectId(id))
    .slice(0, 100);
  if (ids.length === 0) return res.json({ success: true, locks: {} });

  const locks = await recordLocksByIds(req.params.resource, ids, req.user.id);
  res.json({ success: true, locks: Object.fromEntries(locks) });
});

/** The live lock on one record, so an open editor can watch it. */
export const getRecordLock = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const def = recordResource(req.params.resource);
  if (!def) return res.status(404).json({ success: false, message: 'Unknown record type.' });
  if (!(await def.exists(req.params.id))) {
    return res.status(404).json({ success: false, message: `${def.label[0].toUpperCase()}${def.label.slice(1)} not found.` });
  }

  const lock = await readRecordLock(req.params.resource, req.params.id, readEditOwner(req));
  res.json({ success: true, lock });
});

/** Claim or renew the record (or report the tab that already holds it). */
export const claimRecordLock = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const def = recordResource(req.params.resource);
  if (!def) return res.status(404).json({ success: false, message: 'Unknown record type.' });

  const owner = readEditOwner(req);
  if (!owner) return missingOwner(res);
  const nonce = readEditNonce(req);
  if (!nonce) return missingNonce(res);

  if (!(await def.exists(req.params.id))) {
    return res.status(404).json({ success: false, message: `${def.label[0].toUpperCase()}${def.label.slice(1)} not found.` });
  }

  // The name in "X is editing" comes from the account, never the client.
  const user = await User.findById(req.user.id).select('fullName role').lean();
  if (!user) {
    return res.status(401).json({ success: false, message: 'Session is no longer valid. Log in again.' });
  }

  const { acquired, lock } = await acquireRecordLock({
    resource: req.params.resource,
    resourceId: req.params.id,
    owner,
    userId: req.user.id,
    userName: user.fullName || 'A staff member',
    nonce,
  });

  res.json({
    success: true,
    acquired,
    lock,
    blocked: acquired ? null : lock,
    heartbeatMs: RECORD_LOCK_HEARTBEAT_MS,
  });
});

/** Give the record back (save, cancel, or leaving the editor). */
export const releaseRecordLockHandler = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const def = recordResource(req.params.resource);
  if (!def) return res.status(404).json({ success: false, message: 'Unknown record type.' });

  const owner = readEditOwner(req);
  if (!owner) return missingOwner(res);

  const released = await releaseRecordLock({
    resource: req.params.resource,
    resourceId: req.params.id,
    owner,
    nonce: readEditNonce(req) || undefined,
  });
  res.json({ success: true, released });
});

import mongoose from 'mongoose';
import { Appointment } from '../models/appointment.model.js';
import { User } from '../models/user.model.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { readEditNonce, readEditOwner } from '../utils/edit-owner.js';
import {
  VISIT_LOCK_HEARTBEAT_MS,
  acquireVisitLocks,
  readVisitLocks,
  releaseVisitLocks,
} from '../services/visit-locks.js';

/**
 * Section locks for the visit record screen.
 *
 * The screen claims all three sections when it opens, so another tab sees who
 * is editing and cannot type into those fields. Claims are renewed while the
 * screen stays open and released when it closes, saves, or expires.
 */

function requireDB(res) {
  if (mongoose.connection.readyState === 1) return true;
  res.status(503).json({ success: false, message: 'Database is not connected. Try again later.' });
  return false;
}

/** Every live section lock, so the screen can show who is editing each one. */
export const listVisitLocks = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const owner = readEditOwner(req);

  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ success: false, message: 'Appointment not found.' });
  }
  const exists = await Appointment.exists({ _id: req.params.id });
  if (!exists) return res.status(404).json({ success: false, message: 'Appointment not found.' });

  const locks = await readVisitLocks(req.params.id, owner);
  res.json({ success: true, locks });
});

/** Claim all three sections (or report which ones another tab already holds). */
export const claimVisitLocks = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;

  const owner = readEditOwner(req);
  if (!owner) {
    return res.status(400).json({ success: false, code: 'EDIT_OWNER_REQUIRED', message: 'Missing or invalid edit owner.' });
  }
  const nonce = readEditNonce(req);
  if (!nonce) {
    return res.status(400).json({ success: false, code: 'EDIT_NONCE_REQUIRED', message: 'Missing or invalid edit nonce.' });
  }

  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ success: false, message: 'Appointment not found.' });
  }
  const appointment = await Appointment.findById(req.params.id).select('_id status').lean();
  if (!appointment) return res.status(404).json({ success: false, message: 'Appointment not found.' });

  // The name shown in "X is editing" comes from the account, never the client.
  const user = await User.findById(req.user.id).select('fullName role').lean();
  if (!user) return res.status(401).json({ success: false, message: 'Session is no longer valid. Log in again.' });

  const { locks, blocked } = await acquireVisitLocks({
    appointmentId: req.params.id,
    owner,
    userId: req.user.id,
    userName: user.fullName || 'A staff member',
    nonce,
  });

  res.json({ success: true, locks, blocked, heartbeatMs: VISIT_LOCK_HEARTBEAT_MS });
});

/** Release this tab's sections (save, cancel, or leaving the screen). */
export const releaseVisitLocksHandler = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;

  const owner = readEditOwner(req);
  if (!owner) {
    return res.status(400).json({ success: false, code: 'EDIT_OWNER_REQUIRED', message: 'Missing or invalid edit owner.' });
  }

  const released = await releaseVisitLocks({
    appointmentId: req.params.id,
    owner,
    nonce: readEditNonce(req) || undefined,
  });
  res.json({ success: true, released });
});

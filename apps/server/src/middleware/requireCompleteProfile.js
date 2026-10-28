import mongoose from 'mongoose';
import { User } from '../models/user.model.js';
import { asyncHandler } from './asyncHandler.js';

/**
 * Booking requires a completed patient profile. Reading and cancelling
 * appointments deliberately stay available to incomplete accounts.
 */
export const requireCompleteProfile = asyncHandler(async (req, res, next) => {
  if (!req.user || req.user.role !== 'patient') return next();

  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ success: false, message: 'Database is not connected. Try again later.' });
  }

  const user = await User.findById(req.user.id).select('role active profileComplete').lean();
  if (!user || !user.active) {
    return res.status(401).json({ success: false, message: 'Session is no longer valid. Log in again.' });
  }

  // Role changes after the token was issued are respected here too.
  if (user.role !== 'patient') return next();

  if (user.profileComplete === false) {
    return res.status(403).json({
      success: false,
      code: 'PROFILE_INCOMPLETE',
      message: 'Complete your profile before booking an appointment.',
    });
  }

  return next();
});

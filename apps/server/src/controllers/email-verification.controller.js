import mongoose from 'mongoose';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { User } from '../models/user.model.js';
import { VerificationCode } from '../models/verification-code.model.js';
import { issueEmailVerification } from '../services/email-verification.js';
import { logActivity } from '../services/activity.js';
import { presentUser } from '../utils/present-user.js';
import {
  EMAIL_VERIFICATION_PURPOSE,
  VERIFY_MAX_ATTEMPTS,
  VERIFY_RESEND_COOLDOWN_SECONDS,
  emailCodeMatches,
  normalizeEmailCode,
} from '../utils/email-verification.js';

function requireDB(res) {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({ success: false, message: 'Database is not connected. Try again later.' });
    return false;
  }
  return true;
}

/**
 * POST /api/auth/email/verify/request — send (or resend) a code to the
 * signed-in account's own address. Nothing is ever sent to an arbitrary email,
 * so this endpoint cannot be used to mail strangers.
 */
export const requestEmailVerification = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;

  const user = await User.findById(req.user.id).select('email fullName role emailVerified active').lean();
  if (!user || !user.active) {
    return res.status(401).json({ success: false, message: 'Session is no longer valid. Log in again.' });
  }

  if (user.emailVerified !== false) {
    return res.json({
      success: true,
      alreadyVerified: true,
      message: 'Your email is already verified.',
    });
  }

  const result = await issueEmailVerification(user);

  if (result.cooling) {
    return res.json({
      success: true,
      cooldown: true,
      message: 'A code was sent recently. Check your inbox and spam folder, or wait a moment before resending.',
      resendAfter: result.retryAfter ?? VERIFY_RESEND_COOLDOWN_SECONDS,
    });
  }

  if (result.issued && !result.sent) {
    return res.status(502).json({
      success: false,
      message: 'The verification email could not be sent. Try again later or ask the clinic to check email settings.',
    });
  }

  if (result.issued) {
    await logActivity({
      req,
      action: 'auth.email_verification_sent',
      actorId: user._id,
      actorName: user.fullName,
      actorRole: user.role,
      target: { type: 'auth', id: user._id, label: user.email },
      detail: 'Email verification code sent to the account email.',
    });
  }

  res.json({
    success: true,
    message: 'We sent a 6-digit code to your email. Check your inbox and spam folder.',
    resendAfter: VERIFY_RESEND_COOLDOWN_SECONDS,
  });
});

const confirmSchema = z.object({
  code: z.string().trim().min(1, 'Enter the 6-digit code from your email.'),
});

/**
 * POST /api/auth/email/verify/confirm — consume the code and mark the account
 * verified. Unverified accounts keep full access, so this is a reminder, not a
 * gate.
 */
export const confirmEmailVerification = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;

  const parsed = confirmSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }

  const code = normalizeEmailCode(parsed.data.code);
  if (!code) {
    return res.status(400).json({ success: false, message: 'Enter the 6-digit code from your email.' });
  }

  const user = await User.findById(req.user.id);
  if (!user || !user.active) {
    return res.status(401).json({ success: false, message: 'Session is no longer valid. Log in again.' });
  }

  if (user.emailVerified !== false) {
    return res.json({
      success: true,
      alreadyVerified: true,
      user: presentUser(user),
      message: 'Your email is already verified.',
    });
  }

  const email = String(user.email).toLowerCase();
  const record = await VerificationCode.findOne({
    email,
    purpose: EMAIL_VERIFICATION_PURPOSE,
    consumedAt: null,
  }).sort({ createdAt: -1 });

  if (!record) {
    return res.status(400).json({ success: false, message: 'That code has expired. Request a new one.' });
  }
  if (record.expiresAt.getTime() <= Date.now()) {
    return res.status(400).json({ success: false, message: 'That code has expired. Request a new one.' });
  }
  if (record.attempts >= VERIFY_MAX_ATTEMPTS) {
    return res.status(429).json({ success: false, message: 'Too many attempts. Request a new code.' });
  }

  if (!emailCodeMatches(code, record.codeHash)) {
    record.attempts += 1;
    await record.save();
    await logActivity({
      req,
      action: 'auth.email_verification_failed',
      outcome: 'failed',
      actorId: user._id,
      actorName: user.fullName,
      actorRole: user.role,
      target: { type: 'auth', id: user._id, label: email },
      detail: 'Wrong email verification code.',
    });
    return res.status(400).json({
      success: false,
      message:
        record.attempts >= VERIFY_MAX_ATTEMPTS
          ? 'Too many attempts. Request a new code.'
          : `That code is not correct. ${VERIFY_MAX_ATTEMPTS - record.attempts} attempt(s) left.`,
    });
  }

  user.emailVerified = true;
  user.emailVerifiedAt = new Date();
  await user.save();

  record.consumedAt = new Date();
  await record.save();
  await VerificationCode.deleteMany({ email, purpose: EMAIL_VERIFICATION_PURPOSE, consumedAt: null });

  await logActivity({
    req,
    action: 'auth.email_verified',
    actorId: user._id,
    actorName: user.fullName,
    actorRole: user.role,
    target: { type: 'auth', id: user._id, label: email },
    detail: 'Email address confirmed with an emailed code.',
  });

  res.json({
    success: true,
    user: presentUser(user),
    message: 'Your email is verified. Thank you!',
  });
});

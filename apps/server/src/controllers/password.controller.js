import mongoose from 'mongoose';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { User } from '../models/user.model.js';
import { VerificationCode } from '../models/verification-code.model.js';
import { logActivity } from '../services/activity.js';
import { sendEmail } from '../utils/email.js';
import { hashPassword, isValidPassword, PASSWORD_ERROR_MESSAGE, verifyPassword } from '../utils/password.js';
import {
  RESET_CODE_TTL_MINUTES,
  RESET_MAX_ATTEMPTS,
  RESET_RESEND_COOLDOWN_SECONDS,
  generateResetCode,
  hashResetCode,
  normalizeResetCode,
  resetCodeMatches,
} from '../utils/password-reset.js';
import { signSession } from '../utils/tokens.js';

function requireDB(res) {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({ success: false, message: 'Database is not connected. Try again later.' });
    return false;
  }
  return true;
}

const emailField = z.string().trim().toLowerCase().email('Enter a valid email address.');

const forgotSchema = z.object({
  email: emailField,
  // Verified and stripped by verifyCaptcha before this schema runs.
  captchaToken: z.string().min(1).max(4096).optional(),
});

const resetSchema = z.object({
  email: emailField,
  code: z.string().trim().min(1, 'Enter the 6-digit code from your email.'),
  password: z.string().refine(isValidPassword, PASSWORD_ERROR_MESSAGE),
});

const changeSchema = z.object({
  currentPassword: z.string().optional().default(''),
  newPassword: z.string().refine(isValidPassword, PASSWORD_ERROR_MESSAGE),
});

// Same wording whether or not the address exists — the endpoint must never be
// usable to enumerate patient accounts.
const GENERIC_SENT_MESSAGE =
  'If that email belongs to a patient account, we sent a 6-digit code. Check your inbox and spam folder.';

const GENERIC_CODE_ERROR = 'That code is not valid. Request a new one.';

/**
 * POST /api/auth/password/forgot
 *
 * Patients only: staff and admin accounts are reset by an administrator from
 * Staff Accounts, which keeps clinic access under human control.
 */
export const requestPasswordReset = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;

  const parsed = forgotSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: 'Enter a valid email address.' });
  }
  const { email } = parsed.data;

  const user = await User.findOne({ email, role: 'patient' }).select('email passwordHash active').lean();
  // Unknown, deactivated, or staff/admin accounts get the same answer, and no
  // email is sent. Google-only accounts (no password yet) do get a code: the
  // code proves inbox ownership, and resetting sets their first password so
  // they can still log in when Google sign-in is turned off.
  if (!user || !user.active) {
    return res.json({ success: true, message: GENERIC_SENT_MESSAGE, resendAfter: RESET_RESEND_COOLDOWN_SECONDS });
  }

  const recent = await VerificationCode.findOne({ email, purpose: 'password_reset', consumedAt: null })
    .sort({ createdAt: -1 })
    .select('createdAt')
    .lean();
  const cooling =
    recent && Date.now() - new Date(recent.createdAt).getTime() < RESET_RESEND_COOLDOWN_SECONDS * 1000;

  // A repeat click inside the cooldown keeps the current code valid and stays
  // silent, so the response never reveals whether a send actually happened.
  if (!cooling) {
    const code = generateResetCode();
    // Only one live code per address: issuing a new one invalidates the old.
    await VerificationCode.deleteMany({ email, purpose: 'password_reset', consumedAt: null });
    await VerificationCode.create({
      email,
      purpose: 'password_reset',
      codeHash: hashResetCode(code),
      expiresAt: new Date(Date.now() + RESET_CODE_TTL_MINUTES * 60 * 1000),
    });

    const firstPassword = !user.passwordHash;
    await sendEmail(
      email,
      firstPassword ? 'Set a password for your HealthCentria account' : 'HealthCentria password reset code',
      firstPassword
        ? [
            `Your HealthCentria code is ${code}.`,
            '',
            'Your account uses Google sign-in. Enter this code in the app within ' +
              `${RESET_CODE_TTL_MINUTES} minutes to also set a password.`,
            'You can keep using "Continue with Google" either way.',
            "If you didn't ask for this, you can ignore this email — nothing changes.",
            '',
            '— HealthCentria Barangay Health Center',
          ].join('\n')
        : [
            `Your HealthCentria password reset code is ${code}.`,
            '',
            `Enter it in the app within ${RESET_CODE_TTL_MINUTES} minutes.`,
            "If you didn't ask to reset your password, you can ignore this email — your password stays the same.",
            '',
            '— HealthCentria Barangay Health Center',
          ].join('\n'),
    );

    await logActivity({
      req,
      action: 'auth.password_reset_requested',
      actorName: email,
      target: { type: 'auth', label: email },
      detail: firstPassword
        ? 'First-password code sent to a Google sign-in account.'
        : 'Password reset code sent to the account email.',
    });
  }

  res.json({ success: true, message: GENERIC_SENT_MESSAGE, resendAfter: RESET_RESEND_COOLDOWN_SECONDS });
});

/**
 * POST /api/auth/password/reset — consume the code and set the new password.
 *
 * Every existing session is revoked by bumping tokenVersion.
 */
export const resetPassword = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;

  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }
  const { email, password } = parsed.data;
  const code = normalizeResetCode(parsed.data.code);
  if (!code) {
    return res.status(400).json({ success: false, message: 'Enter the 6-digit code from your email.' });
  }

  const user = await User.findOne({ email, role: 'patient' });
  if (!user || !user.active) {
    return res.status(400).json({ success: false, message: GENERIC_CODE_ERROR });
  }

  const record = await VerificationCode.findOne({ email, purpose: 'password_reset', consumedAt: null }).sort({
    createdAt: -1,
  });
  if (!record) {
    return res.status(400).json({ success: false, message: 'That code has expired. Request a new one.' });
  }
  if (record.expiresAt.getTime() <= Date.now()) {
    return res.status(400).json({ success: false, message: 'That code has expired. Request a new one.' });
  }
  if (record.attempts >= RESET_MAX_ATTEMPTS) {
    return res.status(429).json({ success: false, message: 'Too many attempts. Request a new code.' });
  }

  if (!resetCodeMatches(code, record.codeHash)) {
    record.attempts += 1;
    await record.save();
    await logActivity({
      req,
      action: 'auth.password_reset_failed',
      outcome: 'failed',
      actorName: email,
      target: { type: 'auth', label: email },
      detail: 'Wrong password reset code.',
    });
    return res.status(400).json({
      success: false,
      message:
        record.attempts >= RESET_MAX_ATTEMPTS
          ? 'Too many attempts. Request a new code.'
          : `That code is not correct. ${RESET_MAX_ATTEMPTS - record.attempts} attempt(s) left.`,
    });
  }

  user.passwordHash = await hashPassword(password);
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  await user.save();

  record.consumedAt = new Date();
  await record.save();
  await VerificationCode.deleteMany({ email, purpose: 'password_reset', consumedAt: null });

  await logActivity({
    req,
    action: 'auth.password_reset',
    actorId: user._id,
    actorName: user.fullName,
    actorRole: 'patient',
    target: { type: 'auth', id: user._id, label: user.email },
    detail: 'Password reset with an emailed code. All sessions were signed out.',
  });

  res.json({
    success: true,
    message: 'Your password has been reset. Log in with your new password.',
  });
});

/**
 * PUT /api/auth/password — change the password of the signed-in account.
 *
 * Returns a fresh token so the current device stays signed in while every other
 * session is revoked.
 */
export const changePassword = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;

  const parsed = changeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }

  const user = await User.findById(req.user.id);
  if (!user || !user.active) {
    return res.status(401).json({ success: false, message: 'Session is no longer valid. Log in again.' });
  }

  // Google-created accounts have no password yet; their session is the proof.
  if (user.passwordHash) {
    const currentOk = await verifyPassword(parsed.data.currentPassword ?? '', user.passwordHash);
    if (!currentOk) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed.',
        errors: { currentPassword: ['Your current password is not correct.'] },
      });
    }
    if (await verifyPassword(parsed.data.newPassword, user.passwordHash)) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed.',
        errors: { newPassword: ['Choose a password you have not used before.'] },
      });
    }
  }

  user.passwordHash = await hashPassword(parsed.data.newPassword);
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  await user.save();

  await logActivity({
    req,
    action: 'auth.password_change',
    target: { type: 'auth', id: user._id, label: user.email },
    changes: [['password', '', 'changed']],
    detail: 'Password changed from the account menu. Other sessions were signed out.',
  });

  res.json({
    success: true,
    token: signSession(user),
    message: 'Password updated. Other devices have been signed out.',
  });
});

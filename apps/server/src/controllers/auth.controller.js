import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../config/env.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { User } from '../models/user.model.js';
import { isGoogleSignInEnabled } from '../models/app-settings.model.js';
import { buildGoogleAuthUrl, exchangeCodeForTokens, verifyGoogleIdToken } from '../utils/google.js';
import { isGoogleConfigured, resolveGoogleCredentials } from '../utils/google-credentials.js';
import { hashPassword, isValidPassword, PASSWORD_ERROR_MESSAGE, verifyPassword } from '../utils/password.js';
import { presentUser } from '../utils/present-user.js';
import { signSession } from '../utils/tokens.js';
import { logActivity } from '../services/activity.js';
import { issueEmailVerification } from '../services/email-verification.js';

const phoneSchema = z
  .string()
  .trim()
  .min(7, 'Enter a valid contact number.')
  .regex(/^[\d+][\d\s\-()]{6,}$/, 'Enter a valid contact number.');

const registerSchema = z.object({
  fullName: z.string().trim().min(1, 'Full name is required.'),
  birthdate: z
    .string()
    .min(1, 'Birthdate is required.')
    .refine((v) => !Number.isNaN(new Date(`${v}T00:00:00`).getTime()), 'Enter a valid date.')
    .refine((v) => new Date(`${v}T00:00:00`).getTime() <= Date.now(), 'Birthdate cannot be in the future.'),
  sex: z.enum(['Female', 'Male', 'Other', 'Prefer not to say']),
  address: z.string().trim().min(1, 'Address is required.'),
  contactNumber: phoneSchema,
  philHealthNumber: z.string().trim().optional().default(''),
  // Registration collects only what's needed to create an account. Household
  // and emergency details are optional here and are filled in later.
  householdNumber: z.string().trim().optional().default(''),
  emergencyName: z.string().trim().optional().default(''),
  emergencyNumber: z.string().trim().optional().default(''),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().refine(isValidPassword, PASSWORD_ERROR_MESSAGE),
  consent: z.literal(true, { errorMap: () => ({ message: 'Consent is required to register.' }) }),
  // Verified and stripped by verifyCaptcha before this schema runs; listed
  // here so the field is part of the documented request shape.
  // A client with CAPTCHA disabled may send ""; treat it as "no token" instead
  // of failing validation. verifyCaptcha still rejects a missing token whenever
  // CAPTCHA is enabled.
  captchaToken: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().min(1).max(4096).optional(),
  ),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
  // A client with CAPTCHA disabled may send ""; treat it as "no token" instead
  // of failing validation. verifyCaptcha still rejects a missing token whenever
  // CAPTCHA is enabled.
  captchaToken: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().min(1).max(4096).optional(),
  ),
});

/** Only a well-formed email reaches the log — never arbitrary typed text. */
function attemptedEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase().slice(0, 200) : '';
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : '';
}

function requireDB(res) {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({ success: false, message: 'Database is not connected. Try again later.' });
    return false;
  }
  return true;
}

export const register = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed.',
      errors: parsed.error.flatten().fieldErrors,
    });
  }
  const data = parsed.data;

  const existing = await User.findOne({ email: data.email }).lean();
  if (existing) {
    return res.status(409).json({ success: false, message: 'Email is already registered.' });
  }

  // Public registration always creates a patient — role comes from the server, never the client.
  const user = await User.create({
    email: data.email,
    passwordHash: await hashPassword(data.password),
    role: 'patient',
    // New self-registered patients confirm their address with a code emailed
    // after the account exists (see services/email-verification.js). Access is
    // not blocked in the meantime.
    emailVerified: false,
    fullName: data.fullName,
    profileComplete: true,
    birthdate: new Date(`${data.birthdate}T00:00:00`),
    sex: data.sex,
    address: data.address,
    householdNumber: data.householdNumber,
    contactNumber: data.contactNumber,
    philHealthNumber: data.philHealthNumber ?? '',
    emergencyName: data.emergencyName,
    emergencyNumber: data.emergencyNumber,
  });

  await logActivity({
    req,
    action: 'auth.register',
    actorId: user._id,
    actorName: user.fullName,
    actorRole: 'patient',
    target: { type: 'patient', id: user._id, label: user.fullName },
    detail: 'Self-registered patient account.',
  });

  // Best-effort: a mail outage must never fail a registration that already
  // succeeded. The reminder banner lets the patient request a new code.
  try {
    await issueEmailVerification(user);
  } catch (error) {
    console.error(
      'Verification email could not be sent at registration:',
      error instanceof Error ? error.message : 'unknown error',
    );
  }

  res.status(201).json({ success: true, token: signSession(user), user: presentUser(user) });
});

export const login = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    const email = attemptedEmail(req.body?.email);
    if (email) {
      await logActivity({
        req,
        action: 'auth.login_failed',
        outcome: 'failed',
        actorName: email,
        target: { type: 'auth', label: email },
        detail: 'Malformed sign-in request.',
      });
    }
    // Generic message on purpose — do not reveal whether the email exists.
    return res.status(401).json({ success: false, message: 'Invalid email or password.' });
  }
  const { email, password } = parsed.data;

  const user = await User.findOne({ email });
  if (!user || !user.active) {
    await logActivity({
      req,
      action: 'auth.login_failed',
      outcome: 'failed',
      actorName: email,
      target: { type: 'auth', label: email },
      detail: user ? 'Account is deactivated.' : 'No account with this email.',
    });
    return res.status(401).json({ success: false, message: 'Invalid email or password.' });
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    await logActivity({
      req,
      action: 'auth.login_failed',
      outcome: 'failed',
      actorName: email,
      target: { type: 'auth', label: email },
      detail: 'Wrong password.',
    });
    return res.status(401).json({ success: false, message: 'Invalid email or password.' });
  }

  await logActivity({
    req,
    action: 'auth.login',
    actorId: user._id,
    actorName: user.fullName,
    actorRole: user.role,
    target: { type: 'auth', id: user._id, label: user.email },
    detail: `${user.role} signed in.`,
  });

  res.json({ success: true, token: signSession(user), user: presentUser(user) });
});

/**
 * POST /api/auth/logout — records the sign-out.
 *
 * Sessions are stateless JWTs, so the server cannot revoke the token; the
 * client discards it. The entry is still the point: the log shows the end of
 * the session even though no server state changes.
 */
export const logout = asyncHandler(async (req, res) => {
  await logActivity({
    req,
    action: 'auth.logout',
    target: { type: 'auth', id: req.user.id },
    detail: 'Signed out.',
  });
  res.json({ success: true });
});

/** GET /api/auth/me — resolve the signed-in user from a Bearer token. */
export const me = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const user = await User.findById(req.user.id).lean();
  if (!user || !user.active) {
    return res.status(401).json({ success: false, message: 'Session is no longer valid. Log in again.' });
  }
  res.json({ success: true, user: presentUser(user) });
});

const updateMeSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(1, 'Full name is required.')
      .max(120, 'Name is too long.')
      .optional(),
    // An empty string clears the number; anything else must look like a phone.
    contactNumber: z
      .string()
      .trim()
      .refine(
        (value) => value === '' || /^[\d+][\d\s\-()]{6,}$/.test(value),
        'Enter a valid contact number.',
      )
      .optional(),
  })
  .refine((data) => data.fullName !== undefined || data.contactNumber !== undefined, {
    message: 'No changes provided.',
  });

/**
 * PATCH /api/auth/me — let staff and admin edit their own display name and
 * contact number.
 *
 * Role, permissions, email and active state remain admin-managed in Staff
 * Accounts; this endpoint accepts only what an account may safely change about
 * itself, so a staff account can never escalate its own access.
 */
export const updateMe = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  if (req.user.role === 'patient') {
    return res
      .status(403)
      .json({ success: false, message: 'Use the patient profile page to update your details.' });
  }
  const parsed = updateMeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res
      .status(400)
      .json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }
  const user = await User.findById(req.user.id);
  if (!user || !user.active) {
    return res.status(401).json({ success: false, message: 'Session is no longer valid. Log in again.' });
  }

  const changes = [];
  if (parsed.data.fullName !== undefined && parsed.data.fullName !== user.fullName) {
    changes.push(['fullName', user.fullName, parsed.data.fullName]);
    user.fullName = parsed.data.fullName;
  }
  if (parsed.data.contactNumber !== undefined && parsed.data.contactNumber !== user.contactNumber) {
    changes.push(['contactNumber', user.contactNumber ?? '', parsed.data.contactNumber]);
    user.contactNumber = parsed.data.contactNumber;
  }
  if (changes.length === 0) {
    return res.json({ success: true, user: presentUser(user) });
  }

  await user.save();
  await logActivity({
    req,
    action: 'profile.update',
    target: { type: 'staff', id: user._id, label: user.fullName, role: user.role },
    changes,
    detail: `Updated their own profile: ${changes.map(([field]) => field).join(', ')}.`,
  });
  res.json({ success: true, user: presentUser(user) });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  newPassword: z.string().refine(isValidPassword, PASSWORD_ERROR_MESSAGE),
});

/** POST /api/auth/change-password — self-service password change for every role. */
export const changePassword = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const parsed = changePasswordSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res
      .status(400)
      .json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }
  const user = await User.findById(req.user.id);
  if (!user || !user.active) {
    return res.status(401).json({ success: false, message: 'Session is no longer valid. Log in again.' });
  }
  if (!user.passwordHash) {
    return res.status(400).json({
      success: false,
      message: 'This account signs in with Google. Ask an admin to set a password for it.',
    });
  }
  const currentOk = await verifyPassword(parsed.data.currentPassword, user.passwordHash);
  if (!currentOk) {
    return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
  }
  const sameAsCurrent = await verifyPassword(parsed.data.newPassword, user.passwordHash);
  if (sameAsCurrent) {
    return res.status(400).json({ success: false, message: 'Choose a password different from your current one.' });
  }
  user.passwordHash = await hashPassword(parsed.data.newPassword);
  await user.save();
  await logActivity({
    req,
    action: 'auth.password_change',
    target: {
      type: user.role === 'patient' ? 'patient' : 'staff',
      id: user._id,
      label: user.fullName,
      role: user.role,
    },
    detail: 'Changed their own password.',
  });
  res.json({ success: true });
});

/** Redirect back to the SPA with either a session token or an error code. */
function redirectToApp(res, params) {
  const url = new URL('/auth/callback', env.CLIENT_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  res.redirect(url.toString());
}

/**
 * GET /api/auth/google/config — public config for the login button. Only the
 * client ID is public by design; the secret never leaves the server.
 */
export const googleConfig = asyncHandler(async (req, res) => {
  const credentials = await resolveGoogleCredentials();
  res.set('Cache-Control', 'no-store');
  // An empty client ID tells the login page that the full pair is unavailable.
  res.json({ success: true, clientId: isGoogleConfigured(credentials) ? credentials.clientId : '' });
});

/** GET /api/auth/google — kick off the consent flow. */
export const googleStart = asyncHandler(async (req, res) => {
  // Resolved per request so admin changes apply without a restart.
  const credentials = await resolveGoogleCredentials();
  if (!isGoogleConfigured(credentials)) {
    return res.status(503).json({ success: false, message: 'Google sign-in is not configured.' });
  }
  // The login button sends the client ID it fetched from /config. If the active
  // credentials changed in the meantime, ask the page to refresh instead of
  // starting a flow with a mismatched client/secret pair.
  const requestedClientId = typeof req.query.client_id === 'string' ? req.query.client_id : '';
  if (requestedClientId && requestedClientId !== credentials.clientId) {
    return redirectToApp(res, { error: 'google_config_changed' });
  }
  // Admins can switch Google sign-in off from Settings. Redirect back with an
  // error code instead of sending the user through Google's consent screen.
  if (!(await isGoogleSignInEnabled())) {
    return redirectToApp(res, { error: 'google_disabled' });
  }
  // Signed, short-lived state guards the callback against CSRF.
  const state = jwt.sign({ purpose: 'google_oauth_state' }, env.JWT_SECRET, { expiresIn: '10m' });
  res.redirect(buildGoogleAuthUrl({ state, credentials }));
});

/** GET /api/auth/google/callback — Google redirects here with `code` + `state`. */
export const googleCallback = asyncHandler(async (req, res) => {
  // Resolved again at callback time: never assume the credentials used at start.
  const credentials = await resolveGoogleCredentials();
  if (!isGoogleConfigured(credentials)) return redirectToApp(res, { error: 'google_not_configured' });
  // Re-checked here too: a flow started before the admin flipped the switch
  // must not complete afterwards.
  if (!(await isGoogleSignInEnabled())) return redirectToApp(res, { error: 'google_disabled' });

  const { code, state, error } = req.query;
  if (error) return redirectToApp(res, { error: 'google_denied' });
  if (typeof code !== 'string' || typeof state !== 'string') {
    return redirectToApp(res, { error: 'google_invalid_request' });
  }

  try {
    jwt.verify(state, env.JWT_SECRET);
  } catch {
    return redirectToApp(res, { error: 'google_invalid_state' });
  }

  if (mongoose.connection.readyState !== 1) return redirectToApp(res, { error: 'db_unavailable' });

  let profile;
  try {
    const tokens = await exchangeCodeForTokens(code, credentials);
    // The ID token is the signed identity assertion. Verify its signature,
    // issuer, audience and expiry before trusting any profile data.
    profile = await verifyGoogleIdToken(tokens.id_token, credentials.clientId);
  } catch (err) {
    console.error('Google OAuth failed:', err instanceof Error ? err.message : 'unknown error');
    return redirectToApp(res, { error: 'google_exchange_failed' });
  }

  const email = typeof profile.email === 'string' ? profile.email.toLowerCase() : '';
  const googleId = typeof profile.sub === 'string' ? profile.sub : '';
  if (!email || !googleId || profile.email_verified !== true) {
    return redirectToApp(res, { error: 'google_email_unverified' });
  }

  const [byGoogleId, byEmail] = await Promise.all([
    User.findOne({ googleId }),
    User.findOne({ email }),
  ]);
  if (byGoogleId && byEmail && !byGoogleId._id.equals(byEmail._id)) {
    return redirectToApp(res, { error: 'google_account_mismatch' });
  }
  let user = byGoogleId || byEmail;
  if (user) {
    if (!user.active) return redirectToApp(res, { error: 'account_disabled' });
    // Do not let a different Google identity take over an existing account.
    if (user.googleId && user.googleId !== googleId) {
      return redirectToApp(res, { error: 'google_account_mismatch' });
    }

    // Link Google to an existing local account the first time it's used.
    // The existing role is never changed.
    let changed = false;
    if (!user.googleId) {
      user.googleId = googleId;
      if (!user.passwordHash) user.provider = 'google';
      changed = true;
    }
    if (!user.avatarUrl && typeof profile.picture === 'string' && profile.picture) {
      user.avatarUrl = profile.picture;
      changed = true;
    }
    if (changed) await user.save();
  } else {
    // A brand-new Google identity is always a patient. Role is hardcoded here,
    // never taken from the request or Google profile.
    user = await User.create({
      email,
      fullName: typeof profile.name === 'string' && profile.name ? profile.name : email.split('@')[0],
      avatarUrl: typeof profile.picture === 'string' ? profile.picture : '',
      googleId,
      provider: 'google',
      role: 'patient',
      profileComplete: false,
    });
  }

  return redirectToApp(res, { token: signSession(user) });
});

import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../config/env.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { User } from '../models/user.model.js';
import { isGoogleSignInEnabled } from '../models/app-settings.model.js';
import { buildGoogleAuthUrl, exchangeCodeForTokens, verifyGoogleIdToken } from '../utils/google.js';
import { isGoogleConfigured, resolveGoogleCredentials } from '../utils/google-credentials.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { presentUser } from '../utils/present-user.js';
import { signSession } from '../utils/tokens.js';

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
  password: z.string().min(8, 'Password must be at least 8 characters.'),
  consent: z.literal(true, { errorMap: () => ({ message: 'Consent is required to register.' }) }),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

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

  res.status(201).json({ success: true, token: signSession(user), user: presentUser(user) });
});

export const login = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    // Generic message on purpose — do not reveal whether the email exists.
    return res.status(401).json({ success: false, message: 'Invalid email or password.' });
  }
  const { email, password } = parsed.data;

  const user = await User.findOne({ email });
  if (!user || !user.active) {
    return res.status(401).json({ success: false, message: 'Invalid email or password.' });
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ success: false, message: 'Invalid email or password.' });
  }

  res.json({ success: true, token: signSession(user), user: presentUser(user) });
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

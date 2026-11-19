import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { verifySession } from '../utils/tokens.js';

/**
 * Rate limits for the public auth endpoints.
 *
 * CAPTCHA slows bots down but does not cap the number of requests, so these
 * limiters cap how often a client can hit each endpoint. Sign-in failures are
 * counted per account (normalized email) so patients sharing one clinic Wi-Fi
 * cannot lock each other out; a looser IP cap stays in place to stop one host
 * from spraying many accounts. Only failed sign-ins are counted
 * (`skipSuccessfulRequests`).
 *
 * Behind a reverse proxy set TRUST_PROXY in the server env; otherwise every
 * request appears to come from the proxy's IP.
 */

function limitResponse(message) {
  return { success: false, code: 'RATE_LIMITED', message };
}

/**
 * Normalizes the submitted email so casing and stray spaces cannot split the
 * counter. Bounded to the RFC 5321 maximum so a hostile body cannot store an
 * oversized key.
 */
function loginAccountKey(req) {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  return email.slice(0, 254) || 'unknown-account';
}

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  keyGenerator: loginAccountKey,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: limitResponse('Too many sign-in attempts for this account. Try again in 15 minutes.'),
  // The Vite dev proxy (and most PaaS proxies) add X-Forwarded-For even when
  // Express is not configured to trust it. Suppress that warning; TRUST_PROXY
  // is the documented switch for real deployments.
  validate: { xForwardedForHeader: false },
});

// Credential stuffing tries one password across many accounts, which an
// account-keyed limit never sees. This looser cap only exists to stop a single
// host from spraying the whole site.
export const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 50,
  skipSuccessfulRequests: true,
  standardHeaders: false,
  legacyHeaders: false,
  message: limitResponse('Too many sign-in attempts. Try again in 15 minutes.'),
  validate: { xForwardedForHeader: false },
});

// Covers both the "email me a code" and "submit the code" steps. Successful
// requests count too: every send is an outgoing email.
export const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: limitResponse('Too many password reset attempts. Try again in 15 minutes.'),
  validate: { xForwardedForHeader: false },
});

export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: limitResponse('Too many registration attempts. Try again later.'),
  validate: { xForwardedForHeader: false },
});

// Verification codes are only sent to the signed-in account's own address, so
// this is a guard against hammering the mail provider, not a public endpoint.
export const emailVerificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: limitResponse('Too many verification attempts. Try again in 15 minutes.'),
  validate: { xForwardedForHeader: false },
});

/** Caps attempts to guess a signed-in account's current password. */
export const passwordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: limitResponse('Too many password attempts. Try again in 15 minutes.'),
  validate: { xForwardedForHeader: false },
});

/**
 * Caps assistant messages per signed-in account (not per IP, so a shared clinic
 * connection is not throttled together). Each message is a paid model call.
 */
export const assistantLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.id ?? 'anon'),
  message: limitResponse('You have sent a lot of messages. Please wait a few minutes and try again.'),
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
});

/**
 * Signed-in people are counted by account so a shared clinic connection is not
 * throttled together. Anyone else falls back to their IP address.
 * `ipKeyGenerator` folds IPv6 addresses into one /56 range, so an attacker
 * cannot dodge the limit by rotating through addresses in their own block.
 */
function userOrIpKey(req) {
  if (req.user?.id) return `user:${req.user.id}`;
  return `ip:${ipKeyGenerator(req.ip ?? '')}`;
}

/**
 * Same idea for limiters that run BEFORE requireAuth: the account is read from
 * the signed token (no database call). A bad or missing token is counted by IP.
 */
function tokenOrIpKey(req) {
  const [scheme, token] = (req.headers.authorization ?? '').split(' ');
  if (scheme === 'Bearer' && token) {
    try {
      const payload = verifySession(token);
      if (payload?.sub) return `user:${payload.sub}`;
    } catch {
      // Invalid or expired token: counted by IP below.
    }
  }
  return `ip:${ipKeyGenerator(req.ip ?? '')}`;
}

/**
 * Catch-all for the whole API (refresh spam, scripts, any route without its own
 * limit). Normal use stays far below it: a page load is a handful of requests,
 * and the live-update socket means pages do not poll. Health checks and CORS
 * preflights are skipped so uptime monitors are never blocked.
 */
export const apiLimiter = rateLimit({
  windowMs: 60000,
  limit: 150,
  keyGenerator: tokenOrIpKey,
  skip: (req) => req.method === 'OPTIONS' || req.path === '/health',
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: limitResponse('Too many requests. Please wait a minute and try again.'),
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
});

/** Report exports (PDF, CSV, Google Sheets) are heavy to build. */
export const reportExportLimiter = rateLimit({
  windowMs: 600000,
  limit: 5,
  keyGenerator: userOrIpKey,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: limitResponse('Too many report exports. Please wait a few minutes and try again.'),
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
});

/**
 * Backup downloads and backup exports copy patient data out of the system.
 * Mount this AFTER the superadmin PIN check so only approved exports count.
 */
export const backupExportLimiter = rateLimit({
  windowMs: 3600000,
  limit: 3,
  keyGenerator: userOrIpKey,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: limitResponse('Too many backup exports. Please wait up to an hour and try again.'),
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
});

/** Activity-log exports (CSV, PDF, Google Sheets). Admin only. */
export const activityExportLimiter = rateLimit({
  windowMs: 3600000,
  limit: 3,
  keyGenerator: userOrIpKey,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: limitResponse('Too many activity log exports. Please wait up to an hour and try again.'),
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
});

/** A patient mashing "Book" should not fill the schedule with requests. */
export const bookingLimiter = rateLimit({
  windowMs: 600000,
  limit: 10,
  keyGenerator: userOrIpKey,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: limitResponse('You have sent many booking requests. Please wait a few minutes and try again.'),
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
});

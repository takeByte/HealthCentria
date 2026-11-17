import rateLimit from 'express-rate-limit';

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

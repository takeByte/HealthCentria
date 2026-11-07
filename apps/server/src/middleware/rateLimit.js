import rateLimit from 'express-rate-limit';

/**
 * Rate limits for the public auth endpoints.
 *
 * CAPTCHA slows bots down but does not cap the number of requests, so these
 * limiters cap how often one IP can hit each endpoint. Keys are only counted
 * for failed sign-ins (`skipSuccessfulRequests`) so several patients sharing
 * one clinic Wi-Fi do not lock each other out.
 *
 * Behind a reverse proxy set TRUST_PROXY in the server env; otherwise every
 * request appears to come from the proxy's IP.
 */

function limitResponse(message) {
  return { success: false, code: 'RATE_LIMITED', message };
}

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: limitResponse('Too many sign-in attempts. Try again in 15 minutes.'),
  // The Vite dev proxy (and most PaaS proxies) add X-Forwarded-For even when
  // Express is not configured to trust it. Suppress that warning; TRUST_PROXY
  // is the documented switch for real deployments.
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

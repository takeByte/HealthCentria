import { env } from '../config/env.js';
import { isRecaptchaEnabled } from '../models/app-settings.model.js';
import { logActivity } from '../services/activity.js';

const VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';
// Google tokens are long but bounded. Anything larger is not a real token.
const MAX_TOKEN_CHARS = 4096;
const VERIFY_TIMEOUT_MS = 5000;

/** Only a well-formed email reaches the log — never arbitrary typed text. */
function attemptedEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase().slice(0, 200) : '';
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : '';
}

/** Which auth step the challenge belongs to — used only for the log detail. */
function attemptKind(req) {
  const path = String(req.path ?? '').toLowerCase();
  if (path.includes('register')) return 'registration';
  if (path.includes('password')) return 'password reset';
  return 'sign-in';
}

/**
 * Records a failed challenge without ever storing the token. Never throws:
 * the request still gets its 4xx/5xx response even if the log write fails.
 */
async function recordFailure(req, detail) {
  const email = attemptedEmail(req.body?.email);
  await logActivity({
    req,
    action: 'auth.login_failed',
    outcome: 'failed',
    actorName: email,
    target: { type: 'auth', label: email },
    detail,
  });
}

/**
 * Server-side reCAPTCHA v2 check.
 *
 * The browser widget alone proves nothing — a bot can call the API directly —
 * so the token is verified with Google before any controller or database work
 * runs. A token is single-use, so every rejection leaves the client to reset
 * the widget.
 */
export async function verifyCaptcha(req, res, next) {
  if (!(await isRecaptchaEnabled())) return next();

  const secret = env.RECAPTCHA_SECRET_KEY;

  if (!secret) {
    if (env.NODE_ENV === 'production') {
      // Fail closed: never accept an unverified login just because the server
      // lost its configuration.
      console.error('RECAPTCHA_SECRET_KEY is not set — refusing auth requests in production.');
      return res.status(503).json({
        success: false,
        code: 'CAPTCHA_NOT_CONFIGURED',
        message: 'CAPTCHA is not configured. Try again later.',
      });
    }
    // Local development works without keys; production is guarded above.
    return next();
  }

  const raw = req.body?.captchaToken;
  const token = typeof raw === 'string' ? raw.trim() : '';
  if (!token || token.length > MAX_TOKEN_CHARS) {
    await recordFailure(req, `CAPTCHA missing during ${attemptKind(req)}.`);
    return res.status(400).json({
      success: false,
      code: 'CAPTCHA_REQUIRED',
      message: 'Please complete the CAPTCHA.',
    });
  }

  let data;
  try {
    const params = new URLSearchParams({ secret, response: token });
    const ip = req.ctx?.ip || req.ip;
    if (ip) params.set('remoteip', ip);

    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`siteverify responded ${response.status}`);
    data = await response.json();
  } catch (err) {
    // Fail closed: an unreachable verifier must not become an open door.
    console.error('CAPTCHA verification error:', err instanceof Error ? err.message : 'unknown error');
    return res.status(503).json({
      success: false,
      code: 'CAPTCHA_UNAVAILABLE',
      message: 'CAPTCHA service unavailable. Try again.',
    });
  }

  if (data?.success !== true) {
    const codes = Array.isArray(data?.['error-codes']) ? data['error-codes'].join(', ') : 'unknown';
    console.warn('CAPTCHA rejected:', codes);
    await recordFailure(req, `CAPTCHA failed during ${attemptKind(req)}.`);
    return res.status(400).json({
      success: false,
      code: 'CAPTCHA_FAILED',
      message: 'CAPTCHA verification failed. Please try again.',
    });
  }

  next();
}

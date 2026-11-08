import { createHash, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { User } from '../models/user.model.js';
import { logActivity } from '../services/activity.js';
import { sendEmail } from '../utils/email.js';

/**
 * Superadmin PIN gate for integration settings.
 *
 * Every request that saves, resets or switches an integration must carry the
 * PIN from SU_PIN in .env in the `X-Super-Pin` header (a header, not the body,
 * so DELETE requests work too). The server does the check; the browser modal is
 * only the input. After a successful change, SU_EMAIL gets a notice with what
 * changed, who changed it and when. Never the PIN or any secret.
 *
 * Wrong PINs are counted per admin account + IP. Five wrong tries lock that
 * pair out for 10 minutes. Counters live in memory, so a server restart clears
 * them; that's acceptable for a single API process.
 */

const MAX_ATTEMPTS = 5;
const LOCK_MS = 10 * 60 * 1000;
const PIN_HEADER = 'x-super-pin';

/** key -> { failures, lockedUntil } */
const attempts = new Map();

function attemptKey(req) {
  return `${req.user?.id ?? 'anon'}|${req.ctx?.ip ?? req.ip ?? ''}`;
}

function digest(value) {
  return createHash('sha256').update(String(value), 'utf8').digest();
}

/** Constant-time compare. Hashing first makes both sides equal length. */
function pinMatches(given, expected) {
  return timingSafeEqual(digest(given), digest(expected));
}

function minutesLeft(until) {
  return Math.max(1, Math.ceil((until - Date.now()) / 60000));
}

function formatWhen(date) {
  return date.toLocaleString('en-PH', {
    timeZone: env.GOOGLE_CALENDAR_TIMEZONE || 'Asia/Manila',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

async function sendChangeNotice(req, label) {
  const to = String(env.SU_EMAIL ?? '').trim();
  if (!to) return;
  const actor = await User.findById(req.user?.id).select('fullName email').lean().catch(() => null);
  const who = actor ? `${actor.fullName || 'Admin'} <${actor.email}>` : 'An admin account';
  const when = formatWhen(new Date());
  const text = [
    'An integration setting was changed in E-Kalinga.',
    '',
    `What: ${label}`,
    `Who: ${who}`,
    `When: ${when}`,
    `From IP: ${req.ctx?.ip ?? 'unknown'}`,
    '',
    'The superadmin PIN was used to approve this change.',
    'If you did not expect it, sign in and review Settings and the Activity log, then change SU_PIN in the server .env.',
  ].join('\n');
  // Sent directly, not through notifyEmail: this is a security notice and must
  // go out even while notification emails are switched off. Best effort, so a
  // broken SMTP setup never undoes the saved change.
  await sendEmail(to, `E-Kalinga: ${label} changed`, text);
}

/**
 * @param {string | ((req) => string)} label What is being changed, for the
 *   Activity log and the SU_EMAIL notice (e.g. "Google sign-in credentials").
 */
export function requireSuperPin(label) {
  return async (req, res, next) => {
    const what = typeof label === 'function' ? label(req) : label;
    const expected = String(env.SU_PIN ?? '').trim();
    if (!expected) {
      return res.status(503).json({
        success: false,
        code: 'SU_PIN_NOT_SET',
        message: 'Integration changes are locked: SU_PIN is not set in the server .env.',
      });
    }

    const key = attemptKey(req);
    const entry = attempts.get(key);
    if (entry?.lockedUntil && entry.lockedUntil > Date.now()) {
      return res.status(429).json({
        success: false,
        code: 'PIN_LOCKED',
        message: `Too many incorrect PINs. Try again in ${minutesLeft(entry.lockedUntil)} minute(s).`,
      });
    }

    const given = String(req.get(PIN_HEADER) ?? '').trim();
    if (!given || !pinMatches(given, expected)) {
      const failures = (entry && !entry.lockedUntil ? entry.failures : 0) + 1;
      const locked = failures >= MAX_ATTEMPTS;
      attempts.set(key, { failures, lockedUntil: locked ? Date.now() + LOCK_MS : 0 });
      await logActivity({
        req,
        action: 'settings.pin_failed',
        outcome: 'failed',
        target: { type: 'settings', id: 'superadmin-pin', label: what },
        detail: locked
          ? `Incorrect superadmin PIN (${failures} tries). Locked for 10 minutes.`
          : `Incorrect superadmin PIN (${failures} of ${MAX_ATTEMPTS} tries).`,
      });
      if (locked) {
        return res.status(429).json({
          success: false,
          code: 'PIN_LOCKED',
          message: 'Too many incorrect PINs. Try again in 10 minutes.',
        });
      }
      const left = MAX_ATTEMPTS - failures;
      return res.status(403).json({
        success: false,
        code: 'PIN_INCORRECT',
        message: `Incorrect superadmin PIN. ${left} ${left === 1 ? 'try' : 'tries'} left before a 10-minute lock.`,
        attemptsLeft: left,
      });
    }

    attempts.delete(key);
    // Notify only when the change actually went through.
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        sendChangeNotice(req, what).catch((err) => {
          console.error('Superadmin change notice failed:', err instanceof Error ? err.message : 'unknown error');
        });
      }
    });
    return next();
  };
}

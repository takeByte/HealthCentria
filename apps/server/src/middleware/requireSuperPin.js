import { createHash, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { User } from '../models/user.model.js';
import { logActivity } from '../services/activity.js';
import { sendEmail } from '../utils/email.js';
import {
  APPROVAL_TTL_MS,
  approvalFingerprint,
  canCreateApproval,
  createApproval,
  discardApproval,
  findApprovedFor,
  getOwnedApproval,
  markUsed,
} from '../services/su-approval.js';

/**
 * Superadmin gate for integration settings: PIN, then email confirmation.
 *
 * Layer 1 - PIN. Every request that saves, resets or switches an integration
 * must carry the PIN from SU_PIN in .env in the `X-Super-Pin` header (a header,
 * not the body, so DELETE requests work too). The server does the check; the
 * browser modal is only the input.
 *
 * Layer 2 - email. A correct PIN does not change anything yet. The server emails
 * SU_EMAIL a single-use link (valid 5 minutes) and answers 428 APPROVAL_REQUIRED
 * with an approval id. The browser waits, and once the superadmin confirms from
 * the link it replays the same request with `X-Approval-Id` (no PIN is kept in
 * the browser). Deny or let it expire and nothing is changed. If the change then
 * fails validation, the approval stays usable for the same action until it
 * expires, so a typo does not cost a second email. SU_EMAIL_APPROVAL=off turns
 * this layer off (recovery switch if mail delivery itself is broken).
 *
 * After a successful change, SU_EMAIL gets a notice with what changed, who
 * changed it and when. Never the PIN or any secret.
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

function emailApprovalOn() {
  return String(env.SU_EMAIL_APPROVAL ?? '').trim().toLowerCase() !== 'off';
}

/** a***@gmail.com: enough for the admin to recognise the inbox to check. */
function maskEmail(address) {
  const [name = '', domain = ''] = String(address).split('@');
  return `${name.slice(0, 1)}***@${domain}`;
}

async function describeActor(req) {
  const actor = await User.findById(req.user?.id).select('fullName email').lean().catch(() => null);
  return actor ? `${actor.fullName || 'Admin'} <${actor.email}>` : 'An admin account';
}

/** Asks the superadmin to approve; resolves true only when the email was handed off. */
async function sendApprovalRequest(req, label, who, token) {
  const to = String(env.SU_EMAIL ?? '').trim();
  const base = String(env.CLIENT_URL).replace(/\/+$/, '');
  const text = [
    'An admin entered the superadmin PIN and is waiting for your confirmation in HealthCentria.',
    '',
    `What: ${label}`,
    `Who: ${who}`,
    `When: ${formatWhen(new Date())}`,
    `From IP: ${req.ctx?.ip ?? 'unknown'}`,
    '',
    'Review it and press Confirm or Deny:',
    `${base}/approve/${token}`,
    '',
    `The link works once and expires in ${APPROVAL_TTL_MS / 60000} minutes. Nothing changes until you confirm.`,
    'If this was not you or you did not expect it, press Deny and change SU_PIN in the server .env.',
  ].join('\n');
  // Direct send, same reasoning as the change notice: it must go out even while
  // notification emails are switched off.
  const result = await sendEmail(to, `HealthCentria: confirm "${label}"`, text);
  return Boolean(result?.sent);
}

async function sendChangeNotice(req, label) {
  const to = String(env.SU_EMAIL ?? '').trim();
  if (!to) return;
  const who = await describeActor(req);
  const when = formatWhen(new Date());
  const text = [
    'An integration setting was changed in HealthCentria.',
    '',
    `What: ${label}`,
    `Who: ${who}`,
    `When: ${when}`,
    `From IP: ${req.ctx?.ip ?? 'unknown'}`,
    '',
    emailApprovalOn()
      ? 'The superadmin PIN and your email confirmation were used to approve this change.'
      : 'The superadmin PIN was used to approve this change.',
    'If you did not expect it, sign in and review Settings and the Activity log, then change SU_PIN in the server .env.',
  ].join('\n');
  // Sent directly, not through notifyEmail: this is a security notice and must
  // go out even while notification emails are switched off. Best effort, so a
  // broken SMTP setup never undoes the saved change.
  await sendEmail(to, `HealthCentria: ${label} changed`, text);
}


const APPROVAL_HEADER = 'x-approval-id';

/**
 * Layer 1. Sends the response itself and returns false when the PIN is missing,
 * wrong or the pair is locked out; returns true when the PIN is correct.
 */
async function pinAccepted(req, res, what, expected) {
  const key = attemptKey(req);
  const entry = attempts.get(key);
  if (entry?.lockedUntil && entry.lockedUntil > Date.now()) {
    res.status(429).json({
      success: false,
      code: 'PIN_LOCKED',
      message: `Too many incorrect PINs. Try again in ${minutesLeft(entry.lockedUntil)} minute(s).`,
    });
    return false;
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
      res.status(429).json({
        success: false,
        code: 'PIN_LOCKED',
        message: 'Too many incorrect PINs. Try again in 10 minutes.',
      });
      return false;
    }
    const left = MAX_ATTEMPTS - failures;
    res.status(403).json({
      success: false,
      code: 'PIN_INCORRECT',
      message: `Incorrect superadmin PIN. ${left} ${left === 1 ? 'try' : 'tries'} left before a 10-minute lock.`,
      attemptsLeft: left,
    });
    return false;
  }

  attempts.delete(key);
  return true;
}

/**
 * Layer 2, step 1: PIN is correct and no approval exists yet. Email the link and
 * tell the browser to wait. Responds in every case; the change is never applied here.
 */
async function requestApproval(req, res, what, fingerprint) {
  const to = String(env.SU_EMAIL ?? '').trim();
  if (!to) {
    return res.status(503).json({
      success: false,
      code: 'SU_EMAIL_NOT_SET',
      message:
        'Integration changes need email confirmation, but SU_EMAIL is not set in the server .env. Set it and restart the server.',
    });
  }
  const userId = String(req.user?.id ?? '');
  if (!canCreateApproval(userId)) {
    return res.status(429).json({
      success: false,
      code: 'APPROVAL_LIMIT',
      message: 'Too many confirmation emails are still waiting. Confirm, deny or wait for them to expire, then try again.',
    });
  }

  const who = await describeActor(req);
  const approval = createApproval({ userId, fingerprint, label: what, requestedBy: who, ip: req.ctx?.ip });
  const sent = await sendApprovalRequest(req, what, who, approval.token);
  if (!sent) {
    discardApproval(approval.id);
    return res.status(502).json({
      success: false,
      code: 'APPROVAL_EMAIL_FAILED',
      message:
        'The PIN is correct, but the confirmation email could not be sent. Check the email delivery settings and try again.',
    });
  }

  await logActivity({
    req,
    action: 'settings.approval_requested',
    target: { type: 'settings', id: 'superadmin-approval', label: what },
    detail: 'Superadmin PIN accepted. Waiting for email confirmation.',
  });
  return res.status(428).json({
    success: false,
    code: 'APPROVAL_REQUIRED',
    message: 'Confirmation email sent to the superadmin.',
    approvalId: approval.id,
    expiresAt: approval.expiresAt,
    sentTo: maskEmail(to),
  });
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

    const emailOn = emailApprovalOn();
    const approvalId = emailOn ? String(req.get(APPROVAL_HEADER) ?? '').trim() : '';
    const fingerprint = approvalFingerprint(req);
    /** The approval this request spends, once the superadmin confirmed it. */
    let approval = null;

    if (approvalId) {
      // Replay after the superadmin confirmed. The PIN was checked when this
      // approval was requested, so the browser does not keep or resend it.
      const owned = getOwnedApproval(approvalId, req.user?.id);
      if (!owned || owned.record.fingerprint !== fingerprint) {
        return res.status(410).json({
          success: false,
          code: 'APPROVAL_EXPIRED',
          message: 'That confirmation is no longer valid. Start the change again.',
        });
      }
      if (owned.status === 'pending') {
        return res.status(409).json({
          success: false,
          code: 'APPROVAL_PENDING',
          message: 'Still waiting for the superadmin to confirm by email.',
        });
      }
      if (owned.status === 'denied') {
        return res.status(403).json({
          success: false,
          code: 'APPROVAL_DENIED',
          message: 'The superadmin denied this change.',
        });
      }
      if (owned.status !== 'approved') {
        return res.status(410).json({
          success: false,
          code: 'APPROVAL_EXPIRED',
          message: 'That confirmation expired or was already used. Start the change again.',
        });
      }
      approval = owned.record;
    } else {
      if (!(await pinAccepted(req, res, what, expected))) return undefined;
      if (emailOn) {
        // A change that was approved but then failed validation can be retried
        // inside the same window without another email.
        approval = findApprovedFor(req.user?.id, fingerprint);
        if (!approval) return requestApproval(req, res, what, fingerprint);
      }
    }

    // Spend the approval and notify only when the change actually went through.
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        if (approval) markUsed(approval.id);
        sendChangeNotice(req, what).catch((err) => {
          console.error('Superadmin change notice failed:', err instanceof Error ? err.message : 'unknown error');
        });
      }
    });
    return next();
  };
}

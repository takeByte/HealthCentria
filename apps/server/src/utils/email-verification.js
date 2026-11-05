import { codeMatches, generateCode, hashCode, normalizeCode } from './one-time-code.js';

// Verification codes are stored in the same collection as reset codes but with
// their own purpose, so one flow can never consume the other's code.
export const EMAIL_VERIFICATION_PURPOSE = 'email_verification';
export const VERIFY_PEPPER = 'email-verification';

// Registration is not a security gate (unverified patients keep full access),
// so the code can live longer than a password-reset code.
export const VERIFY_CODE_TTL_MINUTES = 30;
export const VERIFY_CODE_TTL_MS = VERIFY_CODE_TTL_MINUTES * 60 * 1000;
export const VERIFY_RESEND_COOLDOWN_SECONDS = 60;
export const VERIFY_MAX_ATTEMPTS = 5;

export function generateEmailCode() {
  return generateCode();
}

export function normalizeEmailCode(value) {
  return normalizeCode(value);
}

export function hashEmailCode(code) {
  return hashCode(code, VERIFY_PEPPER);
}

export function emailCodeMatches(code, storedHash) {
  return codeMatches(code, storedHash, VERIFY_PEPPER);
}

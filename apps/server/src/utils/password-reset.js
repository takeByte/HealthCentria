import { codeMatches, generateCode, hashCode, normalizeCode } from './one-time-code.js';

export const RESET_CODE_LENGTH = 6;
export const RESET_CODE_TTL_MINUTES = 10;
export const RESET_CODE_TTL_MS = RESET_CODE_TTL_MINUTES * 60 * 1000;
export const RESET_RESEND_COOLDOWN_SECONDS = 60;
export const RESET_RESEND_COOLDOWN_MS = RESET_RESEND_COOLDOWN_SECONDS * 1000;
export const RESET_MAX_ATTEMPTS = 5;

/** Purpose string mixed into the HMAC so codes cannot be reused across flows. */
export const RESET_PEPPER = 'password-reset';

export function generateResetCode() {
  return generateCode();
}

export function normalizeResetCode(value) {
  return normalizeCode(value);
}

export function hashResetCode(code) {
  return hashCode(code, RESET_PEPPER);
}

export function resetCodeMatches(code, storedHash) {
  return codeMatches(code, storedHash, RESET_PEPPER);
}

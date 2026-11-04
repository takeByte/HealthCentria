import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

export const RESET_CODE_LENGTH = 6;
export const RESET_CODE_TTL_MINUTES = 10;
export const RESET_CODE_TTL_MS = RESET_CODE_TTL_MINUTES * 60 * 1000;
export const RESET_RESEND_COOLDOWN_SECONDS = 60;
export const RESET_RESEND_COOLDOWN_MS = RESET_RESEND_COOLDOWN_SECONDS * 1000;
export const RESET_MAX_ATTEMPTS = 5;

/** Uniformly random 6-digit code, zero-padded (000123 is valid). */
export function generateResetCode() {
  return String(randomInt(0, 10 ** RESET_CODE_LENGTH)).padStart(RESET_CODE_LENGTH, '0');
}

/** Accept "123 456" or "123-456" from the user; anything else is rejected. */
export function normalizeResetCode(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length === RESET_CODE_LENGTH ? digits : '';
}

/**
 * Codes are short, so a plain hash would be trivially reversible. The app
 * secret acts as a pepper and keeps the digest useless on its own.
 */
export function hashResetCode(code) {
  return createHmac('sha256', env.JWT_SECRET).update(`password-reset:${code}`).digest('hex');
}

export function resetCodeMatches(code, storedHash) {
  try {
    const expected = Buffer.from(String(storedHash ?? ''), 'hex');
    const actual = Buffer.from(hashResetCode(code), 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

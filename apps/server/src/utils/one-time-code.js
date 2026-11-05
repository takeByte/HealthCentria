import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

export const CODE_LENGTH = 6;

/** Uniformly random 6-digit code, zero-padded (000123 is valid). */
export function generateCode() {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
}

/** Accept "123 456" or "123-456" from the user; anything else is rejected. */
export function normalizeCode(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length === CODE_LENGTH ? digits : '';
}

/**
 * Codes are short, so a plain hash would be trivially reversible. The app
 * secret acts as a pepper and keeps the digest useless on its own. The purpose
 * is part of the digest so a reset code can never be replayed as a verification
 * code (or the other way around).
 */
export function hashCode(code, purpose) {
  return createHmac('sha256', env.JWT_SECRET).update(`${purpose}:${code}`).digest('hex');
}

export function codeMatches(code, storedHash, purpose) {
  try {
    const expected = Buffer.from(String(storedHash ?? ''), 'hex');
    const actual = Buffer.from(hashCode(code, purpose), 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

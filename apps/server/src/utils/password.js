import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);

export const PASSWORD_ERROR_MESSAGE =
  'Password must be at least 8 characters and include at least two of: letters, numbers, special characters.';

export function isValidPassword(password) {
  if ([...password].length < 8) return false;
  const types = [
    /\p{L}/u.test(password),
    /\p{N}/u.test(password),
    /[^\p{L}\p{N}]/u.test(password),
  ];
  return types.filter(Boolean).length >= 2;
}

// Password hashing with zero new dependencies (Node built-in scrypt).
// Stored format: "scrypt$<salt-hex>$<hash-hex>" so params can evolve later.
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [algo, salt, hashHex] = String(stored).split('$');
    if (algo !== 'scrypt' || !salt || !hashHex) return false;
    const hash = await scrypt(password, salt, 64);
    const expected = Buffer.from(hashHex, 'hex');
    if (expected.length !== hash.length) return false;
    return timingSafeEqual(expected, hash);
  } catch {
    return false;
  }
}

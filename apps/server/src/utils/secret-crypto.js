import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_HEX_LENGTH = 64;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const PART_SEPARATOR = ':';

function getEncryptionKey() {
  const hex = env.SETTINGS_ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('SETTINGS_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes).');
  }
  return Buffer.from(hex, 'hex');
}

/** True when a usable encryption key is present. Never exposes the key. */
export function hasEncryptionKey() {
  try {
    getEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

/** Encrypt a secret and return `iv:authTag:ciphertext` (base64 segments). */
export function encryptSecret(plaintext) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('Cannot encrypt an empty secret.');
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((part) => part.toString('base64')).join(PART_SEPARATOR);
}

/** Decrypt an `iv:authTag:ciphertext` payload produced by `encryptSecret`. */
export function decryptSecret(payload) {
  if (typeof payload !== 'string' || payload.length === 0) {
    throw new Error('Encrypted secret is missing.');
  }
  const parts = payload.split(PART_SEPARATOR);
  if (parts.length !== 3) {
    throw new Error('Encrypted secret is malformed.');
  }
  const [iv, authTag, ciphertext] = parts.map((part) => Buffer.from(part, 'base64'));
  if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
    throw new Error('Encrypted secret is malformed.');
  }
  const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export const SECRET_CRYPTO_DEFAULTS = {
  algorithm: ALGORITHM,
  keyHexLength: KEY_HEX_LENGTH,
  ivBytes: IV_BYTES,
  authTagBytes: AUTH_TAG_BYTES,
};

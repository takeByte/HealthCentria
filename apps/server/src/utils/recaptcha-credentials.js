import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { RECAPTCHA_SETTINGS_KEY, RecaptchaSetting } from '../models/recaptcha-setting.model.js';
import { decryptSecret } from './secret-crypto.js';

/**
 * Resolve the active reCAPTCHA keys at request time: custom database settings
 * first, then the .env defaults.
 *
 * The site key is public by design (the browser needs it to render the
 * widget); the secret key must never be logged or returned.
 */
export async function resolveRecaptchaCredentials() {
  if (mongoose.connection.readyState === 1) {
    try {
      const stored = await RecaptchaSetting.findOne({ key: RECAPTCHA_SETTINGS_KEY }).lean();
      if (stored?.siteKey && stored?.secretKeyEncrypted) {
        try {
          return {
            siteKey: String(stored.siteKey).trim(),
            secretKey: decryptSecret(stored.secretKeyEncrypted),
            source: 'custom',
          };
        } catch {
          console.error(
            'Stored reCAPTCHA secret could not be decrypted. Falling back to environment defaults.',
          );
        }
      }
    } catch {
      console.error('Could not read reCAPTCHA settings from the database. Falling back to environment defaults.');
    }
  }

  return {
    // VITE_RECAPTCHA_SITE_KEY is accepted as a fallback so existing installs
    // keep working after the keys move into the admin UI.
    siteKey: (env.RECAPTCHA_SITE_KEY ?? process.env.VITE_RECAPTCHA_SITE_KEY ?? '').trim(),
    secretKey: (env.RECAPTCHA_SECRET_KEY ?? '').trim(),
    source: 'default',
  };
}

/**
 * Ask Google whether `token` is a valid challenge answer for `secret`. Google
 * only accepts a token produced by the site key paired with that secret, so a
 * passing check proves the two keys belong together. Throws when Google is
 * unreachable; returns { ok: false, codes } when it rejects the token.
 */
export async function verifyRecaptchaToken(secret, token, remoteIp) {
  const params = new URLSearchParams({ secret, response: token });
  if (remoteIp) params.set('remoteip', remoteIp);
  const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`siteverify responded ${response.status}`);
  const data = await response.json();
  return {
    ok: data?.success === true,
    codes: Array.isArray(data?.['error-codes']) ? data['error-codes'] : [],
  };
}

/** True when both halves are present, so the widget and verification can run. */
export function isRecaptchaConfigured(credentials) {
  return Boolean(credentials?.siteKey && credentials?.secretKey);
}

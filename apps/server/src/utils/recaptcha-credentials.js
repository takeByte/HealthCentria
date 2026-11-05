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

/** True when both halves are present, so the widget and verification can run. */
export function isRecaptchaConfigured(credentials) {
  return Boolean(credentials?.siteKey && credentials?.secretKey);
}

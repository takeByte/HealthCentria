import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { EMAIL_SETTINGS_KEY, EmailSetting } from '../models/email-setting.model.js';
import { decryptSecret } from './secret-crypto.js';

/**
 * Resolve the active SMTP configuration at send time: custom database settings
 * first, then the .env defaults. Resolved per message so an admin's change in
 * Settings takes effect immediately, without restarting the API.
 *
 * Never log or return the password from this module.
 */
export async function resolveEmailConfig() {
  if (mongoose.connection.readyState === 1) {
    try {
      const stored = await EmailSetting.findOne({ key: EMAIL_SETTINGS_KEY }).lean();
      if (stored?.host && stored?.user && stored?.passwordEncrypted) {
        try {
          return {
            host: String(stored.host).trim(),
            port: Number(stored.port) || 587,
            user: String(stored.user).trim(),
            pass: decryptSecret(stored.passwordEncrypted),
            from: String(stored.fromAddress ?? '').trim() || env.MAIL_FROM || env.RESEND_FROM,
            source: 'custom',
          };
        } catch {
          console.error('Stored SMTP password could not be decrypted. Falling back to environment defaults.');
        }
      }
    } catch {
      console.error('Could not read SMTP settings from the database. Falling back to environment defaults.');
    }
  }

  return {
    host: (env.SMTP_HOST ?? '').trim(),
    port: env.SMTP_PORT,
    user: (env.SMTP_USER ?? '').trim(),
    pass: env.SMTP_PASS ?? '',
    from: env.MAIL_FROM || env.RESEND_FROM,
    source: 'default',
  };
}

/** True when a usable SMTP connection can be opened from this config. */
export function isSmtpConfigured(config) {
  return Boolean(config?.host && config?.user && config?.pass);
}

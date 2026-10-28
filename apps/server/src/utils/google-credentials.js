import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { GOOGLE_PROVIDER, IntegrationSetting } from '../models/integration-setting.model.js';
import { decryptSecret } from './secret-crypto.js';

/**
 * Resolve the active Google credentials at request time:
 * custom database settings first, then the .env defaults.
 *
 * Never log or return the secret from this module.
 */
export async function resolveGoogleCredentials() {
  if (mongoose.connection.readyState === 1) {
    try {
      const stored = await IntegrationSetting.findOne({ provider: GOOGLE_PROVIDER }).lean();
      if (stored?.clientId && stored?.clientSecretEncrypted) {
        try {
          return {
            clientId: String(stored.clientId).trim(),
            clientSecret: decryptSecret(stored.clientSecretEncrypted),
            source: 'custom',
          };
        } catch {
          console.error(
            'Stored Google credentials could not be decrypted. Falling back to environment defaults.',
          );
        }
      }
    } catch {
      console.error('Could not read Google credentials from settings. Falling back to environment defaults.');
    }
  }

  return {
    clientId: (env.GOOGLE_CLIENT_ID ?? '').trim(),
    clientSecret: (env.GOOGLE_CLIENT_SECRET ?? '').trim(),
    source: 'default',
  };
}

export function isGoogleConfigured(credentials) {
  return Boolean(credentials?.clientId && credentials?.clientSecret);
}

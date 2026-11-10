import mongoose from 'mongoose';
import { UPLOADTHING_SETTINGS_KEY, UploadThingSetting } from '../models/uploadthing-setting.model.js';
import { decryptSecret } from './secret-crypto.js';

/**
 * Resolve the active UploadThing token at request time: the custom value an
 * admin saved (encrypted in the database) first, then UPLOADTHING_TOKEN from
 * .env. The token is a secret and must never be logged or returned.
 */
export async function resolveUploadThingToken() {
  if (mongoose.connection.readyState === 1) {
    try {
      const stored = await UploadThingSetting.findOne({ key: UPLOADTHING_SETTINGS_KEY }).lean();
      if (stored?.tokenEncrypted) {
        try {
          return { token: decryptSecret(stored.tokenEncrypted).trim(), source: 'custom' };
        } catch {
          console.error('Stored upload token could not be decrypted. Falling back to environment default.');
        }
      }
    } catch {
      console.error('Could not read upload settings from the database. Falling back to environment default.');
    }
  }
  return { token: (process.env.UPLOADTHING_TOKEN ?? '').trim(), source: 'default' };
}

/**
 * UploadThing tokens are base64-encoded JSON: { apiKey, appId, regions }.
 * Checking the shape catches a wrong paste before anything is saved.
 */
export function isWellFormedUploadThingToken(token) {
  try {
    const data = JSON.parse(Buffer.from(String(token), 'base64').toString('utf8'));
    return (
      typeof data?.apiKey === 'string' &&
      data.apiKey.length > 0 &&
      typeof data?.appId === 'string' &&
      data.appId.length > 0 &&
      Array.isArray(data?.regions) &&
      data.regions.length > 0
    );
  } catch {
    return false;
  }
}

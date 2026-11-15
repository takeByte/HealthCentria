import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { ASSISTANT_SETTINGS_KEY, AssistantSetting } from '../models/assistant-setting.model.js';
import { decryptSecret } from './secret-crypto.js';

/**
 * Resolve the active AI assistant configuration at request time: the values an
 * admin saved in Settings first (token encrypted in the database), then the
 * CLOUDFLARE_* values from .env. The token is a secret and must never be
 * logged or returned.
 *
 * @returns {Promise<{
 *   accountId: string, token: string, model: string, enabled: boolean,
 *   source: 'custom' | 'default', modelCustom: boolean, configured: boolean,
 * }>}
 */
export async function resolveAssistantConfig() {
  let stored = null;
  if (mongoose.connection.readyState === 1) {
    try {
      stored = await AssistantSetting.findOne({ key: ASSISTANT_SETTINGS_KEY }).lean();
    } catch {
      console.error('Could not read AI assistant settings from the database. Using environment defaults.');
    }
  }

  let accountId = String(env.CLOUDFLARE_ACCOUNT_ID ?? '').trim();
  let token = String(env.CLOUDFLARE_API_TOKEN ?? '').trim();
  let source = 'default';
  if (stored?.accountId && stored?.apiTokenEncrypted) {
    try {
      token = decryptSecret(stored.apiTokenEncrypted).trim();
      accountId = String(stored.accountId).trim();
      source = 'custom';
    } catch {
      console.error('Stored AI assistant token could not be decrypted. Falling back to environment defaults.');
    }
  }

  const modelCustom = Boolean(stored?.model);
  const model = (modelCustom ? stored.model : env.CLOUDFLARE_AI_MODEL).trim();
  const offByEnv = String(env.ASSISTANT_ENABLED ?? '').trim().toLowerCase() === 'off';
  const enabled = typeof stored?.enabled === 'boolean' ? stored.enabled : !offByEnv;

  return { accountId, token, model, enabled, source, modelCustom, configured: Boolean(accountId && token) };
}

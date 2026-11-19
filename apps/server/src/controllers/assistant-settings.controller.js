import mongoose from 'mongoose';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ASSISTANT_SETTINGS_KEY, AssistantSetting } from '../models/assistant-setting.model.js';
import { logActivity } from '../services/activity.js';
import { askWorkersAi } from '../services/assistant.js';
import { resolveAssistantConfig } from '../utils/assistant-credentials.js';
import { maskClientId, maskClientSecret } from '../utils/masking.js';
import { encryptSecret } from '../utils/secret-crypto.js';

function requireDB(res) {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({ success: false, message: 'Database is not connected. Try again later.' });
    return false;
  }
  return true;
}

function present(config) {
  return {
    accountIdMasked: maskClientId(config.accountId),
    tokenMasked: maskClientSecret(config.token),
    model: config.model,
    modelCustom: config.modelCustom,
    enabled: config.enabled,
    source: config.source,
    configured: config.configured,
  };
}

function validationError(res, field, message) {
  return res.status(400).json({ success: false, message: 'Validation failed.', errors: { [field]: [message] } });
}

// A Cloudflare account ID is 32 hex characters; model ids look like @cf/meta/llama-3.1-8b-instruct.
const ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/i;
const TOKEN_PATTERN = /^\S{20,200}$/;
const MODEL_PATTERN = /^@(cf|hf)\/[A-Za-z0-9._\/-]{3,120}$/;

/** Tries a one-line request with these credentials. Returns an error response body, or null when it works. */
async function checkWithCloudflare(config) {
  try {
    await askWorkersAi(
      [
        { role: 'system', content: 'Reply with the single word OK.' },
        { role: 'user', content: 'Test.' },
      ],
      config,
      { maxTokens: 8 },
    );
    return null;
  } catch (error) {
    const status = error?.status;
    if (status === 401 || status === 403) {
      return {
        status: 400,
        field: 'apiToken',
        message:
          'Cloudflare rejected the account ID or API token. Check that the token has the "Workers AI" permission and belongs to this account.',
      };
    }
    if (status === 400 || status === 404) {
      return {
        status: 400,
        field: 'model',
        message: 'Cloudflare could not use that model. Check the model name against the Workers AI model list.',
      };
    }
    return {
      status: 503,
      message: 'Could not reach Cloudflare to verify the settings. Nothing was saved. Try again.',
    };
  }
}

/** GET /api/admin/settings/ai — masked view of the active configuration. */
export const getAssistantSettings = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  res.json({ success: true, ...present(await resolveAssistantConfig()) });
});

const updateSchema = z.object({
  accountId: z.string().trim().max(100).optional(),
  apiToken: z.string().trim().max(300).optional(),
  model: z.string().trim().max(150).optional(),
  enabled: z.boolean().optional(),
});

/**
 * PUT /api/admin/settings/ai — change the account ID, API token, model and/or
 * the on/off switch. Blank inputs (or the masked value shown in the UI) mean
 * "keep the current value". New credentials are tried with Cloudflare before
 * anything is saved, so a bad paste can never break the assistant.
 */
export const updateAssistantSettings = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }

  const current = await resolveAssistantConfig();
  const submittedAccount = parsed.data.accountId ?? '';
  const submittedToken = parsed.data.apiToken ?? '';
  const submittedModel = parsed.data.model ?? '';

  const newAccountId =
    submittedAccount && submittedAccount !== maskClientId(current.accountId) ? submittedAccount : '';
  const newToken = submittedToken && submittedToken !== maskClientSecret(current.token) ? submittedToken : '';
  const newModel = submittedModel && submittedModel !== current.model ? submittedModel : '';
  const enabledChanged = typeof parsed.data.enabled === 'boolean' && parsed.data.enabled !== current.enabled;
  const credentialsChanged = Boolean(newAccountId || newToken);

  if (!credentialsChanged && !newModel && !enabledChanged) {
    return res.json({ success: true, ...present(current) });
  }

  const next = {
    accountId: newAccountId || current.accountId,
    token: newToken || current.token,
    model: newModel || current.model,
  };

  if (credentialsChanged || newModel) {
    if (!next.accountId) return validationError(res, 'accountId', 'Account ID is required.');
    if (!ACCOUNT_ID_PATTERN.test(next.accountId)) {
      return validationError(res, 'accountId', 'The account ID is 32 letters and numbers. Copy it again from Cloudflare.');
    }
    if (!next.token) return validationError(res, 'apiToken', 'API token is required.');
    if (!TOKEN_PATTERN.test(next.token)) {
      return validationError(res, 'apiToken', 'That does not look like a Cloudflare API token.');
    }
    if (!MODEL_PATTERN.test(next.model)) {
      return validationError(res, 'model', 'Enter a Workers AI model name, like @cf/meta/llama-3.1-8b-instruct.');
    }
    const failure = await checkWithCloudflare(next);
    if (failure) {
      return failure.field
        ? validationError(res, failure.field, failure.message)
        : res.status(failure.status).json({ success: false, message: failure.message });
    }
  }

  const set = { updatedBy: req.user.id };
  if (credentialsChanged) {
    try {
      set.apiTokenEncrypted = encryptSecret(next.token);
    } catch {
      return res.status(500).json({
        success: false,
        message:
          'SETTINGS_ENCRYPTION_KEY is missing or invalid. Add a 64-character hex key to apps/server/.env and restart the API.',
      });
    }
    set.accountId = next.accountId;
  }
  if (newModel) set.model = newModel;
  if (enabledChanged) set.enabled = parsed.data.enabled;

  await AssistantSetting.findOneAndUpdate(
    { key: ASSISTANT_SETTINGS_KEY },
    { $set: set },
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
  );

  const changes = [];
  if (newAccountId) changes.push(['accountId', '', 'changed']);
  // The token value is never recorded, only that it was replaced.
  if (newToken) changes.push(['apiToken', '', 'changed']);
  if (newModel) changes.push(['model', current.model, newModel]);
  if (enabledChanged) changes.push(['enabled', String(current.enabled), String(parsed.data.enabled)]);
  await logActivity({
    req,
    action: 'settings.assistant.update',
    target: { type: 'integration', id: ASSISTANT_SETTINGS_KEY, label: 'AI Assistant' },
    changes,
    detail: enabledChanged && changes.length === 1
      ? `AI Assistant turned ${parsed.data.enabled ? 'on' : 'off'}.`
      : 'AI Assistant settings updated.',
  });

  res.json({ success: true, ...present(await resolveAssistantConfig()) });
});

/** DELETE /api/admin/settings/ai — drop the custom account ID, token and model; .env defaults apply again. */
export const deleteAssistantSettings = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const removed = await AssistantSetting.findOneAndUpdate(
    { key: ASSISTANT_SETTINGS_KEY },
    { $unset: { accountId: '', apiTokenEncrypted: '', model: '' }, $set: { updatedBy: req.user.id } },
  );
  if (removed && (removed.accountId || removed.apiTokenEncrypted || removed.model)) {
    await logActivity({
      req,
      action: 'settings.assistant.reset',
      target: { type: 'integration', id: ASSISTANT_SETTINGS_KEY, label: 'AI Assistant' },
      changes: [['source', 'custom', 'default']],
      detail: 'Custom AI Assistant credentials removed; the defaults are active again.',
    });
  }
  res.json({ success: true, ...present(await resolveAssistantConfig()) });
});

/**
 * POST /api/admin/settings/ai/test — a one-line request to Cloudflare.
 * Uses the account ID, token and model typed in the form; a blank (or masked)
 * field falls back to the active value. Saves nothing.
 */
export const testAssistantSettings = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const parsed = updateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res
      .status(400)
      .json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }
  const active = await resolveAssistantConfig();
  const draftAccount = parsed.data.accountId ?? '';
  const draftToken = parsed.data.apiToken ?? '';
  const draftModel = parsed.data.model ?? '';
  const config = {
    accountId: draftAccount && draftAccount !== maskClientId(active.accountId) ? draftAccount : active.accountId,
    token: draftToken && draftToken !== maskClientSecret(active.token) ? draftToken : active.token,
    model: draftModel && draftModel !== active.model ? draftModel : active.model,
  };
  if (!config.accountId || !config.token) {
    return res.status(400).json({ success: false, message: 'No account ID or API token is set yet.' });
  }
  if (!ACCOUNT_ID_PATTERN.test(config.accountId)) {
    return validationError(res, 'accountId', 'The account ID is 32 letters and numbers. Copy it again from Cloudflare.');
  }
  if (!TOKEN_PATTERN.test(config.token)) {
    return validationError(res, 'apiToken', 'That does not look like a Cloudflare API token.');
  }
  if (!MODEL_PATTERN.test(config.model)) {
    return validationError(res, 'model', 'Enter a Workers AI model name, like @cf/meta/llama-3.1-8b-instruct.');
  }
  const failure = await checkWithCloudflare(config);
  if (failure) return res.status(failure.status === 400 ? 502 : failure.status).json({ success: false, message: failure.message });
  res.json({ success: true, message: `Cloudflare answered using ${config.model}.`, model: config.model });
});

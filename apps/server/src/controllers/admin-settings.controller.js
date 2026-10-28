import mongoose from 'mongoose';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AuditLog } from '../models/audit-log.model.js';
import { GOOGLE_PROVIDER, IntegrationSetting } from '../models/integration-setting.model.js';
import { resolveGoogleCredentials } from '../utils/google-credentials.js';
import { maskClientId, maskClientSecret } from '../utils/masking.js';
import { encryptSecret } from '../utils/secret-crypto.js';

const CLIENT_ID_SUFFIX = '.apps.googleusercontent.com';

function requireDB(res) {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({ success: false, message: 'Database is not connected. Try again later.' });
    return false;
  }
  return true;
}

function present(credentials) {
  return {
    clientIdMasked: maskClientId(credentials.clientId),
    clientSecretMasked: maskClientSecret(credentials.clientSecret),
    source: credentials.source,
  };
}

function validationError(res, clientIdMessage) {
  return res.status(400).json({
    success: false,
    message: 'Validation failed.',
    errors: { clientId: [clientIdMessage] },
  });
}

/** GET /api/admin/settings/google — masked view of the active credentials. */
export const getGoogleSettings = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const credentials = await resolveGoogleCredentials();
  res.json({ success: true, ...present(credentials) });
});

const updateSchema = z.object({
  clientId: z.string().trim().optional(),
  clientSecret: z.string().trim().optional(),
});

/**
 * PUT /api/admin/settings/google — replace one or both credentials.
 *
 * Blank inputs (or the exact masked value shown in the UI) mean "keep the
 * current value", so the browser never needs the full stored secret.
 */
export const updateGoogleSettings = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }

  const current = await resolveGoogleCredentials();
  const currentClientIdMasked = maskClientId(current.clientId);
  const currentClientSecretMasked = maskClientSecret(current.clientSecret);

  const submittedClientId = parsed.data.clientId ?? '';
  const submittedClientSecret = parsed.data.clientSecret ?? '';

  const newClientId =
    submittedClientId && submittedClientId !== currentClientIdMasked ? submittedClientId : '';
  const newClientSecret =
    submittedClientSecret && submittedClientSecret !== currentClientSecretMasked ? submittedClientSecret : '';

  if (newClientId && !newClientId.endsWith(CLIENT_ID_SUFFIX)) {
    return validationError(res, `Client ID must end with ${CLIENT_ID_SUFFIX}.`);
  }

  // Nothing new entered: leave both stored and environment values untouched.
  if (!newClientId && !newClientSecret) {
    return res.json({ success: true, ...present(current) });
  }

  // A partial update is completed from the currently active credentials.
  const nextClientId = newClientId || current.clientId;
  const nextClientSecret = newClientSecret || current.clientSecret;

  if (!nextClientId) return validationError(res, 'Client ID is required.');
  if (!nextClientId.endsWith(CLIENT_ID_SUFFIX)) {
    return validationError(res, `Client ID must end with ${CLIENT_ID_SUFFIX}.`);
  }
  if (!nextClientSecret) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed.',
      errors: { clientSecret: ['Client Secret is required.'] },
    });
  }

  let clientSecretEncrypted;
  try {
    clientSecretEncrypted = encryptSecret(nextClientSecret);
  } catch {
    return res.status(500).json({
      success: false,
      message:
        'SETTINGS_ENCRYPTION_KEY is missing or invalid. Add a 64-character hex key to apps/server/.env and restart the API.',
    });
  }

  await IntegrationSetting.findOneAndUpdate(
    { provider: GOOGLE_PROVIDER },
    {
      $set: {
        clientId: nextClientId,
        clientSecretEncrypted,
        updatedBy: req.user.id,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
  );

  await AuditLog.create({
    actor: req.user.id,
    action: 'settings.google.update',
    detail: `provider=google source=${current.source}->custom clientIdChanged=${Boolean(newClientId)} clientSecretChanged=${Boolean(newClientSecret)}`,
  });

  res.json({
    success: true,
    ...present({
      clientId: nextClientId,
      clientSecret: nextClientSecret,
      source: 'custom',
    }),
  });
});

/** DELETE /api/admin/settings/google — drop custom credentials and use .env again. */
export const deleteGoogleSettings = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;

  const removed = await IntegrationSetting.findOneAndDelete({ provider: GOOGLE_PROVIDER });

  if (removed) {
    await AuditLog.create({
      actor: req.user.id,
      action: 'settings.google.reset',
      detail: 'provider=google custom->default',
    });
  }

  const credentials = await resolveGoogleCredentials();
  res.json({ success: true, ...present(credentials) });
});

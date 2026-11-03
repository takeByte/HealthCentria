import mongoose from 'mongoose';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppSettings, SETTINGS_KEY } from '../models/app-settings.model.js';
import { GOOGLE_PROVIDER, IntegrationSetting } from '../models/integration-setting.model.js';
import { logActivity } from '../services/activity.js';
import {
  getGoogleCalendarStatus,
  retryPendingCalendarSync,
  syncUpcomingAppointments,
  testGoogleCalendarConnection as testCalendarConnection,
} from '../services/google-calendar.js';
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

  await logActivity({
    req,
    action: 'settings.google.update',
    target: { type: 'integration', id: GOOGLE_PROVIDER, label: 'Google sign-in' },
    changes: [
      ['source', current.source, 'custom'],
      ...(newClientId ? [['clientId', '', 'changed']] : []),
      // The value is never recorded — only that it was rotated.
      ...(newClientSecret ? [['clientSecret', '', 'changed']] : []),
    ],
    detail: `Google OAuth credentials updated (source ${current.source} → custom).`,
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
    await logActivity({
      req,
      action: 'settings.google.reset',
      target: { type: 'integration', id: GOOGLE_PROVIDER, label: 'Google sign-in' },
      changes: [['source', 'custom', 'default']],
      detail: 'Custom Google OAuth credentials removed; environment defaults are active again.',
    });
  }

  const credentials = await resolveGoogleCredentials();
  res.json({ success: true, ...present(credentials) });
});

/** GET /api/admin/settings/google-calendar — status card data. */
export const getGoogleCalendarSettings = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  res.json({ success: true, ...(await getGoogleCalendarStatus()) });
});

const calendarSettingsSchema = z.object({ enabled: z.boolean() });

/** PATCH /api/admin/settings/google-calendar — stop/start automatic writes. */
export const updateGoogleCalendarSettings = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;

  const parsed = calendarSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed.',
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  const previous = await AppSettings.findOne({ key: SETTINGS_KEY }).lean();
  const wasEnabled = previous?.googleCalendarSyncEnabled !== false;

  await AppSettings.findOneAndUpdate(
    { key: SETTINGS_KEY },
    { $set: { googleCalendarSyncEnabled: parsed.data.enabled } },
    { upsert: true, setDefaultsOnInsert: true },
  ).lean();

  if (wasEnabled !== parsed.data.enabled) {
    await logActivity({
      req,
      action: 'integration.update',
      target: { type: 'integration', id: 'google-calendar', label: 'Google Calendar' },
      changes: [['syncEnabled', wasEnabled, parsed.data.enabled]],
      detail: `Google Calendar sync ${parsed.data.enabled ? 'enabled' : 'disabled'}.`,
    });
  }

  res.json({ success: true, ...(await getGoogleCalendarStatus()) });
});

/** POST /api/admin/settings/google-calendar/test — verify calendar access. */
export const testGoogleCalendarSettings = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  try {
    const result = await testCalendarConnection();
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Google Calendar test failed:', error instanceof Error ? error.message : 'unknown error');
    res.status(502).json({
      success: false,
      message:
        'Could not connect to Google Calendar. Check the service account, calendar sharing, and server logs.',
    });
  }
});

/** POST /api/admin/settings/google-calendar/sync — retry + backfill on demand. */
export const syncGoogleCalendarSettings = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;

  const retried = await retryPendingCalendarSync({ limit: 100 });
  const upcoming = await syncUpcomingAppointments({ limit: 100 });

  res.json({
    success: true,
    retried,
    upcoming,
    status: await getGoogleCalendarStatus(),
  });
});

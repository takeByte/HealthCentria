import mongoose from 'mongoose';
import { z } from 'zod';
import { GOOGLE_DRIVE_PROVIDER, IntegrationSetting } from '../models/integration-setting.model.js';
import { maskClientId, maskClientSecret } from '../utils/masking.js';
import { encryptSecret, hasEncryptionKey } from '../utils/secret-crypto.js';
import { env } from '../config/env.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { logActivity } from '../services/activity.js';
import {
  buildConnectUrl,
  completeConnect,
  consumeState,
  disconnectDrive,
  driveClientConfig,
  folderUrl,
  getDriveRow,
  hasFullDriveScope,
  markNeedsReconnect,
  resetUploadFolder,
  resolveDriveClient,
  setUploadFolder,
  testDriveUpload,
} from '../services/google-drive.js';

function requireDB(res) {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({ success: false, message: 'Database is not connected. Try again later.' });
    return false;
  }
  return true;
}

async function present() {
  const row = mongoose.connection.readyState === 1 ? await getDriveRow() : null;
  const connected = Boolean(row?.refreshTokenEncrypted);
  const client = await resolveDriveClient();
  return {
    clientConfigured: Boolean(client.clientId && client.clientSecret),
    clientIdMasked: maskClientId(client.clientId),
    clientSecretMasked: maskClientSecret(client.clientSecret),
    credentialsSource: client.source,
    connected,
    needsReconnect: connected && Boolean(row?.needsReconnect),
    // Connected before the switch to full Drive access: uploads still work,
    // but a chosen folder needs one reconnect.
    scopeUpgradeNeeded: connected && !hasFullDriveScope(row?.grantedScope),
    accountEmail: connected ? row?.accountEmail ?? '' : '',
    connectedAt: connected ? row?.connectedAt ?? null : null,
    folderId: row?.folderId ?? '',
    folderName: row?.folderName ?? '',
    folderUrl: folderUrl(row?.folderId),
    folderSource: row?.folderSource === 'custom' ? 'custom' : 'default',
    lastUploadAt: row?.lastUploadAt ?? null,
    lastError: row?.lastError ?? '',
    redirectUri: driveClientConfig().redirectUri,
  };
}

/** GET /api/admin/settings/google-drive */
export const getDriveSettings = asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await present()) });
});

/**
 * POST /api/admin/settings/google-drive/connect — superadmin PIN (route).
 * Returns the Google consent URL; the browser navigates there.
 */
export const startDriveConnect = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  try {
    res.json({ success: true, url: await buildConnectUrl(req.user.id) });
  } catch (error) {
    res.status(400).json({ success: false, message: error instanceof Error ? error.message : 'Cannot start.' });
  }
});

function backToSettings(res, params) {
  const url = new URL('/admin/settings', env.CLIENT_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.hash = 'google-drive';
  res.redirect(url.toString());
}

/**
 * GET /api/admin/settings/google-drive/callback — Google redirects the browser
 * here, so there is no auth header. The single-use `state` proves the flow was
 * started by an admin who entered the superadmin PIN in the last 10 minutes.
 */
export const driveCallback = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const pending = consumeState(req.query.state);
  if (!pending) {
    return backToSettings(res, { drive: 'error', message: 'The connection link expired. Click Connect again.' });
  }
  if (req.query.error) {
    return backToSettings(res, {
      drive: 'error',
      message: req.query.error === 'access_denied' ? 'Access was not granted.' : 'Google sign-in was cancelled.',
    });
  }
  if (!req.query.code || mongoose.connection.readyState !== 1) {
    return backToSettings(res, { drive: 'error', message: 'Could not finish connecting. Try again.' });
  }
  try {
    const { accountEmail, folder } = await completeConnect(req.query.code, pending.userId);
    await logActivity({
      req,
      actorId: pending.userId,
      actorRole: 'admin',
      action: 'settings.drive.connect',
      target: { type: 'settings', id: 'google-drive', label: 'Google Drive' },
      detail: `Connected ${accountEmail || 'a Google account'}; uploads go to "${folder.name}"${
        folder.created ? ' (folder created by HealthCentria)' : ''
      }.`,
    });
    return backToSettings(res, { drive: 'connected' });
  } catch (error) {
    return backToSettings(res, {
      drive: 'error',
      message: error instanceof Error ? error.message.slice(0, 200) : 'Could not connect Google Drive.',
    });
  }
});

/** DELETE /api/admin/settings/google-drive/connection — PIN (route). */
export const disconnectDriveSettings = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const before = await disconnectDrive();
  await logActivity({
    req,
    action: 'settings.drive.disconnect',
    target: { type: 'settings', id: 'google-drive', label: 'Google Drive' },
    detail: `Disconnected ${before?.accountEmail || 'Google Drive'}. Files already uploaded stay in Drive.`,
  });
  res.json({ success: true, ...(await present()) });
});

const CLIENT_ID_SUFFIX = '.apps.googleusercontent.com';

const credentialsSchema = z.object({
  clientId: z.string().trim().max(300).optional(),
  clientSecret: z.string().trim().max(300).optional(),
});

function fieldError(res, field, message) {
  return res.status(400).json({ success: false, message, errors: { [field]: [message] } });
}

/**
 * PUT /api/admin/settings/google-drive/credentials — superadmin PIN (route).
 * Same rules as the Google sign-in card: blank (or the masked value) keeps the
 * current value, the secret is encrypted, and the change needs a reconnect.
 */
export const updateDriveCredentials = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const parsed = credentialsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res
      .status(400)
      .json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }
  if (!hasEncryptionKey()) {
    return res.status(503).json({
      success: false,
      message: 'SETTINGS_ENCRYPTION_KEY is missing in the server .env, so the secret cannot be stored safely.',
    });
  }

  const current = await resolveDriveClient();
  const submittedId = parsed.data.clientId ?? '';
  const submittedSecret = parsed.data.clientSecret ?? '';
  const newId = submittedId && submittedId !== maskClientId(current.clientId) ? submittedId : '';
  const newSecret = submittedSecret && submittedSecret !== maskClientSecret(current.clientSecret) ? submittedSecret : '';
  if (!newId && !newSecret) return res.json({ success: true, ...(await present()) });

  const nextId = newId || current.clientId;
  const nextSecret = newSecret || current.clientSecret;
  if (!nextId) return fieldError(res, 'clientId', 'Client ID is required.');
  if (!nextId.endsWith(CLIENT_ID_SUFFIX)) {
    return fieldError(res, 'clientId', `Client ID must end with ${CLIENT_ID_SUFFIX}.`);
  }
  if (!nextSecret) return fieldError(res, 'clientSecret', 'Client Secret is required.');

  const clientChanged = nextId !== current.clientId || nextSecret !== current.clientSecret;
  await IntegrationSetting.findOneAndUpdate(
    { provider: GOOGLE_DRIVE_PROVIDER },
    {
      $set: {
        provider: GOOGLE_DRIVE_PROVIDER,
        clientId: nextId,
        clientSecretEncrypted: encryptSecret(nextSecret),
        updatedBy: req.user.id,
      },
    },
    { upsert: true, setDefaultsOnInsert: true },
  );
  if (clientChanged) {
    await markNeedsReconnect('The Google Drive credentials changed. Reconnect Google Drive to keep uploading.');
  }

  await logActivity({
    req,
    action: 'settings.drive.credentials_update',
    target: { type: 'integration', id: GOOGLE_DRIVE_PROVIDER, label: 'Google Drive' },
    changes: [
      ...(newId ? [['clientId', maskClientId(current.clientId), maskClientId(nextId)]] : []),
      ...(newSecret ? [['clientSecret', 'hidden', 'updated']] : []),
    ],
    detail: `Custom Google Drive OAuth credentials saved${clientChanged ? '; reconnect required' : ''}.`,
  });
  res.json({ success: true, ...(await present()) });
});

/** DELETE /api/admin/settings/google-drive/credentials — back to .env. PIN (route). */
export const resetDriveCredentials = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const removed = await IntegrationSetting.findOneAndDelete({ provider: GOOGLE_DRIVE_PROVIDER });
  if (removed) {
    await markNeedsReconnect('The Google Drive credentials were reset. Reconnect Google Drive to keep uploading.');
    await logActivity({
      req,
      action: 'settings.drive.credentials_reset',
      target: { type: 'integration', id: GOOGLE_DRIVE_PROVIDER, label: 'Google Drive' },
      changes: [['source', 'custom', 'default']],
      detail: 'Custom Google Drive credentials removed; the .env defaults are active again (reconnect required).',
    });
  }
  res.json({ success: true, ...(await present()) });
});

const folderSchema = z.object({ folder: z.string().trim().min(1, 'Paste a folder link or ID.').max(500) });

/**
 * PUT /api/admin/settings/google-drive/folder — superadmin PIN (route).
 * Accepts a folder ID or drive.google.com link; saved only if the connected
 * account can add files to it.
 */
export const updateDriveFolder = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const parsed = folderSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res
      .status(400)
      .json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }
  let result;
  try {
    result = await setUploadFolder(parsed.data.folder);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not use that folder.';
    return fieldError(res, 'folder', message);
  }
  const { before, folder } = result;
  await logActivity({
    req,
    action: 'settings.drive.folder_update',
    target: { type: 'settings', id: 'google-drive', label: 'Google Drive' },
    changes: [['folder', before?.folderName || 'none', folder.name]],
    detail: `PDF uploads now go to the Drive folder "${folder.name}".`,
  });
  res.json({ success: true, ...(await present()) });
});

/** DELETE /api/admin/settings/google-drive/folder — back to the default folder. PIN (route). */
export const resetDriveFolder = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  let result;
  try {
    result = await resetUploadFolder();
  } catch (error) {
    return res
      .status(400)
      .json({ success: false, message: error instanceof Error ? error.message : 'Could not reset the folder.' });
  }
  const { before, folder } = result;
  await logActivity({
    req,
    action: 'settings.drive.folder_reset',
    target: { type: 'settings', id: 'google-drive', label: 'Google Drive' },
    changes: [['folder', before?.folderName || 'none', folder.name]],
    detail: `Upload folder reset to the default "${folder.name}".`,
  });
  res.json({ success: true, ...(await present()) });
});

/** POST /api/admin/settings/google-drive/test — uploads and deletes a small file. */
export const testDriveSettings = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  try {
    const r = await testDriveUpload();
    res.json({ success: true, folderName: r.folderName, folderUrl: folderUrl(r.folderId) });
  } catch (error) {
    res.status(400).json({ success: false, message: error instanceof Error ? error.message : 'Upload test failed.' });
  }
});

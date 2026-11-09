import mongoose from 'mongoose';
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
  isDriveClientConfigured,
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
  return {
    clientConfigured: isDriveClientConfigured(),
    connected,
    needsReconnect: connected && Boolean(row?.needsReconnect),
    accountEmail: connected ? row?.accountEmail ?? '' : '',
    connectedAt: connected ? row?.connectedAt ?? null : null,
    folderId: row?.folderId ?? '',
    folderName: row?.folderName ?? '',
    folderUrl: folderUrl(row?.folderId),
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
    res.json({ success: true, url: buildConnectUrl(req.user.id) });
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

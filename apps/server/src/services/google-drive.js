import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { AppSettings, SETTINGS_KEY } from '../models/app-settings.model.js';
import { DRIVE_SETTINGS_KEY, DriveSetting } from '../models/drive-setting.model.js';
import { GOOGLE_DRIVE_PROVIDER, IntegrationSetting } from '../models/integration-setting.model.js';
import { decryptSecret, encryptSecret, hasEncryptionKey } from '../utils/secret-crypto.js';

/**
 * Google Drive uploads as a real Google account (OAuth), not the service
 * account: service accounts have no Drive storage quota.
 *
 * Scope is full `drive` so an admin can paste any folder link in Settings and
 * uploads land there. Without a chosen folder, the .env folder is used, and
 * otherwise the app's own "HealthCentria Reports" folder.
 *
 * Note: `drive` is a restricted scope. Fine for test users while the OAuth app
 * is in "Testing"; publishing it needs Google's app verification.
 */

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const SCOPES = ['openid', 'email', DRIVE_SCOPE];
const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** True when Google granted full Drive access (connections made before the switch only had drive.file). */
export function hasFullDriveScope(scope) {
  return String(scope ?? '').split(/\s+/).includes(DRIVE_SCOPE);
}
const REQUEST_TIMEOUT_MS = 20_000;
const STATE_TTL_MS = 10 * 60 * 1000;
export const APP_FOLDER_NAME = 'HealthCentria Reports';
// Name used before the system was renamed; such folders are renamed in place.
const LEGACY_FOLDER_NAMES = new Set(['E-Kalinga Reports']);

/** state -> { userId, expiresAt }. In memory: a restart just means "click Connect again". */
const pendingStates = new Map();
let accessCache = { token: '', expiresAt: 0, forRefresh: '' };

/** .env values only (defaults). Use resolveDriveClient() for the active client. */
export function driveClientConfig() {
  return {
    clientId: String(env.GOOGLE_DRIVE_CLIENT_ID ?? '').trim(),
    clientSecret: String(env.GOOGLE_DRIVE_CLIENT_SECRET ?? '').trim(),
    defaultFolderId: extractFolderId(env.GOOGLE_DRIVE_FOLDER_ID),
    redirectUri:
      String(env.GOOGLE_DRIVE_REDIRECT_URI ?? '').trim() ||
      `http://localhost:${env.PORT}/api/admin/settings/google-drive/callback`,
  };
}

/**
 * The active OAuth client: custom credentials saved in Settings first, then the
 * DEFAULT_GOOGLE_DRIVE_* values from .env. Never log or return the secret.
 */
export async function resolveDriveClient() {
  const base = driveClientConfig();
  if (mongoose.connection.readyState === 1) {
    try {
      const stored = await IntegrationSetting.findOne({ provider: GOOGLE_DRIVE_PROVIDER }).lean();
      if (stored?.clientId && stored?.clientSecretEncrypted) {
        try {
          return {
            ...base,
            clientId: String(stored.clientId).trim(),
            clientSecret: decryptSecret(stored.clientSecretEncrypted),
            source: 'custom',
          };
        } catch {
          console.error('Stored Google Drive credentials could not be decrypted. Using the .env defaults.');
        }
      }
    } catch {
      console.error('Could not read Google Drive credentials. Using the .env defaults.');
    }
  }
  return { ...base, source: 'default' };
}

export async function isDriveClientConfigured() {
  const c = await resolveDriveClient();
  return Boolean(c.clientId && c.clientSecret);
}

/**
 * A refresh token only works with the OAuth client that issued it, so after the
 * credentials change the connection must be made again.
 */
export async function markNeedsReconnect(reason) {
  accessCache = { token: '', expiresAt: 0, forRefresh: '' };
  await DriveSetting.updateOne(
    { key: DRIVE_SETTINGS_KEY, refreshTokenEncrypted: { $ne: '' } },
    { $set: { needsReconnect: true, lastError: reason } },
  );
}

/** Accepts a folder ID or a drive.google.com/.../folders/<id> link. */
export function extractFolderId(value) {
  const text = String(value ?? '').trim();
  const fromUrl = text.match(/\/folders\/([a-zA-Z0-9_-]{10,})/);
  if (fromUrl) return fromUrl[1];
  return /^[a-zA-Z0-9_-]{10,}$/.test(text) ? text : '';
}

export async function isGoogleDriveEnabled() {
  if (mongoose.connection.readyState !== 1) return true;
  const doc = await AppSettings.findOne({ key: SETTINGS_KEY }).select('googleDriveEnabled').lean();
  return doc?.googleDriveEnabled !== false;
}

export async function getDriveRow() {
  return DriveSetting.findOne({ key: DRIVE_SETTINGS_KEY }).lean();
}

function short(text, max = 180) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

async function request(url, init = {}) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    throw new Error(`Could not reach Google (${error?.name === 'TimeoutError' ? 'timeout' : 'network error'}).`);
  }
}

/* ------------------------------------------------------------ OAuth flow --- */

export async function buildConnectUrl(userId) {
  const c = await resolveDriveClient();
  if (!c.clientId || !c.clientSecret) {
    throw new Error('Google Drive is not configured: add a Client ID and Secret in Settings or in the server .env.');
  }
  if (!hasEncryptionKey()) {
    throw new Error('SETTINGS_ENCRYPTION_KEY is missing, so the Drive connection cannot be stored safely.');
  }
  const now = Date.now();
  for (const [key, value] of pendingStates) if (value.expiresAt < now) pendingStates.delete(key);
  const state = randomBytes(24).toString('hex');
  pendingStates.set(state, { userId, expiresAt: now + STATE_TTL_MS });

  const params = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    // Account chooser so "Switch account" can pick another Google account, and
    // consent so Google returns a refresh token every time.
    prompt: 'select_account consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/** Single-use: returns the admin who started the flow, or null if unknown/expired. */
export function consumeState(state) {
  const entry = pendingStates.get(String(state ?? ''));
  pendingStates.delete(String(state ?? ''));
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry;
}

function emailFromIdToken(idToken) {
  try {
    const payload = JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8'));
    return String(payload.email ?? '');
  } catch {
    return '';
  }
}

/** Exchanges the callback code, finds/creates the folder, and stores the connection. */
export async function completeConnect(code, userId) {
  const c = await resolveDriveClient();
  const res = await request(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: String(code),
      client_id: c.clientId,
      client_secret: c.clientSecret,
      redirect_uri: c.redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.access_token) {
    throw new Error(`Google rejected the sign-in (${data?.error ?? res.status}).`);
  }
  if (!data.refresh_token) {
    throw new Error('Google did not return a refresh token. Remove HealthCentria from your Google account access and connect again.');
  }
  if (!hasFullDriveScope(data.scope)) {
    throw new Error('Drive access was not granted. Connect again and tick the Google Drive permission.');
  }

  accessCache = { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000, forRefresh: data.refresh_token };

  // Keep a folder chosen in Settings if the newly connected account can write to it.
  const row = await getDriveRow();
  let folder = null;
  let folderSource = 'auto';
  if (row?.folderSource === 'custom' && row.folderId) {
    try {
      folder = { ...(await inspectFolder(row.folderId, data.access_token)), created: false };
      folderSource = 'custom';
    } catch {
      folder = null;
    }
  }
  folder ??= await resolveUploadFolder(data.access_token);

  await DriveSetting.findOneAndUpdate(
    { key: DRIVE_SETTINGS_KEY },
    {
      $set: {
        refreshTokenEncrypted: encryptSecret(data.refresh_token),
        accountEmail: emailFromIdToken(data.id_token),
        connectedAt: new Date(),
        connectedBy: userId || null,
        grantedScope: String(data.scope ?? ''),
        folderId: folder.id,
        folderName: folder.name,
        folderSource,
        needsReconnect: false,
        lastError: '',
      },
    },
    { upsert: true, setDefaultsOnInsert: true },
  );
  return { accountEmail: emailFromIdToken(data.id_token), folder };
}

export async function disconnectDrive() {
  const row = await getDriveRow();
  if (row?.refreshTokenEncrypted) {
    try {
      const token = decryptSecret(row.refreshTokenEncrypted);
      await request(REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }),
      });
    } catch {
      // Revocation is best effort; the stored token is deleted either way.
    }
  }
  accessCache = { token: '', expiresAt: 0, forRefresh: '' };
  await DriveSetting.findOneAndUpdate(
    { key: DRIVE_SETTINGS_KEY },
    {
      $set: {
        refreshTokenEncrypted: '',
        accountEmail: '',
        connectedAt: null,
        connectedBy: null,
        grantedScope: '',
        needsReconnect: false,
        lastError: '',
      },
    },
  );
  return row;
}

/* ---------------------------------------------------------- API helpers --- */

async function accessToken() {
  const row = await getDriveRow();
  if (!row?.refreshTokenEncrypted) throw new Error('Google Drive is not connected. Click "Connect Google Drive" in Settings.');
  const refresh = decryptSecret(row.refreshTokenEncrypted);
  if (accessCache.token && accessCache.forRefresh === refresh && accessCache.expiresAt > Date.now() + 60_000) {
    return accessCache.token;
  }
  const c = await resolveDriveClient();
  const res = await request(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.access_token) {
    if (data?.error === 'invalid_grant') {
      // Revoked, or the 7-day limit of a "Testing" OAuth app.
      await DriveSetting.updateOne(
        { key: DRIVE_SETTINGS_KEY },
        { $set: { needsReconnect: true, lastError: 'The Google Drive connection expired. Reconnect it in Settings.' } },
      );
      throw new Error('The Google Drive connection expired. An admin needs to click "Reconnect Google Drive" in Settings.');
    }
    throw new Error(`Google token refresh failed (${data?.error ?? res.status}).`);
  }
  accessCache = { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000, forRefresh: refresh };
  return data.access_token;
}

async function driveJson(method, url, { token, body, query } = {}) {
  const t = token ?? (await accessToken());
  const target = new URL(url);
  for (const [k, v] of Object.entries(query ?? {})) target.searchParams.set(k, v);
  const res = await request(target, {
    method,
    headers: { Authorization: `Bearer ${t}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = short(data?.error?.message);
    if (/has not been used|is disabled/i.test(detail)) {
      throw new Error('The Google Drive API is not enabled in the Google Cloud project. Enable it, wait a minute, and try again.');
    }
    const error = new Error(`Google Drive request failed (${res.status})${detail ? `: ${detail}` : '.'}`);
    error.status = res.status;
    throw error;
  }
  return data;
}

/**
 * Checks that a folder exists, is not in the trash, and the connected account
 * can add files to it. Throws a message an admin can act on.
 * @returns {Promise<{ id: string, name: string }>}
 */
export async function inspectFolder(folderId, token) {
  let f;
  try {
    f = await driveJson('GET', `${DRIVE_API}/files/${folderId}`, {
      token,
      query: { fields: 'id,name,mimeType,capabilities(canAddChildren),trashed', supportsAllDrives: 'true' },
    });
  } catch (error) {
    if (error.status === 404) {
      throw new Error('Folder not found. Check the link, and that the connected Google account can open it.');
    }
    throw error;
  }
  if (f?.mimeType !== FOLDER_MIME) throw new Error('That link is not a Google Drive folder.');
  if (f.trashed) throw new Error('That folder is in the trash. Restore it or choose another folder.');
  if (!f.capabilities?.canAddChildren) {
    throw new Error('The connected Google account cannot add files to that folder. Ask the owner for Editor access.');
  }
  return { id: f.id, name: f.name };
}

/**
 * Uses the .env folder when the app is allowed to write there; otherwise finds
 * or creates the app's own "HealthCentria Reports" folder.
 */
async function resolveUploadFolder(token) {
  const { defaultFolderId } = driveClientConfig();
  if (defaultFolderId) {
    try {
      return { ...(await inspectFolder(defaultFolderId, token)), created: false };
    } catch {
      // Missing or not writable: fall through to the app folder.
    }
  }
  const found = await driveJson('GET', `${DRIVE_API}/files`, {
    token,
    query: {
      q: `mimeType='application/vnd.google-apps.folder' and trashed=false and appProperties has { key='ekalinga' and value='reports' }`,
      fields: 'files(id,name)',
      pageSize: '1',
    },
  });
  if (found?.files?.[0]) return { id: found.files[0].id, name: found.files[0].name, created: false };
  const created = await driveJson('POST', `${DRIVE_API}/files`, {
    token,
    query: { fields: 'id,name' },
    body: {
      name: APP_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
      appProperties: { ekalinga: 'reports' },
    },
  });
  return { id: created.id, name: created.name, created: true };
}

async function renameAppFolder(folderId) {
  try {
    await driveJson('PATCH', `${DRIVE_API}/files/${folderId}`, { query: { fields: 'id' }, body: { name: APP_FOLDER_NAME } });
    await DriveSetting.updateOne({ key: DRIVE_SETTINGS_KEY }, { $set: { folderName: APP_FOLDER_NAME } });
  } catch {
    // Cosmetic: uploads still work under the old name.
  }
}

/** Folder for the next upload; recreates the app folder if it was deleted. */
async function uploadFolder() {
  const row = await getDriveRow();
  if (row?.folderId) {
    try {
      const f = await driveJson('GET', `${DRIVE_API}/files/${row.folderId}`, { query: { fields: 'id,name,trashed', supportsAllDrives: 'true' } });
      if (f && !f.trashed) {
        if (LEGACY_FOLDER_NAMES.has(f.name)) await renameAppFolder(row.folderId);
        return row.folderId;
      }
    } catch {
      // Fall through and resolve again.
    }
  }
  // A chosen folder that was deleted falls back to the default, so exports keep working.
  const folder = await resolveUploadFolder(await accessToken());
  await DriveSetting.updateOne(
    { key: DRIVE_SETTINGS_KEY },
    { $set: { folderId: folder.id, folderName: folder.name, folderSource: 'auto' } },
  );
  return folder.id;
}

/** Saves an admin-chosen upload folder (ID or drive.google.com link) after checking it. */
export async function setUploadFolder(input) {
  const folderId = extractFolderId(input);
  if (!folderId) throw new Error('Paste a Google Drive folder link or folder ID.');
  const row = await getDriveRow();
  if (!row?.refreshTokenEncrypted) throw new Error('Connect a Google account first.');
  if (!hasFullDriveScope(row.grantedScope)) {
    throw new Error('Reconnect Google Drive once so HealthCentria can use folders you choose.');
  }
  const folder = await inspectFolder(folderId, await accessToken());
  await DriveSetting.updateOne(
    { key: DRIVE_SETTINGS_KEY },
    { $set: { folderId: folder.id, folderName: folder.name, folderSource: 'custom', lastError: '' } },
  );
  return { before: row, folder };
}

/** Back to the .env folder, or the app's own "HealthCentria Reports" folder. */
export async function resetUploadFolder() {
  const row = await getDriveRow();
  if (!row?.refreshTokenEncrypted) throw new Error('Connect a Google account first.');
  const folder = await resolveUploadFolder(await accessToken());
  await DriveSetting.updateOne(
    { key: DRIVE_SETTINGS_KEY },
    { $set: { folderId: folder.id, folderName: folder.name, folderSource: 'auto', lastError: '' } },
  );
  return { before: row, folder };
}

/**
 * Uploads a file into the reports folder.
 * @returns {Promise<{ id: string, name: string, webViewLink: string }>}
 */
export async function uploadToDrive({ name, mimeType, data, description = '' }, { ignoreSwitch = false } = {}) {
  if (!ignoreSwitch && !(await isGoogleDriveEnabled())) throw new Error('Google Drive uploads are turned off in Settings.');
  const folderId = await uploadFolder();
  const token = await accessToken();
  const boundary = `ekalinga${randomBytes(8).toString('hex')}`;
  const metadata = { name, parents: [folderId], description };
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    ),
    Buffer.isBuffer(data) ? data : Buffer.from(String(data)),
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const res = await request(`${UPLOAD_API}/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.id) {
    const detail = short(json?.error?.message);
    const message = `Google Drive upload failed (${res.status})${detail ? `: ${detail}` : '.'}`;
    await DriveSetting.updateOne({ key: DRIVE_SETTINGS_KEY }, { $set: { lastError: message } });
    throw new Error(message);
  }
  await DriveSetting.updateOne({ key: DRIVE_SETTINGS_KEY }, { $set: { lastUploadAt: new Date(), lastError: '' } });
  return json;
}

export async function deleteDriveFile(fileId) {
  await driveJson('DELETE', `${DRIVE_API}/files/${fileId}`, { query: { supportsAllDrives: 'true' } });
}

/**
 * Gives one person view access to one file. Some addresses (not Google
 * accounts) are only accepted with a notification email, so retry with one.
 */
export async function shareDriveFile(fileId, email) {
  const body = { type: 'user', role: 'reader', emailAddress: email };
  try {
    await driveJson('POST', `${DRIVE_API}/files/${fileId}/permissions`, {
      query: { sendNotificationEmail: 'false', supportsAllDrives: 'true', fields: 'id' },
      body,
    });
  } catch (error) {
    if (error.status !== 400) throw error;
    await driveJson('POST', `${DRIVE_API}/files/${fileId}/permissions`, {
      query: { sendNotificationEmail: 'true', supportsAllDrives: 'true', fields: 'id' },
      body,
    });
  }
}

/** Uploads and deletes a tiny text file to prove the connection works end to end. */
export async function testDriveUpload() {
  const file = await uploadToDrive({
    name: `HealthCentria connection test ${new Date().toISOString()}.txt`,
    mimeType: 'text/plain',
    data: 'HealthCentria Google Drive connection test. This file is deleted automatically.',
  }, { ignoreSwitch: true });
  await deleteDriveFile(file.id).catch(() => {});
  const row = await getDriveRow();
  return { folderId: row?.folderId ?? '', folderName: row?.folderName ?? '' };
}

export function folderUrl(folderId) {
  return folderId ? `https://drive.google.com/drive/folders/${folderId}` : '';
}

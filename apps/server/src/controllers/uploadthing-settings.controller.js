import mongoose from 'mongoose';
import { z } from 'zod';
import { UTApi } from 'uploadthing/server';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { UPLOADTHING_SETTINGS_KEY, UploadThingSetting } from '../models/uploadthing-setting.model.js';
import { logActivity } from '../services/activity.js';
import { maskClientSecret } from '../utils/masking.js';
import { encryptSecret } from '../utils/secret-crypto.js';
import { isWellFormedUploadThingToken, resolveUploadThingToken } from '../utils/uploadthing-credentials.js';

function requireDB(res) {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({ success: false, message: 'Database is not connected. Try again later.' });
    return false;
  }
  return true;
}

function present(credentials) {
  return {
    tokenMasked: maskClientSecret(credentials.token),
    source: credentials.source,
    configured: Boolean(credentials.token),
  };
}

function validationError(res, message) {
  return res.status(400).json({ success: false, message: 'Validation failed.', errors: { token: [message] } });
}

/** GET /api/admin/settings/uploadthing — masked view of the active token. */
export const getUploadThingSettings = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  res.json({ success: true, ...present(await resolveUploadThingToken()) });
});

const updateSchema = z.object({ token: z.string().trim().min(1, 'Token is required.').max(2000) });

/**
 * PUT /api/admin/settings/uploadthing — replace the token. It is checked with
 * UploadThing before saving, so a bad paste can never break image uploads.
 */
export const updateUploadThingSettings = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return validationError(res, parsed.error.flatten().fieldErrors.token?.[0] ?? 'Token is required.');
  }

  const token = parsed.data.token;
  const current = await resolveUploadThingToken();
  // The masked value shown in the UI means "keep the current token".
  if (token === maskClientSecret(current.token)) return res.json({ success: true, ...present(current) });
  if (!isWellFormedUploadThingToken(token)) {
    return validationError(
      res,
      'That does not look like an UploadThing token. Copy it again from your UploadThing dashboard.',
    );
  }

  try {
    await new UTApi({ token }).getUsageInfo();
  } catch (err) {
    const status = err?.status ?? err?.cause?.status;
    if (status === 401 || status === 403) {
      return validationError(res, 'UploadThing rejected this token. Check that you copied the whole token.');
    }
    return res.status(503).json({
      success: false,
      message: 'Could not reach UploadThing to verify the token. Nothing was saved. Try again.',
    });
  }

  let tokenEncrypted;
  try {
    tokenEncrypted = encryptSecret(token);
  } catch {
    return res.status(500).json({
      success: false,
      message:
        'SETTINGS_ENCRYPTION_KEY is missing or invalid. Add a 64-character hex key to the server settings and restart the API.',
    });
  }

  await UploadThingSetting.findOneAndUpdate(
    { key: UPLOADTHING_SETTINGS_KEY },
    { $set: { tokenEncrypted, updatedBy: req.user.id } },
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
  );

  await logActivity({
    req,
    action: 'settings.uploadthing.update',
    target: { type: 'integration', id: UPLOADTHING_SETTINGS_KEY, label: 'Upload Image' },
    // The value is never recorded, only that it was replaced.
    changes: [
      ['source', current.source, 'custom'],
      ['token', '', 'changed'],
    ],
    detail: `Upload Image token updated (source ${current.source} → custom).`,
  });

  res.json({ success: true, ...present({ token, source: 'custom' }) });
});

/** DELETE /api/admin/settings/uploadthing — drop the custom token and use the default again. */
export const deleteUploadThingSettings = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const removed = await UploadThingSetting.findOneAndDelete({ key: UPLOADTHING_SETTINGS_KEY });
  if (removed) {
    await logActivity({
      req,
      action: 'settings.uploadthing.reset',
      target: { type: 'integration', id: UPLOADTHING_SETTINGS_KEY, label: 'Upload Image' },
      changes: [['source', 'custom', 'default']],
      detail: 'Custom Upload Image token removed; the default is active again.',
    });
  }
  res.json({ success: true, ...present(await resolveUploadThingToken()) });
});

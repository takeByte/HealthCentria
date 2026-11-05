import mongoose from 'mongoose';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { RECAPTCHA_SETTINGS_KEY, RecaptchaSetting } from '../models/recaptcha-setting.model.js';
import { logActivity } from '../services/activity.js';
import { maskClientId, maskClientSecret } from '../utils/masking.js';
import {
  isRecaptchaConfigured,
  resolveRecaptchaCredentials,
} from '../utils/recaptcha-credentials.js';
import { encryptSecret } from '../utils/secret-crypto.js';

function requireDB(res) {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({ success: false, message: 'Database is not connected. Try again later.' });
    return false;
  }
  return true;
}

function present(credentials) {
  return {
    siteKeyMasked: maskClientId(credentials.siteKey),
    secretKeyMasked: maskClientSecret(credentials.secretKey),
    source: credentials.source,
    configured: isRecaptchaConfigured(credentials),
  };
}

function validationError(res, field, message) {
  return res.status(400).json({ success: false, message: 'Validation failed.', errors: { [field]: [message] } });
}

/** GET /api/admin/settings/recaptcha — masked view of the active keys. */
export const getRecaptchaSettings = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  res.json({ success: true, ...present(await resolveRecaptchaCredentials()) });
});

const updateSchema = z.object({
  siteKey: z.string().trim().max(200).optional(),
  secretKey: z.string().trim().max(200).optional(),
});

// Google's v2 keys are URL-safe base64-ish strings (usually 40 characters).
const KEY_PATTERN = /^[A-Za-z0-9_-]{10,200}$/;

/**
 * PUT /api/admin/settings/recaptcha — replace one or both keys.
 *
 * Blank inputs (or the exact masked value shown in the UI) mean "keep the
 * current value", so the browser never needs the stored secret.
 */
export const updateRecaptchaSettings = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }

  const current = await resolveRecaptchaCredentials();
  const currentSiteKeyMasked = maskClientId(current.siteKey);
  const currentSecretKeyMasked = maskClientSecret(current.secretKey);

  const submittedSiteKey = parsed.data.siteKey ?? '';
  const submittedSecretKey = parsed.data.secretKey ?? '';

  const newSiteKey =
    submittedSiteKey && submittedSiteKey !== currentSiteKeyMasked ? submittedSiteKey : '';
  const newSecretKey =
    submittedSecretKey && submittedSecretKey !== currentSecretKeyMasked ? submittedSecretKey : '';

  // Nothing new entered: leave both stored and environment values untouched.
  if (!newSiteKey && !newSecretKey) {
    return res.json({ success: true, ...present(current) });
  }

  // A partial update is completed from the currently active credentials.
  const nextSiteKey = newSiteKey || current.siteKey;
  const nextSecretKey = newSecretKey || current.secretKey;

  if (!nextSiteKey) return validationError(res, 'siteKey', 'Site key is required.');
  if (!KEY_PATTERN.test(nextSiteKey)) {
    return validationError(res, 'siteKey', 'Enter a valid reCAPTCHA site key.');
  }
  if (!nextSecretKey) return validationError(res, 'secretKey', 'Secret key is required.');
  if (!KEY_PATTERN.test(nextSecretKey)) {
    return validationError(res, 'secretKey', 'Enter a valid reCAPTCHA secret key.');
  }

  let secretKeyEncrypted;
  try {
    secretKeyEncrypted = encryptSecret(nextSecretKey);
  } catch {
    return res.status(500).json({
      success: false,
      message:
        'SETTINGS_ENCRYPTION_KEY is missing or invalid. Add a 64-character hex key to apps/server/.env and restart the API.',
    });
  }

  await RecaptchaSetting.findOneAndUpdate(
    { key: RECAPTCHA_SETTINGS_KEY },
    {
      $set: {
        siteKey: nextSiteKey,
        secretKeyEncrypted,
        updatedBy: req.user.id,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
  );

  await logActivity({
    req,
    action: 'settings.recaptcha.update',
    target: { type: 'integration', id: RECAPTCHA_SETTINGS_KEY, label: 'reCAPTCHA' },
    changes: [
      ['source', current.source, 'custom'],
      ...(newSiteKey ? [['siteKey', '', 'changed']] : []),
      // The value is never recorded — only that it was rotated.
      ...(newSecretKey ? [['secretKey', '', 'changed']] : []),
    ],
    detail: `reCAPTCHA keys updated (source ${current.source} → custom).`,
  });

  res.json({
    success: true,
    ...present({
      siteKey: nextSiteKey,
      secretKey: nextSecretKey,
      source: 'custom',
    }),
  });
});

/** DELETE /api/admin/settings/recaptcha — drop custom keys and use .env again. */
export const deleteRecaptchaSettings = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;

  const removed = await RecaptchaSetting.findOneAndDelete({ key: RECAPTCHA_SETTINGS_KEY });

  if (removed) {
    await logActivity({
      req,
      action: 'settings.recaptcha.reset',
      target: { type: 'integration', id: RECAPTCHA_SETTINGS_KEY, label: 'reCAPTCHA' },
      changes: [['source', 'custom', 'default']],
      detail: 'Custom reCAPTCHA keys removed; environment defaults are active again.',
    });
  }

  res.json({ success: true, ...present(await resolveRecaptchaCredentials()) });
});

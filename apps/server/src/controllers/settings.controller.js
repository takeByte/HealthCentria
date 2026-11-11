import mongoose from 'mongoose';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppSettings, SETTINGS_KEY, isGoogleSignInEnabled } from '../models/app-settings.model.js';
import { logActivity } from '../services/activity.js';
import { isGoogleConfigured, resolveGoogleCredentials } from '../utils/google-credentials.js';
import { resolveRecaptchaCredentials } from '../utils/recaptcha-credentials.js';
import { resolveUploadThingToken } from '../utils/uploadthing-credentials.js';

function requireDB(res) {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({ success: false, message: 'Database is not connected. Try again later.' });
    return false;
  }
  return true;
}

/** Shape the admin UI consumes; `googleConfigured` explains why the switch may not matter. */
async function present(doc) {
  const credentials = await resolveGoogleCredentials();
  return {
    googleSignInEnabled: doc?.googleSignInEnabled !== false,
    recaptchaEnabled: doc?.recaptchaEnabled !== false,
    notificationEmailsEnabled: doc?.notificationEmailsEnabled !== false,
    googleSheetsEnabled: doc?.googleSheetsEnabled !== false,
    googleDriveEnabled: doc?.googleDriveEnabled !== false,
    uploadthingEnabled: doc?.uploadthingEnabled !== false,
    uploadthingConfigured: Boolean((await resolveUploadThingToken()).token),
    googleConfigured: isGoogleConfigured(credentials),
    updatedAt: doc?.updatedAt ?? null,
  };
}

/**
 * GET /api/settings/public — unauthenticated on purpose: the login page needs
 * this to hide the Google button before the user ever tries it.
 */
export const getPublicSettings = asyncHandler(async (req, res) => {
  const doc =
    mongoose.connection.readyState === 1 ? await AppSettings.findOne({ key: SETTINGS_KEY }).lean() : null;
  const recaptcha = await resolveRecaptchaCredentials();
  res.json({
    success: true,
    googleSignInEnabled: doc?.googleSignInEnabled !== false,
    recaptchaEnabled: doc?.recaptchaEnabled !== false,
    // Public so the announcement composer can hide the photo picker while off.
    uploadthingEnabled: doc?.uploadthingEnabled !== false,
    // Public by design: the browser needs it to render the widget.
    recaptchaSiteKey: recaptcha.siteKey,
  });
});

/** GET /api/settings — admin view, including whether Google is configured at all. */
export const getSettings = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const doc = await AppSettings.findOne({ key: SETTINGS_KEY }).lean();
  res.json({ success: true, settings: await present(doc) });
});

const updateSchema = z
  .object({
    googleSignInEnabled: z.boolean().optional(),
    recaptchaEnabled: z.boolean().optional(),
    notificationEmailsEnabled: z.boolean().optional(),
    googleSheetsEnabled: z.boolean().optional(),
    googleDriveEnabled: z.boolean().optional(),
    uploadthingEnabled: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0);

/** PATCH /api/settings — flip a switch. Upserts, so the first change creates the row. */
export const updateSettings = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }
  const previous = await AppSettings.findOne({ key: SETTINGS_KEY }).lean();
  const doc = await AppSettings.findOneAndUpdate(
    { key: SETTINGS_KEY },
    { $set: parsed.data },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();

  if (
    parsed.data.googleSignInEnabled !== undefined &&
    (previous?.googleSignInEnabled !== false) !== parsed.data.googleSignInEnabled
  ) {
    await logActivity({
      req,
      action: 'settings.signin.update',
      target: { type: 'settings', id: SETTINGS_KEY, label: 'Sign-in methods' },
      changes: [
        ['googleSignInEnabled', previous?.googleSignInEnabled !== false, parsed.data.googleSignInEnabled],
      ],
      detail: `Google sign-in ${parsed.data.googleSignInEnabled ? 'enabled' : 'disabled'}.`,
    });
  }

  if (
    parsed.data.recaptchaEnabled !== undefined &&
    (previous?.recaptchaEnabled !== false) !== parsed.data.recaptchaEnabled
  ) {
    await logActivity({
      req,
      action: 'settings.recaptcha.update',
      target: { type: 'settings', id: SETTINGS_KEY, label: 'reCAPTCHA protection' },
      changes: [['recaptchaEnabled', previous?.recaptchaEnabled !== false, parsed.data.recaptchaEnabled]],
      detail: `reCAPTCHA ${parsed.data.recaptchaEnabled ? 'enabled' : 'disabled'}.`,
    });
  }

  if (
    parsed.data.notificationEmailsEnabled !== undefined &&
    (previous?.notificationEmailsEnabled !== false) !== parsed.data.notificationEmailsEnabled
  ) {
    await logActivity({
      req,
      // Reuses the existing email-settings action so it lands under Configuration.
      action: 'settings.email.update',
      target: { type: 'settings', id: SETTINGS_KEY, label: 'Notification emails' },
      changes: [
        [
          'notificationEmailsEnabled',
          previous?.notificationEmailsEnabled !== false,
          parsed.data.notificationEmailsEnabled,
        ],
      ],
      detail: `Notification emails ${parsed.data.notificationEmailsEnabled ? 'enabled' : 'disabled'}. Security codes are unaffected.`,
    });
  }

  if (
    parsed.data.googleSheetsEnabled !== undefined &&
    (previous?.googleSheetsEnabled !== false) !== parsed.data.googleSheetsEnabled
  ) {
    await logActivity({
      req,
      action: 'integration.update',
      target: { type: 'settings', id: SETTINGS_KEY, label: 'Google Sheets export' },
      changes: [['googleSheetsEnabled', previous?.googleSheetsEnabled !== false, parsed.data.googleSheetsEnabled]],
      detail: `Google Sheets export ${parsed.data.googleSheetsEnabled ? 'enabled' : 'disabled'}.`,
    });
  }

  if (
    parsed.data.googleDriveEnabled !== undefined &&
    (previous?.googleDriveEnabled !== false) !== parsed.data.googleDriveEnabled
  ) {
    await logActivity({
      req,
      action: 'integration.update',
      target: { type: 'settings', id: SETTINGS_KEY, label: 'Google Drive uploads' },
      changes: [['googleDriveEnabled', previous?.googleDriveEnabled !== false, parsed.data.googleDriveEnabled]],
      detail: `Google Drive uploads ${parsed.data.googleDriveEnabled ? 'enabled' : 'disabled'}.`,
    });
  }

  if (
    parsed.data.uploadthingEnabled !== undefined &&
    (previous?.uploadthingEnabled !== false) !== parsed.data.uploadthingEnabled
  ) {
    await logActivity({
      req,
      action: 'integration.update',
      target: { type: 'settings', id: SETTINGS_KEY, label: 'UploadThing image uploads' },
      changes: [['uploadthingEnabled', previous?.uploadthingEnabled !== false, parsed.data.uploadthingEnabled]],
      detail: `UploadThing image uploads ${parsed.data.uploadthingEnabled ? 'enabled' : 'disabled'}.`,
    });
  }

  res.json({ success: true, settings: await present(doc) });
});

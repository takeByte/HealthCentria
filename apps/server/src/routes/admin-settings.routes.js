import { Router } from 'express';
import {
  deleteGoogleSettings,
  getGoogleCalendarSettings,
  getGoogleSettings,
  syncGoogleCalendarSettings,
  testGoogleCalendarSettings,
  updateGoogleCalendarSettings,
  updateGoogleSettings,
} from '../controllers/admin-settings.controller.js';
import {
  deleteEmailSettings,
  getEmailSettings,
  testEmailSettings,
  updateEmailSettings,
} from '../controllers/email-settings.controller.js';
import {
  deleteUploadThingSettings,
  getUploadThingSettings,
  updateUploadThingSettings,
} from '../controllers/uploadthing-settings.controller.js';
import {
  deleteRecaptchaSettings,
  getRecaptchaSettings,
  updateRecaptchaSettings,
} from '../controllers/recaptcha-settings.controller.js';
import {
  getSheetsSettings,
  resetSheetsSettings,
  testSheetsSettings,
  updateSheetsSettings,
} from '../controllers/sheets-settings.controller.js';
import {
  disconnectDriveSettings,
  driveCallback,
  getDriveSettings,
  resetDriveCredentials,
  resetDriveFolder,
  startDriveConnect,
  testDriveSettings,
  updateDriveCredentials,
  updateDriveFolder,
} from '../controllers/drive-settings.controller.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { requireSuperPin } from '../middleware/requireSuperPin.js';
import {
  downloadBackup,
  getBackupSettings,
  removeBackup,
  runBackupNow,
  updateBackupSettings,
} from '../controllers/backup-settings.controller.js';

export const adminSettingsRouter = Router();

// Google redirects the browser here after the Drive consent screen, so it
// carries no auth header. It must stay above the requireAuth guard below; the
// single-use `state` from the PIN-protected /connect call is the check instead.
adminSettingsRouter.get('/google-drive/callback', driveCallback);

// Only admins configure third-party credentials. Patients and staff keep using
// the normal sign-in buttons, which read the active public client ID.
adminSettingsRouter.use(requireAuth, requireRole('admin'));
adminSettingsRouter.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

adminSettingsRouter.get('/google', getGoogleSettings);
// Every save, reset and switch below needs the superadmin PIN (SU_PIN).
// Read-only, test and sync endpoints do not: they change no settings.
adminSettingsRouter.put('/google', requireSuperPin('Google sign-in credentials'), updateGoogleSettings);
adminSettingsRouter.delete('/google', requireSuperPin('Google sign-in credentials (reset to default)'), deleteGoogleSettings);

// reCAPTCHA keys. The site key is public; the secret key is encrypted at rest.
// Both can be overridden here without editing .env and restarting the API.
adminSettingsRouter.get('/recaptcha', getRecaptchaSettings);
adminSettingsRouter.put('/recaptcha', requireSuperPin('reCAPTCHA keys'), updateRecaptchaSettings);
adminSettingsRouter.delete('/recaptcha', requireSuperPin('reCAPTCHA keys (reset to default)'), deleteRecaptchaSettings);

// Upload Image (UploadThing) token, encrypted at rest.
adminSettingsRouter.get('/uploadthing', getUploadThingSettings);
adminSettingsRouter.put('/uploadthing', requireSuperPin('Upload Image token'), updateUploadThingSettings);
adminSettingsRouter.delete(
  '/uploadthing',
  requireSuperPin('Upload Image token (reset to default)'),
  deleteUploadThingSettings,
);

// Email delivery (SMTP). Password reset codes and announcements use it, so an
// admin can fix mail delivery without editing .env and restarting the API.
adminSettingsRouter.get('/email', getEmailSettings);
adminSettingsRouter.put('/email', requireSuperPin('Email delivery (SMTP) settings'), updateEmailSettings);
adminSettingsRouter.delete('/email', requireSuperPin('Email delivery (SMTP) settings (reset to default)'), deleteEmailSettings);
adminSettingsRouter.post('/email/test', testEmailSettings);

// Google Calendar sync is additive: the existing appointment flow continues to
// work when these env vars are absent or the admin switches sync off.
adminSettingsRouter.get('/google-calendar', getGoogleCalendarSettings);
adminSettingsRouter.patch(
  '/google-calendar',
  requireSuperPin((req) => `Google Calendar sync switched ${req.body?.enabled ? 'on' : 'off'}`),
  updateGoogleCalendarSettings,
);
adminSettingsRouter.post('/google-calendar/test', testGoogleCalendarSettings);
adminSettingsRouter.post('/google-calendar/sync', syncGoogleCalendarSettings);

// Google Sheets export spreadsheet. Uses the same service account as Calendar.
adminSettingsRouter.get('/google-sheets', getSheetsSettings);
adminSettingsRouter.put('/google-sheets', requireSuperPin('Google Sheets export spreadsheet'), updateSheetsSettings);
adminSettingsRouter.delete(
  '/google-sheets',
  requireSuperPin('Google Sheets export spreadsheet (reset to default)'),
  resetSheetsSettings,
);
adminSettingsRouter.post('/google-sheets/test', testSheetsSettings);

// Google Drive (PDF uploads), connected with a real Google account via OAuth.
adminSettingsRouter.get('/google-drive', getDriveSettings);
adminSettingsRouter.post('/google-drive/connect', requireSuperPin('Google Drive connection'), startDriveConnect);
adminSettingsRouter.delete(
  '/google-drive/connection',
  requireSuperPin('Google Drive disconnected'),
  disconnectDriveSettings,
);
adminSettingsRouter.post('/google-drive/test', testDriveSettings);
adminSettingsRouter.put('/google-drive/folder', requireSuperPin('Google Drive upload folder'), updateDriveFolder);
adminSettingsRouter.delete(
  '/google-drive/folder',
  requireSuperPin('Google Drive upload folder (reset to default)'),
  resetDriveFolder,
);
adminSettingsRouter.put(
  '/google-drive/credentials',
  requireSuperPin('Google Drive credentials'),
  updateDriveCredentials,
);
adminSettingsRouter.delete(
  '/google-drive/credentials',
  requireSuperPin('Google Drive credentials (reset to default)'),
  resetDriveCredentials,
);

// Automatic data backups. The schedule and destructive actions need the
// superadmin PIN; listing and downloading only need an admin session.
adminSettingsRouter.get('/backup', getBackupSettings);
adminSettingsRouter.put(
  '/backup',
  requireSuperPin((req) => `Automatic backup schedule (${req.body?.enabled ? 'enabled' : 'updated'})`),
  updateBackupSettings,
);
adminSettingsRouter.post('/backup/run', requireSuperPin('Manual data backup'), runBackupNow);
adminSettingsRouter.get('/backup/download/:name', downloadBackup);
adminSettingsRouter.delete('/backup/:name', requireSuperPin('Backup file deletion'), removeBackup);

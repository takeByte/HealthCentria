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
import { requireAuth, requireRole } from '../middleware/requireAuth.js';

export const adminSettingsRouter = Router();

// Only admins configure third-party credentials. Patients and staff keep using
// the normal sign-in buttons, which read the active public client ID.
adminSettingsRouter.use(requireAuth, requireRole('admin'));
adminSettingsRouter.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

adminSettingsRouter.get('/google', getGoogleSettings);
adminSettingsRouter.put('/google', updateGoogleSettings);
adminSettingsRouter.delete('/google', deleteGoogleSettings);

// Email delivery (SMTP). Password reset codes and announcements use it, so an
// admin can fix mail delivery without editing .env and restarting the API.
adminSettingsRouter.get('/email', getEmailSettings);
adminSettingsRouter.put('/email', updateEmailSettings);
adminSettingsRouter.delete('/email', deleteEmailSettings);
adminSettingsRouter.post('/email/test', testEmailSettings);

// Google Calendar sync is additive: the existing appointment flow continues to
// work when these env vars are absent or the admin switches sync off.
adminSettingsRouter.get('/google-calendar', getGoogleCalendarSettings);
adminSettingsRouter.patch('/google-calendar', updateGoogleCalendarSettings);
adminSettingsRouter.post('/google-calendar/test', testGoogleCalendarSettings);
adminSettingsRouter.post('/google-calendar/sync', syncGoogleCalendarSettings);

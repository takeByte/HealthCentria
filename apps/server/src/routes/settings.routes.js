import { Router } from 'express';
import { getPublicSettings, getSettings, updateSettings } from '../controllers/settings.controller.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { requireSuperPin } from '../middleware/requireSuperPin.js';

export const settingsRouter = Router();

// Public: the login page reads this to decide whether to show the Google button.
settingsRouter.get('/public', getPublicSettings);

// Everything below is admin-only configuration.
settingsRouter.use(requireAuth, requireRole('admin'));
settingsRouter.get('/', getSettings);
const SWITCH_LABELS = {
  googleSignInEnabled: 'Google sign-in',
  recaptchaEnabled: 'reCAPTCHA protection',
  notificationEmailsEnabled: 'Notification emails',
  googleSheetsEnabled: 'Google Sheets export',
};

function switchLabel(req) {
  const parts = Object.entries(req.body ?? {})
    .filter(([key, value]) => key in SWITCH_LABELS && typeof value === 'boolean')
    .map(([key, value]) => `${SWITCH_LABELS[key]} switched ${value ? 'on' : 'off'}`);
  return parts.join(', ') || 'Integration switch';
}

// Integration on/off switches need the superadmin PIN, like credential changes.
settingsRouter.patch('/', requireSuperPin(switchLabel), updateSettings);

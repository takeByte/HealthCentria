import { Router } from 'express';
import {
  deleteGoogleSettings,
  getGoogleSettings,
  updateGoogleSettings,
} from '../controllers/admin-settings.controller.js';
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

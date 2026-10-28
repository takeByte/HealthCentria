import { Router } from 'express';
import { getPublicSettings, getSettings, updateSettings } from '../controllers/settings.controller.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';

export const settingsRouter = Router();

// Public: the login page reads this to decide whether to show the Google button.
settingsRouter.get('/public', getPublicSettings);

// Everything below is admin-only configuration.
settingsRouter.use(requireAuth, requireRole('admin'));
settingsRouter.get('/', getSettings);
settingsRouter.patch('/', updateSettings);

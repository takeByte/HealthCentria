import { Router } from 'express';
import { adminSettingsRouter } from './admin-settings.routes.js';
import { announcementRouter } from './announcement.routes.js';
import { appointmentRouter } from './appointment.routes.js';
import { notificationRouter } from './notification.routes.js';
import { patientRouter } from './patient.routes.js';
import { reportRouter } from './report.routes.js';
import { staffRouter } from './staff.routes.js';
import { authRouter } from './auth.routes.js';
import { healthRouter } from './health.routes.js';
import { serviceRouter } from './service.routes.js';
import { settingsRouter } from './settings.routes.js';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/announcements', announcementRouter);
apiRouter.use('/notifications', notificationRouter);
apiRouter.use('/patients', patientRouter);
apiRouter.use('/reports', reportRouter);
apiRouter.use('/staff-accounts', staffRouter);
apiRouter.use('/services', serviceRouter);
apiRouter.use('/admin/settings', adminSettingsRouter);
apiRouter.use('/settings', settingsRouter);
apiRouter.use('/appointments', appointmentRouter);
apiRouter.use('/health', healthRouter);

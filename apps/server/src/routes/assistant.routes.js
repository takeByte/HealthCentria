import { Router } from 'express';
import { assistantChat, assistantStatus } from '../controllers/assistant.controller.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { assistantLimiter } from '../middleware/rateLimit.js';

export const assistantRouter = Router();

// Any signed-in account (patient, staff or admin). The reply is tailored to the
// role on the server; the browser cannot choose it.
assistantRouter.get('/status', requireAuth, assistantStatus);
assistantRouter.post('/chat', requireAuth, assistantLimiter, assistantChat);

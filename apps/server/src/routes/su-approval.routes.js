import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  approvalCancel,
  approvalConfirm,
  approvalDeny,
  approvalDescribe,
  approvalStatus,
} from '../controllers/su-approval.controller.js';
import { requireAuth } from '../middleware/requireAuth.js';

export const approvalRouter = Router();

approvalRouter.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// The requesting admin polls and cancels with the approval id from the PIN step.
// Registered before the public /:token routes so "status" is never read as a token.
// Ownership (same user as the PIN step) is checked in the service, so any signed-in role is fine.
approvalRouter.get('/status/:id', requireAuth, approvalStatus);
approvalRouter.delete('/status/:id', requireAuth, approvalCancel);

// The superadmin opens the emailed link: no sign-in, rate limited per IP.
const linkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, code: 'RATE_LIMITED', message: 'Too many attempts. Try again in a few minutes.' },
});
approvalRouter.get('/:token', linkLimiter, approvalDescribe);
approvalRouter.post('/:token/confirm', linkLimiter, approvalConfirm);
approvalRouter.post('/:token/deny', linkLimiter, approvalDeny);

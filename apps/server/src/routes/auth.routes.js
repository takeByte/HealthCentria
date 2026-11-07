import { Router } from 'express';
import {
  changePassword,
  googleCallback,
  googleConfig,
  googleStart,
  login,
  logout,
  me,
  register,
  updateMe,
} from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { loginLimiter, passwordChangeLimiter, registerLimiter } from '../middleware/rateLimit.js';
import { verifyCaptcha } from '../middleware/verifyCaptcha.js';

export const authRouter = Router();

// Order matters: throttle the IP, then verify the bot challenge, and only then
// run the controller (which touches the database).
authRouter.post('/register', registerLimiter, verifyCaptcha, register);
authRouter.post('/login', loginLimiter, verifyCaptcha, login);
authRouter.post('/logout', requireAuth, logout);
authRouter.get('/me', requireAuth, me);
// Self-service for staff/admin. Patients keep using the patient profile flow.
authRouter.patch('/me', requireAuth, updateMe);
authRouter.post('/change-password', requireAuth, passwordChangeLimiter, changePassword);
authRouter.get('/google/config', googleConfig);
authRouter.get('/google', googleStart);
authRouter.get('/google/callback', googleCallback);

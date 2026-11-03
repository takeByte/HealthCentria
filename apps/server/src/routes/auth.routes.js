import { Router } from 'express';
import {
  googleCallback,
  googleConfig,
  googleStart,
  login,
  logout,
  me,
  register,
} from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { loginLimiter, registerLimiter } from '../middleware/rateLimit.js';
import { verifyCaptcha } from '../middleware/verifyCaptcha.js';

export const authRouter = Router();

// Order matters: throttle the IP, then verify the bot challenge, and only then
// run the controller (which touches the database).
authRouter.post('/register', registerLimiter, verifyCaptcha, register);
authRouter.post('/login', loginLimiter, verifyCaptcha, login);
authRouter.post('/logout', requireAuth, logout);
authRouter.get('/me', requireAuth, me);
authRouter.get('/google/config', googleConfig);
authRouter.get('/google', googleStart);
authRouter.get('/google/callback', googleCallback);

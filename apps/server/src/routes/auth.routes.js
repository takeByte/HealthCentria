import { Router } from 'express';
import {
  googleCallback,
  googleConfig,
  googleStart,
  login,
  me,
  register,
} from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/requireAuth.js';

export const authRouter = Router();

authRouter.post('/register', register);
authRouter.post('/login', login);
authRouter.get('/me', requireAuth, me);
authRouter.get('/google/config', googleConfig);
authRouter.get('/google', googleStart);
authRouter.get('/google/callback', googleCallback);

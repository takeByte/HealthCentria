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
import { changePassword, requestPasswordReset, resetPassword } from '../controllers/password.controller.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { loginLimiter, passwordResetLimiter, registerLimiter } from '../middleware/rateLimit.js';
import { verifyCaptcha } from '../middleware/verifyCaptcha.js';

export const authRouter = Router();

// Order matters: throttle the IP, then verify the bot challenge, and only then
// run the controller (which touches the database).
authRouter.post('/register', registerLimiter, verifyCaptcha, register);
authRouter.post('/login', loginLimiter, verifyCaptcha, login);
// Password reset is public (the user cannot sign in), so it is throttled and
// the request step is CAPTCHA-guarded to prevent email bombing.
authRouter.post('/password/forgot', passwordResetLimiter, verifyCaptcha, requestPasswordReset);
authRouter.post('/password/reset', passwordResetLimiter, resetPassword);
authRouter.put('/password', requireAuth, changePassword);

authRouter.post('/logout', requireAuth, logout);
authRouter.get('/me', requireAuth, me);
authRouter.get('/google/config', googleConfig);
authRouter.get('/google', googleStart);
authRouter.get('/google/callback', googleCallback);

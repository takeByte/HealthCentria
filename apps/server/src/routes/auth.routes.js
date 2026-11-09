import { Router } from 'express';
import {
  // Staff/admin profile page (POST /change-password); the account-menu dialog
  // uses changePassword from password.controller.js (PUT /password).
  changePassword as changeStaffPassword,
  googleCallback,
  googleConfig,
  googleStart,
  login,
  logout,
  me,
  register,
  updateMe,
} from '../controllers/auth.controller.js';
import { changePassword, requestPasswordReset, resetPassword } from '../controllers/password.controller.js';
import {
  confirmEmailVerification,
  requestEmailVerification,
} from '../controllers/email-verification.controller.js';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  emailVerificationLimiter,
  loginLimiter,
  passwordChangeLimiter,
  passwordResetLimiter,
  registerLimiter,
} from '../middleware/rateLimit.js';
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

// Email verification. Authenticated: a code only ever goes to the account's own
// address, so the public registration form cannot be used to mail strangers.
authRouter.post('/email/verify/request', requireAuth, emailVerificationLimiter, requestEmailVerification);
authRouter.post('/email/verify/confirm', requireAuth, emailVerificationLimiter, confirmEmailVerification);

authRouter.post('/logout', requireAuth, logout);
authRouter.get('/me', requireAuth, me);
// Self-service for staff/admin. Patients keep using the patient profile flow.
authRouter.patch('/me', requireAuth, updateMe);
authRouter.post('/change-password', requireAuth, passwordChangeLimiter, changeStaffPassword);
authRouter.get('/google/config', googleConfig);
authRouter.get('/google', googleStart);
authRouter.get('/google/callback', googleCallback);

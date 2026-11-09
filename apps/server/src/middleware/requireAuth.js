import mongoose from 'mongoose';
import { User } from '../models/user.model.js';
import { verifySession } from '../utils/tokens.js';
import { hasPermission } from '../utils/permissions.js';

/**
 * Verify the Bearer token, then confirm the account still matches it.
 *
 * The token is signed, but it can be up to JWT_EXPIRES_IN old. Re-reading the
 * user means a deactivated account, a demoted staff member, or a password reset
 * takes effect on the next request instead of when the token expires.
 */
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }

  let payload;
  try {
    payload = verifySession(token);
  } catch {
    return res.status(401).json({ success: false, message: 'Session expired. Log in again.' });
  }

  if (!mongoose.isValidObjectId(payload.sub)) {
    return res.status(401).json({ success: false, message: 'Session expired. Log in again.' });
  }

  // Without a database there is nothing to compare against. Routes that need
  // data already fail with their own 503; this must not hang on a buffered query.
  if (mongoose.connection.readyState !== 1) {
    req.user = { id: String(payload.sub), role: payload.role };
    return next();
  }

  try {
    const user = await User.findById(payload.sub).select('role active tokenVersion').lean();
    if (!user || !user.active) {
      return res.status(401).json({ success: false, message: 'Session is no longer valid. Log in again.' });
    }
    if ((user.tokenVersion ?? 0) !== Number(payload.ver ?? 0)) {
      return res.status(401).json({
        success: false,
        code: 'SESSION_REVOKED',
        message: 'Your password was changed. Log in again.',
      });
    }
    // Trust the database, not the claim: a role change must win immediately.
    req.user = { id: String(user._id), role: user.role };
    return next();
  } catch (error) {
    console.error('Auth user lookup failed:', error instanceof Error ? error.message : 'unknown error');
    return res.status(503).json({ success: false, message: 'Could not verify your session. Try again later.' });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Not allowed for your role.' });
    }
    return next();
  };
}

/**
 * Gate a route behind one or more staff capabilities. Admins always pass.
 * The account is read from the database on every check so an admin revoking a
 * permission takes effect immediately, even for an already signed-in staff
 * member. Any one of the listed permissions is enough.
 */
export function requirePermission(...required) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }
    if (req.user.role === 'admin') return next();
    try {
      const user = await User.findById(req.user.id).select('role active permissions').lean();
      if (!user || !user.active) {
        return res.status(403).json({ success: false, message: 'This account is inactive.' });
      }
      if (!hasPermission(user, ...required)) {
        return res.status(403).json({
          success: false,
          message: 'Your account does not have access to this action. Ask an admin to update your permissions.',
        });
      }
      req.user.permissions = user.permissions;
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

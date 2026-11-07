import { verifySession } from '../utils/tokens.js';
import { User } from '../models/user.model.js';
import { hasPermission } from '../utils/permissions.js';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }
  try {
    const payload = verifySession(token);
    req.user = { id: payload.sub, role: payload.role };
    return next();
  } catch {
    return res.status(401).json({ success: false, message: 'Session expired. Log in again.' });
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

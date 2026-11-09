import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export function signSession(user) {
  return jwt.sign(
    {
      sub: String(user._id),
      role: user.role,
      // Compared against the stored value on every request so a password change
      // can invalidate tokens that were issued before it.
      ver: Number(user.tokenVersion ?? 0),
    },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN },
  );
}

export function verifySession(token) {
  return jwt.verify(token, env.JWT_SECRET);
}

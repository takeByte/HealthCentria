import { isNotificationEmailEnabled } from '../models/app-settings.model.js';
import { Notification } from '../models/notification.model.js';
import { User } from '../models/user.model.js';
import { sendEmail } from './email.js';

/** Create one notification unless the same key already exists (idempotent reminders). */
export async function notifyUser(userId, { type, title, body = '', link = '', key }) {
  if (key) {
    const existing = await Notification.findOne({ recipient: userId, key }).lean();
    if (existing) return existing;
  }
  return Notification.create({ recipient: userId, type, title, body, link, key });
}

/** Notify every active user in the given roles (e.g. staff/admin for new requests). */
export async function notifyRoles(roles, { type, title, body = '', link = '', keyPrefix }) {
  const users = await User.find({ role: { $in: roles }, active: true }).select('_id').lean();
  const docs = [];
  for (const u of users) {
    const key = keyPrefix ? `${keyPrefix}:${u._id}` : undefined;
    if (key) {
      const existing = await Notification.findOne({ recipient: u._id, key }).lean();
      if (existing) continue;
    }
    docs.push({ recipient: u._id, type, title, body, link, key });
  }
  if (docs.length > 0) await Notification.insertMany(docs);
  return docs.length;
}

/**
 * Best-effort notification email (appointment updates, reminders) — logs and
 * swallows failures so requests never break on email. Skipped while an admin
 * has notification emails switched off; the in-app notification still exists.
 * Never use this for security codes: those must always be delivered.
 */
export async function notifyEmail(to, subject, text) {
  if (!to) return;
  if (!(await isNotificationEmailEnabled())) return;
  await sendEmail(to, subject, text);
}

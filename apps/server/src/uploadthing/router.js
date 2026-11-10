import mongoose from 'mongoose';
import { createUploadthing } from 'uploadthing/express';
import { UploadThingError } from 'uploadthing/server';
import { isUploadThingEnabled } from '../models/app-settings.model.js';
import { User } from '../models/user.model.js';
import { hasPermission } from '../utils/permissions.js';
import { verifySession } from '../utils/tokens.js';

const f = createUploadthing();

/**
 * Same rules as the announcement routes: a valid Bearer token for an active
 * admin, or an active staff member holding `announcements.manage`. Patients and
 * anonymous visitors can never mint an upload URL.
 */
async function authorizeAnnouncementUploader(req) {
  if (!(await isUploadThingEnabled())) {
    throw new UploadThingError('Image uploads are turned off by an admin.');
  }
  const [scheme, token] = (req.headers.authorization ?? '').split(' ');
  if (scheme !== 'Bearer' || !token) throw new UploadThingError('Sign in to upload images.');

  let payload;
  try {
    payload = verifySession(token);
  } catch {
    throw new UploadThingError('Session expired. Log in again.');
  }
  if (!mongoose.isValidObjectId(payload.sub) || mongoose.connection.readyState !== 1) {
    throw new UploadThingError('Could not verify your session.');
  }

  const user = await User.findById(payload.sub).select('role active tokenVersion permissions').lean();
  if (!user || !user.active || (user.tokenVersion ?? 0) !== Number(payload.ver ?? 0)) {
    throw new UploadThingError('Session is no longer valid. Log in again.');
  }
  const allowed =
    user.role === 'admin' || (user.role === 'staff' && hasPermission(user, 'announcements.manage'));
  if (!allowed) throw new UploadThingError('Your account cannot upload announcement images.');
  return { userId: String(user._id) };
}

export const uploadRouter = {
  announcementImage: f({
    image: { maxFileSize: '8MB', maxFileCount: 4 },
  })
    .middleware(({ req }) => authorizeAnnouncementUploader(req))
    .onUploadComplete(({ metadata, file }) => ({
      uploadedBy: metadata.userId,
      url: file.ufsUrl ?? file.url,
      key: file.key,
      name: file.name,
    })),
};

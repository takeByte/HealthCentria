import mongoose from 'mongoose';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { Announcement } from '../models/announcement.model.js';
import { User } from '../models/user.model.js';
import { announcementEmailText, sendEmail } from '../utils/email.js';
import { notifyRoles } from '../utils/notifications.js';

const CATEGORIES = ['schedule-change', 'vaccination-day', 'health-advisory', 'general'];

const announcementBody = z.object({
  title: z.string().trim().min(1, 'Title is required.').max(200),
  body: z.string().trim().min(1, 'Message is required.').max(5000),
  category: z.enum(CATEGORIES).optional().default('general'),
  pinned: z.boolean().optional().default(false),
  active: z.boolean().optional().default(true),
});

function requireDB(res) {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({ success: false, message: 'Database is not connected. Try again later.' });
    return false;
  }
  return true;
}

function present(a) {
  return {
    id: String(a._id),
    title: a.title,
    body: a.body,
    category: a.category,
    pinned: a.pinned,
    publishedAt: a.publishedAt,
  };
}

async function emailPatients(announcement) {
  // Per-post email to registered patients (spec §4.9). Fire-and-forget safe: never throws.
  const patients = await User.find({ role: 'patient', active: true }).select('email').lean();
  const recipients = patients.map((p) => p.email).filter(Boolean);
  if (recipients.length === 0) return;
  await sendEmail(recipients, `E-Kalinga: ${announcement.title}`, announcementEmailText(announcement));
}

export const listAnnouncements = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  // Public feed: active only, pinned first, newest first.
  const items = await Announcement.find({ active: true }).sort({ pinned: -1, publishedAt: -1 }).lean();
  res.json({ success: true, announcements: items.map(present) });
});

export const createAnnouncement = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const parsed = announcementBody.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }
  const item = await Announcement.create({ ...parsed.data, publishedAt: new Date(), createdBy: req.user.id });
  // In-app bell is awaited (must exist when patients reload); email stays background.
  await notifyRoles(['patient'], {
    type: 'new-announcement',
    title: item.title,
    body: 'New announcement from the health center.',
    link: '/app/announcements',
    keyPrefix: `new-announcement:${item._id}`,
  }).catch(() => {});
  emailPatients(item.toObject()).catch(() => {});
  res.status(201).json({ success: true, announcement: present(item.toObject()) });
});

export const updateAnnouncement = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const parsed = announcementBody.partial().safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }
  const item = await Announcement.findByIdAndUpdate(req.params.id, parsed.data, { new: true, runValidators: true });
  if (!item) return res.status(404).json({ success: false, message: 'Announcement not found.' });
  res.json({ success: true, announcement: present(item.toObject()) });
});

export const deleteAnnouncement = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const item = await Announcement.findByIdAndDelete(req.params.id);
  if (!item) return res.status(404).json({ success: false, message: 'Announcement not found.' });
  res.json({ success: true });
});

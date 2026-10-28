import 'dotenv/config';
import { connectDB, disconnectDB } from '../config/db.js';
import { Announcement } from '../models/announcement.model.js';
import { notifyRoles } from '../utils/notifications.js';

// Demo announcements so the patient feed, dashboard preview and notification
// bell have something real to render. Idempotent: matches by title and updates
// in place, so re-running never duplicates a post or a bell notification.
//
// Usage: node src/scripts/seed-announcements.js

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY);

const POSTS = [
  {
    title: 'Family Planning service moves to Thursday afternoons',
    body:
      'Starting October 29, Family Planning consultations will be held every Thursday from 1:00 PM to 4:00 PM instead of the morning slot. ' +
      'If you already have a confirmed booking for a Thursday morning, staff will call you to move it. ' +
      'Walk-ins are still welcome any Thursday afternoon while slots last.',
    category: 'schedule-change',
    pinned: true,
    publishedAt: daysAgo(1),
  },
  {
    title: 'Routine immunization for newborns — 2nd Wednesday, November 11',
    body:
      'The next immunization day for newborns is Wednesday, November 11, 8:00 AM to 3:00 PM. ' +
      'Please bring your baby\'s immunization card (or the green booklet from the hospital) and your own pen. ' +
      'Mothers who delivered within the last 6 weeks can also have their postpartum check done on the same visit — just tell the nurse at the desk.',
    category: 'vaccination-day',
    pinned: false,
    publishedAt: daysAgo(3),
  },
  {
    title: 'Dengue watch: empty standing water around your home',
    body:
      'With the rainy season here, please check your surroundings once a week for standing water in tires, drums, flower pots and roof gutters. ' +
      'Cover water containers, and see a doctor the same day if anyone in the household has fever with body aches, rash, or bleeding gums. ' +
      'The center can do an initial dengue assessment during consultation hours — no appointment needed for fever cases.',
    category: 'health-advisory',
    pinned: false,
    publishedAt: daysAgo(6),
  },
  {
    title: 'Free blood pressure check every Monday',
    body:
      'Hypertensive patients can have their blood pressure checked for free every Monday, 8:00 AM to 4:00 PM, at the monitoring station beside the front desk. ' +
      'Bring your maintenance medicines so the nurse can record what you are currently taking. ' +
      'No booking needed — but if you also need a consultation, please book ahead so you skip the queue.',
    category: 'general',
    pinned: false,
    publishedAt: daysAgo(9),
  },
];

async function main() {
  if (!process.env.MONGODB_URI || process.env.MONGODB_URI.includes('<user>')) {
    console.error('MONGODB_URI is missing or still a placeholder — set it in apps/server/.env first.');
    process.exit(2);
  }
  await connectDB(process.env.MONGODB_URI);
  try {
    for (const post of POSTS) {
      const doc = await Announcement.findOneAndUpdate(
        { title: post.title },
        { ...post, active: true },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );
      // Mirror what the admin create endpoint does, so the bell has real items.
      await notifyRoles(['patient'], {
        type: 'new-announcement',
        title: doc.title,
        body: 'New announcement from the health center.',
        link: '/app/announcements',
        keyPrefix: `new-announcement:${doc._id}`,
      }).catch(() => {});
      console.log(`${doc.pinned ? '★' : '·'} ${doc.title}`);
    }
    console.log(`Seeded ${POSTS.length} announcements.`);
  } finally {
    await disconnectDB();
  }
}

main().catch((err) => {
  console.error('Seeding announcements failed:', err.message);
  process.exit(1);
});

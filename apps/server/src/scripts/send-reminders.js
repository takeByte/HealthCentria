import 'dotenv/config';
import { connectDB, disconnectDB } from '../config/db.js';
import { Appointment } from '../models/appointment.model.js';
import { notifyEmail, notifyUser } from '../utils/notifications.js';

// Day-before reminders for confirmed appointments (spec §4.12).
// Run once daily (e.g. Windows Task Scheduler, 7pm):
//   node src/scripts/send-reminders.js
// Idempotent: one reminder per appointment per day (dedupe key), so re-runs are safe.

function tomorrowYMD() {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

async function main() {
  if (!process.env.MONGODB_URI || process.env.MONGODB_URI.includes('<user>')) {
    console.error('MONGODB_URI is missing or still a placeholder — set it in apps/server/.env first.');
    process.exit(2);
  }
  const tomorrow = tomorrowYMD();
  await connectDB(process.env.MONGODB_URI);
  try {
    const due = await Appointment.find({ day: tomorrow, status: 'confirmed' })
      .populate('patient', 'fullName email active')
      .populate('service', 'name')
      .lean();
    let reminded = 0;
    for (const a of due) {
      if (!a.patient || a.patient.active === false) continue;
      const title = `Reminder: ${a.service.name} tomorrow (${a.day})`;
      const body = 'Your appointment is tomorrow. Please arrive on time and bring a valid ID.';
      await notifyUser(a.patient._id, {
        type: 'reminder',
        title,
        body,
        link: '/app/appointments',
        key: `reminder:${a._id}:${a.day}`,
      });
      await notifyEmail(
        a.patient.email,
        `E-Kalinga: reminder — ${a.service.name} tomorrow`,
        `Reminder: your ${a.service.name} appointment is tomorrow (${a.day}).\n\nPlease arrive on time and bring a valid ID.\n\n— E-Kalinga Barangay Health Center`,
      );
      reminded += 1;
    }
    console.log(`Reminders for ${tomorrow}: ${reminded} confirmed appointment(s) notified.`);
  } finally {
    await disconnectDB();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

import 'dotenv/config';
import { connectDB, disconnectDB } from '../config/db.js';
import {
  isGoogleCalendarConfigured,
  retryPendingCalendarSync,
  syncUpcomingAppointments,
} from '../services/google-calendar.js';

/**
 * Retry failed calendar writes and backfill upcoming confirmed appointments.
 *
 * Run manually or from a scheduler:
 *   pnpm --filter @healthcentria/server sync:calendar
 *
 * This script is optional. Appointment confirmation already triggers a
 * best-effort sync; the script catches up after downtime or Google errors.
 */
async function main() {
  if (!isGoogleCalendarConfigured()) {
    console.log('Google Calendar is not configured — nothing to sync.');
    return;
  }
  if (!process.env.MONGODB_URI || process.env.MONGODB_URI.includes('<user>')) {
    console.error('MONGODB_URI is missing or still a placeholder.');
    process.exitCode = 2;
    return;
  }

  await connectDB(process.env.MONGODB_URI);
  try {
    const retried = await retryPendingCalendarSync({ limit: 100 });
    const upcoming = await syncUpcomingAppointments({ limit: 100 });
    console.log(
      `Calendar retry: ${retried.ok}/${retried.total} ok, ${retried.failed} failed, ${retried.skipped} skipped.`,
    );
    console.log(
      `Upcoming backfill: ${upcoming.ok}/${upcoming.total} ok, ${upcoming.failed} failed, ${upcoming.skipped} skipped.`,
    );
  } finally {
    await disconnectDB();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

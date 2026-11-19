import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../config/db.js';
import { env } from '../config/env.js';

// One-time, safe migration: give every announcement that has no `version` yet version 0.
//
//   node src/scripts/migrate-add-version.js           -> dry run (only counts)
//   node src/scripts/migrate-add-version.js --apply   -> writes
//
// Safe to re-run: it only touches documents where `version` does not exist, and it never
// changes any other field. (The server also treats a missing version as 0, so skipping this
// script does not break anything; it just means Atlas will not show the field yet.)

const apply = process.argv.includes('--apply');
// Add more collection names here to version other collections later.
// Run it once after deploying the `version` field (announcements, users, appointments).
const COLLECTIONS = ['announcements', 'users', 'appointments'];

try {
  await connectDB(env.MONGODB_URI);
  console.log(`Database: ${mongoose.connection.name}`);
  for (const name of COLLECTIONS) {
    const col = mongoose.connection.db.collection(name);
    const missing = await col.countDocuments({ version: { $exists: false } });
    console.log(`${name}: ${missing} document(s) without "version"`);
    if (apply && missing > 0) {
      const r = await col.updateMany({ version: { $exists: false } }, { $set: { version: 0 } });
      console.log(`${name}: set version=0 on ${r.modifiedCount} document(s)`);
    }
  }
  if (!apply) console.log('Dry run only. Re-run with --apply to write.');
} catch (err) {
  console.error('Migration failed:', err.message);
  process.exitCode = 1;
} finally {
  await disconnectDB().catch(() => {});
}

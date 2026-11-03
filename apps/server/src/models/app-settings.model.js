import mongoose from 'mongoose';

// One document holds the platform-wide switches an admin can flip at runtime.
// Keeping it in a single row avoids scattering toggles across collections and
// makes reads cheap (one indexed lookup by `key`).
const appSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    // Google sign-in is on by default; an admin can turn it off from Settings.
    googleSignInEnabled: { type: Boolean, default: true },
    // Mirrors confirmed appointments to the clinic Google Calendar when the
    // service account is configured. The toggle only stops automatic writes;
    // cancelling an appointment still removes any event already on the calendar.
    googleCalendarSyncEnabled: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const SETTINGS_KEY = 'platform';

export const AppSettings =
  mongoose.models.AppSettings ?? mongoose.model('AppSettings', appSettingsSchema);

/**
 * True unless an admin has switched Google sign-in off.
 *
 * Reads fail open when the database is unreachable: the Google callback needs
 * the database anyway and already fails with `db_unavailable`, and failing
 * closed here would also break the login page's public status check.
 */
export async function isGoogleSignInEnabled() {
  if (mongoose.connection.readyState !== 1) return true;
  const doc = await AppSettings.findOne({ key: SETTINGS_KEY }).lean();
  return doc?.googleSignInEnabled !== false;
}

/**
 * True unless an admin has switched calendar sync off.
 *
 * Fails open when the database is unreachable: without a database the
 * appointment itself cannot be saved, so there is nothing to sync anyway.
 */
export async function isGoogleCalendarSyncEnabled() {
  if (mongoose.connection.readyState !== 1) return true;
  const doc = await AppSettings.findOne({ key: SETTINGS_KEY }).lean();
  return doc?.googleCalendarSyncEnabled !== false;
}

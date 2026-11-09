import mongoose from 'mongoose';

// One document holds the platform-wide switches an admin can flip at runtime.
// Keeping it in a single row avoids scattering toggles across collections and
// makes reads cheap (one indexed lookup by `key`).
const appSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    // Google sign-in is on by default; an admin can turn it off from Settings.
    googleSignInEnabled: { type: Boolean, default: true },
    // CAPTCHA is on by default; an admin can disable it from Settings.
    recaptchaEnabled: { type: Boolean, default: true },
    // Mirrors confirmed appointments to the clinic Google Calendar when the
    // service account is configured. The toggle only stops automatic writes;
    // cancelling an appointment still removes any event already on the calendar.
    googleCalendarSyncEnabled: { type: Boolean, default: true },
    // Notification emails: announcements, appointment confirmed/declined, and
    // reminders. Off stops those emails only — they still appear in the app.
    // Security codes (password reset, email verification) ignore this switch.
    notificationEmailsEnabled: { type: Boolean, default: true },
    // Custom Google Sheets export spreadsheet. Empty = use the .env default.
    // Not a secret (only people it is shared with can open it), so stored plain.
    googleSheetsSpreadsheetId: { type: String, default: '' },
    // Google Sheets export on/off. Off blocks new exports; existing tabs stay.
    googleSheetsEnabled: { type: Boolean, default: true },
    // Google Drive uploads of exported PDFs (and the emails with their links).
    googleDriveEnabled: { type: Boolean, default: true },
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

/** True unless an admin has switched reCAPTCHA off. */
export async function isRecaptchaEnabled() {
  if (mongoose.connection.readyState !== 1) return true;
  const doc = await AppSettings.findOne({ key: SETTINGS_KEY }).lean();
  return doc?.recaptchaEnabled !== false;
}

/**
 * True unless an admin has switched notification emails off. Fails open when
 * the database is unreachable, matching the other switches.
 */
export async function isNotificationEmailEnabled() {
  if (mongoose.connection.readyState !== 1) return true;
  const doc = await AppSettings.findOne({ key: SETTINGS_KEY }).lean();
  return doc?.notificationEmailsEnabled !== false;
}

/** True unless an admin has switched Google Sheets export off. */
export async function isGoogleSheetsEnabled() {
  if (mongoose.connection.readyState !== 1) return true;
  const doc = await AppSettings.findOne({ key: SETTINGS_KEY }).lean();
  return doc?.googleSheetsEnabled !== false;
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

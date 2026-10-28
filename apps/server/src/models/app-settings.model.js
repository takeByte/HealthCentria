import mongoose from 'mongoose';

// One document holds the platform-wide switches an admin can flip at runtime.
// Keeping it in a single row avoids scattering toggles across collections and
// makes reads cheap (one indexed lookup by `key`).
const appSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    // Google sign-in is on by default; an admin can turn it off from Settings.
    googleSignInEnabled: { type: Boolean, default: true },
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

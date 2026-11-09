import mongoose from 'mongoose';

// Provider credentials configured by an admin at runtime. Only one row per
// provider; when there is no row the server falls back to the .env defaults.
const integrationSettingSchema = new mongoose.Schema(
  {
    provider: { type: String, required: true, enum: ['google', 'google-drive'], unique: true, index: true },
    clientId: { type: String, required: true, trim: true },
    // AES-256-GCM payload: iv + auth tag + ciphertext. Never store the secret
    // in plain text — the server must decrypt it to talk to Google.
    clientSecretEncrypted: { type: String, required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

export const GOOGLE_PROVIDER = 'google';
// OAuth client used for Google Drive uploads (separate from Google sign-in).
export const GOOGLE_DRIVE_PROVIDER = 'google-drive';

export const IntegrationSetting =
  mongoose.models.IntegrationSetting ?? mongoose.model('IntegrationSetting', integrationSettingSchema);

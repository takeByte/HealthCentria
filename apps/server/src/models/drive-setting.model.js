import mongoose from 'mongoose';

// Google Drive connection made from Settings → Google Drive → Connect. A single
// row. The refresh token lets the server upload as the connected Google
// account (a service account has no Drive storage), so it is encrypted at rest
// and never sent to the browser.
const driveSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'google-drive' },
    // AES-256-GCM payload (iv + auth tag + ciphertext). Empty when disconnected.
    refreshTokenEncrypted: { type: String, default: '' },
    accountEmail: { type: String, default: '' },
    connectedAt: { type: Date, default: null },
    connectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Folder the uploads go to. Either the .env folder (if the app can write
    // to it) or a folder the app created itself on connect.
    folderId: { type: String, default: '' },
    folderName: { type: String, default: '' },
    // Set when Google rejects the refresh token (e.g. the 7-day Testing limit).
    needsReconnect: { type: Boolean, default: false },
    lastError: { type: String, default: '' },
    lastUploadAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const DRIVE_SETTINGS_KEY = 'google-drive';

export const DriveSetting =
  mongoose.models.DriveSetting ?? mongoose.model('DriveSetting', driveSettingSchema);

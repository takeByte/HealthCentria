import mongoose from 'mongoose';

// UploadThing API token an admin can set from Settings → Upload Image. A single
// row: when it is absent the server falls back to UPLOADTHING_TOKEN in .env.
const uploadThingSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'uploadthing' },
    // AES-256-GCM payload: iv + auth tag + ciphertext. Never stored in plain text.
    tokenEncrypted: { type: String, required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

export const UPLOADTHING_SETTINGS_KEY = 'uploadthing';

export const UploadThingSetting =
  mongoose.models.UploadThingSetting ?? mongoose.model('UploadThingSetting', uploadThingSettingSchema);

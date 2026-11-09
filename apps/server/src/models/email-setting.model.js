import mongoose from 'mongoose';

// SMTP credentials an admin can set from Settings → Email delivery. A single
// row: when it is absent the server falls back to the SMTP_* values in .env.
const emailSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'smtp' },
    host: { type: String, required: true, trim: true },
    port: { type: Number, required: true, min: 1, max: 65535, default: 587 },
    user: { type: String, required: true, trim: true },
    // AES-256-GCM payload: iv + auth tag + ciphertext. Never stored in plain
    // text — the server decrypts it only when opening an SMTP connection.
    passwordEncrypted: { type: String, required: true },
    // Visible sender. Blank means "use MAIL_FROM / RESEND_FROM from .env".
    fromAddress: { type: String, default: '', trim: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Result of the most recent "Send test email" so the UI can show it.
    lastTestedAt: { type: Date, default: null },
    lastTestOk: { type: Boolean, default: null },
    lastTestError: { type: String, default: '', trim: true },
  },
  { timestamps: true },
);

export const EMAIL_SETTINGS_KEY = 'smtp';

export const EmailSetting =
  mongoose.models.EmailSetting ?? mongoose.model('EmailSetting', emailSettingSchema);

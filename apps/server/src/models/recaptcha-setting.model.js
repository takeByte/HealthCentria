import mongoose from 'mongoose';

// reCAPTCHA keys an admin can set from Settings → reCAPTCHA protection. A
// single row: when it is absent the server falls back to the RECAPTCHA_*
// values in .env. The site key is public; the secret key is encrypted.
const recaptchaSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'recaptcha' },
    siteKey: { type: String, required: true, trim: true },
    // AES-256-GCM payload: iv + auth tag + ciphertext. Never stored in plain
    // text — the server decrypts it only when verifying a challenge.
    secretKeyEncrypted: { type: String, required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

export const RECAPTCHA_SETTINGS_KEY = 'recaptcha';

export const RecaptchaSetting =
  mongoose.models.RecaptchaSetting ?? mongoose.model('RecaptchaSetting', recaptchaSettingSchema);

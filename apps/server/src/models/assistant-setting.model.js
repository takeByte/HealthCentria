import mongoose from 'mongoose';

// AI assistant (Cloudflare Workers AI) settings an admin can change from
// Settings → AI Assistant. A single row. Anything missing falls back to the
// CLOUDFLARE_* / ASSISTANT_ENABLED values in .env. The account ID is not a
// secret; the API token is stored encrypted.
const assistantSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'assistant' },
    accountId: { type: String, default: '', trim: true },
    // AES-256-GCM payload: iv + auth tag + ciphertext. Never stored in plain text.
    apiTokenEncrypted: { type: String, default: '' },
    // Workers AI model id, e.g. @cf/meta/llama-3.1-8b-instruct. Empty = server default.
    model: { type: String, default: '', trim: true },
    // Set when an admin flips the switch; undefined = follow the server default.
    enabled: { type: Boolean },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

export const ASSISTANT_SETTINGS_KEY = 'assistant';

export const AssistantSetting =
  mongoose.models.AssistantSetting ?? mongoose.model('AssistantSetting', assistantSettingSchema);

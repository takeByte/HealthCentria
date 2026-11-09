import mongoose from 'mongoose';

// One-time codes delivered by email. Only the hash is stored, so a database
// dump cannot be replayed against the API.
const verificationCodeSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    // Scoped so a reset code can never be replayed as a login/verification code.
    purpose: {
      type: String,
      required: true,
      enum: ['password_reset', 'email_verification'],
      default: 'password_reset',
    },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    consumedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// TTL index: Mongo removes rows shortly after they expire.
verificationCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
verificationCodeSchema.index({ email: 1, purpose: 1, createdAt: -1 });

export const VerificationCode =
  mongoose.models.VerificationCode ?? mongoose.model('VerificationCode', verificationCodeSchema);

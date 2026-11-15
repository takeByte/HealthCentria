import mongoose from 'mongoose';

// Remembers recent "create" requests so a repeat (double-click, retry after a
// timeout) returns the first result instead of creating a second record.
// One row per (who, route, key). `expiresAt` also drives a TTL index, so old rows
// remove themselves.
const idempotencyKeySchema = new mongoose.Schema(
  {
    scope: { type: String, required: true }, // hash of the caller's token, never the token itself
    route: { type: String, required: true },
    key: { type: String, required: true },
    state: { type: String, enum: ['processing', 'done'], required: true },
    statusCode: { type: Number, default: null },
    // JSON text of the response that is replayed.
    bodyJson: { type: String, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

idempotencyKeySchema.index({ scope: 1, route: 1, key: 1 }, { unique: true });
idempotencyKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const IdempotencyKey =
  mongoose.models.IdempotencyKey ?? mongoose.model('IdempotencyKey', idempotencyKeySchema);

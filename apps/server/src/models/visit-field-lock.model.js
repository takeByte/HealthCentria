import mongoose from 'mongoose';

/**
 * Pessimistic edit locks for one clinical section of one visit.
 *
 * A lock is per (appointment, section) so staff can work on different sections
 * of the same visit at once, while nobody can type into a section somebody else
 * already owns. It is a lease: the holder renews it, and an unrenewed lock
 * expires so a closed tab cannot freeze a section forever.
 *
 * The unique index makes the claim atomic: two simultaneous claims cannot both
 * win. The TTL index is the cleanup backstop; every read also compares
 * `expiresAt` with the clock, so an expired row never blocks anybody.
 */
const visitFieldLockSchema = new mongoose.Schema(
  {
    // String, not ObjectId: the API accepts the id from the route as-is.
    appointmentId: { type: String, required: true },
    section: {
      type: String,
      required: true,
      enum: ['diagnosis', 'prescription', 'visitNotes'],
    },
    // Per-tab token made by the browser. Not a login token.
    owner: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Stored server-side (looked up from the user), so a client cannot claim
    // somebody else's name in the "X is editing" banner.
    userName: { type: String, required: true },
    nonce: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

visitFieldLockSchema.index({ appointmentId: 1, section: 1 }, { unique: true });
visitFieldLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const VisitFieldLock =
  mongoose.models.VisitFieldLock ?? mongoose.model('VisitFieldLock', visitFieldLockSchema);

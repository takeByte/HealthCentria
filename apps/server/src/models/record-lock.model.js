import mongoose from 'mongoose';

/**
 * A pessimistic edit lock for one editable record.
 *
 * The visit record uses field-level locks because its clinical sections are
 * independent. Records edited through a single form (an announcement, a
 * service) only need one lock per record: while a tab has the form open, nobody
 * else should be able to open the same form and type a change that will later
 * be refused.
 *
 * Like the visit locks it is a lease, not a permanent claim:
 *   - the holder renews every minute and the lease expires after ten;
 *   - one unique index makes the claim atomic;
 *   - the TTL index is cleanup only; every read compares `expiresAt`, so an
 *     expired row never blocks anybody.
 *
 * The optimistic version check still decides whether a save wins. This lock
 * only stops the wasted typing.
 */
const recordLockSchema = new mongoose.Schema(
  {
    // 'announcements' | 'services' — see the registry in the controller.
    resource: { type: String, required: true },
    // String: the API takes the route id as-is, like the visit lock.
    resourceId: { type: String, required: true },
    // Per-tab token made by the browser. Not a login token.
    owner: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Looked up from the account, so a client cannot claim somebody else's name.
    userName: { type: String, required: true },
    nonce: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

recordLockSchema.index({ resource: 1, resourceId: 1 }, { unique: true });
recordLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RecordLock =
  mongoose.models.RecordLock ?? mongoose.model('RecordLock', recordLockSchema);

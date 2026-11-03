import mongoose from 'mongoose';

/**
 * One row per appointment that has been considered for Google Calendar sync.
 *
 * This is deliberately separate from the Appointment document so the existing
 * appointment API and UI stay unchanged. The unique appointment index makes the
 * sync idempotent: a retry updates the same event instead of creating a second.
 */
const calendarEventLinkSchema = new mongoose.Schema(
  {
    appointment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Appointment',
      required: true,
      unique: true,
      index: true,
    },
    calendarId: { type: String, required: true, trim: true },
    // Deterministic Google event id derived from the appointment id.
    eventId: { type: String, required: true, trim: true, index: true },
    status: {
      type: String,
      enum: ['pending', 'synced', 'failed', 'deleted'],
      default: 'pending',
      index: true,
    },
    lastSyncedAt: { type: Date, default: null },
    // Sanitized error text only — never tokens, keys, or full API responses.
    lastError: { type: String, default: '', trim: true },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// Retry scans look for the oldest pending/failed rows first.
calendarEventLinkSchema.index({ status: 1, updatedAt: 1 });

export const CalendarEventLink =
  mongoose.models.CalendarEventLink ??
  mongoose.model('CalendarEventLink', calendarEventLinkSchema);

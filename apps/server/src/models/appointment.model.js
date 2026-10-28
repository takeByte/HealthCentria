import mongoose from 'mongoose';

const appointmentSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true, index: true },
    // Calendar day "YYYY-MM-DD" (booking key) + exact timestamp for display/sort.
    day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    date: { type: Date, required: true },
    timePreference: { type: String, enum: ['morning', 'afternoon', 'any'], default: 'any' },
    notes: { type: String, default: '', trim: true },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'declined', 'completed', 'cancelled'],
      default: 'pending',
      index: true,
    },
    declineReason: { type: String, default: '', trim: true },
    // Clinical visit record — written by staff on completion, read-only for patients.
    diagnosis: { type: String, default: '', trim: true },
    prescription: { type: String, default: '', trim: true },
    visitNotes: { type: String, default: '', trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // Stable marker for idempotent demo seeding (never exposed by the API).
    seedKey: { type: String, index: true, sparse: true },
  },
  { timestamps: true },
);

export const Appointment = mongoose.models.Appointment ?? mongoose.model('Appointment', appointmentSchema);

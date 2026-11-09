import mongoose from 'mongoose';

const scheduleSchema = new mongoose.Schema(
  {
    mode: { type: String, enum: ['weekly', 'nth-weekday', 'as-needed'], required: true },
    weekdays: { type: [Number], default: [] }, // weekly: 0=Sun..6=Sat
    nthWeek: { type: Number, min: 1, max: 5 }, // nth-weekday: which occurrence
    weekday: { type: Number, min: 0, max: 6 }, // nth-weekday: which weekday
  },
  { _id: false },
);

const serviceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    description: { type: String, default: '', trim: true },
    schedule: { type: scheduleSchema, required: true },
    active: { type: Boolean, default: true },
    // Last staff/admin account to edit the definition.
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, optimisticConcurrency: true },
);

export const Service = mongoose.models.Service ?? mongoose.model('Service', serviceSchema);

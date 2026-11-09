import mongoose from 'mongoose';

const announcementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    body: { type: String, required: true, trim: true, maxlength: 5000 },
    category: {
      type: String,
      required: true,
      enum: ['schedule-change', 'vaccination-day', 'health-advisory', 'general'],
      default: 'general',
    },
    pinned: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    publishedAt: { type: Date, default: Date.now },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, optimisticConcurrency: true },
);

export const Announcement =
  mongoose.models.Announcement ?? mongoose.model('Announcement', announcementSchema);

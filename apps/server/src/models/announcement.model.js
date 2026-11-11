import mongoose from 'mongoose';

const imageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true, maxlength: 500 },
    key: { type: String, default: '', trim: true, maxlength: 200 },
    alt: { type: String, default: '', trim: true, maxlength: 300 },
  },
  { _id: false },
);

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
    images: { type: [imageSchema], default: [] },
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

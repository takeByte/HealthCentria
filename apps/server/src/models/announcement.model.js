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
    // MVCC version stamp. Starts at 0 and goes up by exactly 1 on every successful edit.
    // It is a real, visible field in Atlas. It is changed ONLY by versionedUpdate()
    // (controllers/mvcc.controller.js), in the same atomic write as the edit itself.
    version: { type: Number, default: 0, min: 0 },
  },
  // versionKey:false -> Mongoose's hidden __v is not used for this collection any more;
  // `version` above replaces it. (Existing __v values in old documents are simply ignored.)
  { timestamps: true, versionKey: false },
);

export const Announcement =
  mongoose.models.Announcement ?? mongoose.model('Announcement', announcementSchema);

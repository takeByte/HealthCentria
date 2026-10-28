import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    action: {
      type: String,
      required: true,
      enum: [
        'appointment.book',
        'appointment.confirm',
        'appointment.decline',
        'appointment.complete',
        'appointment.cancel',
        'record.update',
        'settings.google.update',
        'settings.google.reset',
      ],
    },
    appointment: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', index: true },
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    detail: { type: String, default: '', trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const AuditLog = mongoose.models.AuditLog ?? mongoose.model('AuditLog', auditLogSchema);

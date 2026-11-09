import mongoose from 'mongoose';

/**
 * Every entry is append-only: there is no update or delete path in the API.
 * The only removal is the retention purge, which deletes rows older than the
 * policy window and then writes its own entry.
 */

export const ACTIVITY_CATEGORIES = [
  'auth',
  'appointments',
  'clinical',
  'people',
  'content',
  'configuration',
  'system',
];

export const ACTIVITY_ACTIONS = [
  // Sign-in
  'auth.login',
  'auth.login_failed',
  'auth.logout',
  'auth.register',
  'auth.password_reset_requested',
  'auth.password_reset',
  'auth.password_reset_failed',
  'auth.password_change',
  'auth.email_verification_sent',
  'auth.email_verified',
  'auth.email_verification_failed',
  // Appointments
  'appointment.book',
  'appointment.confirm',
  'appointment.decline',
  'appointment.cancel',
  'appointment.complete',
  'appointment.walkin',
  // Clinical / charts
  'patient.update',
  'record.update',
  // People
  'patient.create',
  'patient.delete',
  'staff.create',
  'staff.update',
  'profile.update',
  // Content
  'announcement.create',
  'announcement.update',
  'announcement.delete',
  'service.create',
  'service.update',
  // Configuration
  'settings.google.update',
  'settings.google.reset',
  'settings.email.update',
  'settings.email.reset',
  'settings.email.test',
  'settings.recaptcha.update',
  'settings.recaptcha.reset',
  'settings.signin.update',
  'integration.update',
  'settings.pin_failed',
  'settings.sheets.update',
  'settings.sheets.reset',
  'report.export_sheets',
  'activity.export_sheets',
  'report.export_pdf',
  'activity.export_pdf',
  'settings.drive.connect',
  'settings.drive.disconnect',
  // System
  'activity.purge',
];

/** Action → category. Kept in one place so every writer and reader agrees. */
export const ACTION_CATEGORY = {
  'auth.login': 'auth',
  'auth.login_failed': 'auth',
  'auth.logout': 'auth',
  'auth.register': 'auth',
  'auth.password_reset_requested': 'auth',
  'auth.password_reset': 'auth',
  'auth.password_reset_failed': 'auth',
  'auth.password_change': 'auth',
  'auth.email_verification_sent': 'auth',
  'auth.email_verified': 'auth',
  'auth.email_verification_failed': 'auth',
  'appointment.book': 'appointments',
  'appointment.confirm': 'appointments',
  'appointment.decline': 'appointments',
  'appointment.cancel': 'appointments',
  'appointment.complete': 'appointments',
  'appointment.walkin': 'appointments',
  'patient.update': 'clinical',
  'record.update': 'clinical',
  'patient.create': 'people',
  'patient.delete': 'people',
  'staff.create': 'people',
  'staff.update': 'people',
  'profile.update': 'people',
  'announcement.create': 'content',
  'announcement.update': 'content',
  'announcement.delete': 'content',
  'service.create': 'content',
  'service.update': 'content',
  'settings.google.update': 'configuration',
  'settings.google.reset': 'configuration',
  'settings.email.update': 'configuration',
  'settings.email.reset': 'configuration',
  'settings.email.test': 'configuration',
  'settings.recaptcha.update': 'configuration',
  'settings.recaptcha.reset': 'configuration',
  'settings.signin.update': 'configuration',
  'integration.update': 'configuration',
  'settings.pin_failed': 'configuration',
  'settings.sheets.update': 'configuration',
  'settings.sheets.reset': 'configuration',
  'report.export_sheets': 'system',
  'activity.export_sheets': 'system',
  'report.export_pdf': 'system',
  'activity.export_pdf': 'system',
  'settings.drive.connect': 'configuration',
  'settings.drive.disconnect': 'configuration',
  'activity.purge': 'system',
};

const PREFIX_CATEGORY = {
  auth: 'auth',
  appointment: 'appointments',
  patient: 'clinical',
  record: 'clinical',
  staff: 'people',
  profile: 'people',
  announcement: 'content',
  service: 'content',
  settings: 'configuration',
  integration: 'configuration',
  activity: 'system',
};

/** Entries written before categories existed still resolve to a sensible bucket. */
export function categoryForAction(action) {
  if (ACTION_CATEGORY[action]) return ACTION_CATEGORY[action];
  const prefix = String(action ?? '').split('.')[0];
  return PREFIX_CATEGORY[prefix] ?? 'system';
}

const changeSchema = new mongoose.Schema(
  {
    field: { type: String, required: true, trim: true },
    from: { type: String, default: '' },
    to: { type: String, default: '' },
  },
  { _id: false },
);

const auditLogSchema = new mongoose.Schema(
  {
    // Nullable: a failed sign-in has no verified actor.
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    // Snapshots so an entry still reads correctly after a rename or deletion.
    actorName: { type: String, default: '', trim: true },
    actorRole: { type: String, enum: ['patient', 'staff', 'admin', ''], default: '' },
    action: { type: String, required: true, enum: ACTIVITY_ACTIONS, index: true },
    // Stored (not derived) so filtering is an index scan.
    category: { type: String, enum: ACTIVITY_CATEGORIES, required: true, index: true },
    targetType: {
      type: String,
      enum: ['appointment', 'patient', 'staff', 'announcement', 'service', 'settings', 'integration', 'activity', 'auth', ''],
      default: '',
      index: true,
    },
    targetId: { type: String, default: '', index: true },
    targetLabel: { type: String, default: '', trim: true },
    // Role of the affected account when the target is a person. `targetType`
    // is 'staff' for both staff and admin accounts, so this is what tells them
    // apart in the log. Empty for non-account targets and older entries.
    targetRole: { type: String, enum: ['patient', 'staff', 'admin', ''], default: '' },
    changes: { type: [changeSchema], default: [] },
    outcome: { type: String, enum: ['success', 'failed'], default: 'success', index: true },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    // Legacy explicit references, still written by the appointment/patient paths.
    appointment: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', index: true },
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    detail: { type: String, default: '', trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// The three reads the UI makes: newest-first, by category, by actor, by target.
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ category: 1, createdAt: -1 });
auditLogSchema.index({ actor: 1, createdAt: -1 });
auditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });

export const AuditLog = mongoose.models.AuditLog ?? mongoose.model('AuditLog', auditLogSchema);

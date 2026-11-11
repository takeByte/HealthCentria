import mongoose from 'mongoose';

// One row holds the automatic backup schedule an admin configures from
// Admin → Backups. Kept separate from app-settings because it also carries the
// run history, which would bloat the platform switches document.
const runSchema = new mongoose.Schema(
  {
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, default: null },
    ok: { type: Boolean, required: true },
    trigger: { type: String, enum: ['manual', 'schedule'], default: 'manual' },
    fileName: { type: String, default: '', trim: true },
    bytes: { type: Number, default: 0 },
    collections: { type: Number, default: 0 },
    documents: { type: Number, default: 0 },
    durationMs: { type: Number, default: 0 },
    error: { type: String, default: '', trim: true },
  },
  { _id: false },
);

const backupSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'backup' },
    // Off until an admin turns it on, so no surprise disk usage after deploy.
    enabled: { type: Boolean, default: false },
    frequency: { type: String, enum: ['daily', 'weekly'], default: 'daily' },
    // Local hour (BACKUP_TIMEZONE, Asia/Manila by default) for the run.
    hour: { type: Number, min: 0, max: 23, default: 2 },
    // 0 = Sunday … 6 = Saturday. Only used when frequency is weekly.
    dayOfWeek: { type: Number, min: 0, max: 6, default: 1 },
    // How many .json.gz files to keep; older ones are removed after each run.
    retention: { type: Number, min: 1, max: 60, default: 7 },
    // YYYY-MM-DD (local) of the last scheduled run, so the scheduler does not
    // run twice in the same minute window or after a restart.
    lastScheduledOn: { type: String, default: '' },
    lastRunAt: { type: Date, default: null },
    lastStatus: { type: String, enum: ['success', 'failed', ''], default: '' },
    lastError: { type: String, default: '', trim: true },
    lastFile: { type: String, default: '', trim: true },
    lastBytes: { type: Number, default: 0 },
    lastDocuments: { type: Number, default: 0 },
    runs: { type: [runSchema], default: [] },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

export const BACKUP_SETTINGS_KEY = 'backup';

export const BackupSetting =
  mongoose.models.BackupSetting ?? mongoose.model('BackupSetting', backupSettingSchema);

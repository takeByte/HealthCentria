import fsp from 'node:fs/promises';
import mongoose from 'mongoose';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { BACKUP_SETTINGS_KEY, BackupSetting } from '../models/backup-setting.model.js';
import { logActivity } from '../services/activity.js';
import {
  BACKUP_DIR,
  backupPath,
  deleteBackupFile,
  isValidBackupName,
  listBackupFiles,
  nextRunAt,
  runBackup,
} from '../services/backup.js';

function requireDB(res) {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({ success: false, message: 'Database is not connected. Try again later.' });
    return false;
  }
  return true;
}

const DEFAULTS = {
  enabled: false,
  frequency: 'daily',
  hour: 2,
  dayOfWeek: 1,
  retention: 7,
};

function present(doc, files) {
  const config = {
    enabled: doc?.enabled ?? DEFAULTS.enabled,
    frequency: doc?.frequency ?? DEFAULTS.frequency,
    hour: doc?.hour ?? DEFAULTS.hour,
    dayOfWeek: doc?.dayOfWeek ?? DEFAULTS.dayOfWeek,
    retention: doc?.retention ?? DEFAULTS.retention,
  };
  const next = nextRunAt(config);
  return {
    ...config,
    directory: BACKUP_DIR,
    nextRunAt: next ? next.toISOString() : null,
    lastRunAt: doc?.lastRunAt ?? null,
    lastStatus: doc?.lastStatus ?? '',
    lastError: doc?.lastError ?? '',
    lastFile: doc?.lastFile ?? '',
    lastBytes: doc?.lastBytes ?? 0,
    lastDocuments: doc?.lastDocuments ?? 0,
    history: [...(doc?.runs ?? [])].reverse().slice(0, 10),
    files,
  };
}

function timeLabel(hour) {
  const suffix = hour < 12 ? 'AM' : 'PM';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:00 ${suffix}`;
}

function scheduleLabel(config) {
  if (!config.enabled) return 'off';
  if (config.frequency === 'weekly') {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return `weekly on ${days[config.dayOfWeek] ?? 'Monday'} at ${timeLabel(config.hour)}`;
  }
  return `daily at ${timeLabel(config.hour)}`;
}

/** GET /api/admin/settings/backup — schedule, last run and files on disk. */
export const getBackupSettings = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const [doc, files] = await Promise.all([
    BackupSetting.findOne({ key: BACKUP_SETTINGS_KEY }).lean(),
    listBackupFiles(),
  ]);
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, ...present(doc, files) });
});

const updateSchema = z
  .object({
    enabled: z.boolean().optional(),
    frequency: z.enum(['daily', 'weekly']).optional(),
    hour: z.coerce.number().int().min(0).max(23).optional(),
    dayOfWeek: z.coerce.number().int().min(0).max(6).optional(),
    retention: z.coerce.number().int().min(1).max(60).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update.' });

/** PUT /api/admin/settings/backup — save the schedule (superadmin PIN). */
export const updateBackupSettings = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;

  const parsed = updateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed.',
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  const before = await BackupSetting.findOne({ key: BACKUP_SETTINGS_KEY }).lean();
  const next = {
    enabled: parsed.data.enabled ?? before?.enabled ?? DEFAULTS.enabled,
    frequency: parsed.data.frequency ?? before?.frequency ?? DEFAULTS.frequency,
    hour: parsed.data.hour ?? before?.hour ?? DEFAULTS.hour,
    dayOfWeek: parsed.data.dayOfWeek ?? before?.dayOfWeek ?? DEFAULTS.dayOfWeek,
    retention: parsed.data.retention ?? before?.retention ?? DEFAULTS.retention,
  };

  const doc = await BackupSetting.findOneAndUpdate(
    { key: BACKUP_SETTINGS_KEY },
    { $set: { ...next, updatedBy: req.user.id } },
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
  ).lean();

  const fields = [
    ['enabled', before?.enabled ?? DEFAULTS.enabled, next.enabled],
    ['frequency', before?.frequency ?? DEFAULTS.frequency, next.frequency],
    ['hour', String(before?.hour ?? DEFAULTS.hour), String(next.hour)],
    ['dayOfWeek', String(before?.dayOfWeek ?? DEFAULTS.dayOfWeek), String(next.dayOfWeek)],
    ['retention', String(before?.retention ?? DEFAULTS.retention), String(next.retention)],
  ];

  await logActivity({
    req,
    action: 'settings.backup.update',
    target: { type: 'system', id: BACKUP_SETTINGS_KEY, label: 'Automatic backups' },
    changes: fields,
    detail: `Automatic backups ${scheduleLabel(next)}; keep ${next.retention} file(s).`,
  });

  const files = await listBackupFiles();
  res.json({ success: true, ...present(doc, files) });
});

/** POST /api/admin/settings/backup/run — write a snapshot immediately. */
export const runBackupNow = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;

  try {
    const run = await runBackup({ trigger: 'manual', req });
    const [doc, files] = await Promise.all([
      BackupSetting.findOne({ key: BACKUP_SETTINGS_KEY }).lean(),
      listBackupFiles(),
    ]);
    return res.status(201).json({ success: true, run, ...present(doc, files) });
  } catch (err) {
    const code = err?.code;
    if (code === 'BACKUP_RUNNING') {
      return res.status(409).json({ success: false, code, message: err.message });
    }
    if (code === 'BACKUP_DB_UNAVAILABLE') {
      return res.status(503).json({ success: false, code, message: err.message });
    }
    console.error('Manual backup failed:', err instanceof Error ? err.message : err);
    return res.status(500).json({
      success: false,
      message: `Backup failed: ${err instanceof Error ? err.message : 'unknown error'}`,
    });
  }
});

/** GET /api/admin/settings/backup/download/:name — download one snapshot. */
export const downloadBackup = asyncHandler(async (req, res) => {
  const { name } = req.params;
  if (!isValidBackupName(name)) {
    return res.status(404).json({ success: false, message: 'Backup file not found.' });
  }
  const target = backupPath(name);
  try {
    await fsp.access(target);
  } catch {
    return res.status(404).json({ success: false, message: 'Backup file not found.' });
  }
  res.set('Cache-Control', 'no-store');
  res.download(target, name);
});

/** DELETE /api/admin/settings/backup/:name — remove a snapshot (PIN). */
export const removeBackup = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const { name } = req.params;
  if (!isValidBackupName(name)) {
    return res.status(404).json({ success: false, message: 'Backup file not found.' });
  }

  const removed = await deleteBackupFile(name);
  if (!removed) {
    return res.status(404).json({ success: false, message: 'Backup file not found.' });
  }

  await logActivity({
    req,
    action: 'settings.backup.delete',
    target: { type: 'system', id: name, label: 'Backup file' },
    detail: `Backup file ${name} deleted.`,
  });

  res.json({ success: true, deleted: name, files: await listBackupFiles() });
});

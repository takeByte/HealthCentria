import mongoose from 'mongoose';
import { BACKUP_SETTINGS_KEY, BackupSetting } from '../models/backup-setting.model.js';
import { isBackupRunning, runBackup, zonedParts } from './backup.js';

/**
 * In-process scheduler for automatic backups.
 *
 * A minute-by-minute check is enough for a daily/hourly schedule and avoids a
 * cron dependency. The chosen hour is local to BACKUP_TIMEZONE (Asia/Manila by
 * default), so the run lands at the same wall-clock time regardless of where
 * the API host runs. One process should own this; a multi-instance deploy
 * would need a shared lock or a single scheduler worker.
 */

const CHECK_INTERVAL_MS = 60 * 1000;
const FIRST_CHECK_MS = 15 * 1000;

let timer = null;
let started = false;
let checking = false;

/**
 * True when this minute is the configured slot. `lastScheduledOn` makes the
 * check idempotent across restarts and repeated ticks inside the same hour.
 */
function isDue(doc, now = new Date()) {
  if (!doc?.enabled) return false;
  const parts = zonedParts(now);
  if (parts.hour !== doc.hour) return false;
  if (doc.frequency === 'weekly' && parts.weekday !== doc.dayOfWeek) return false;
  return doc.lastScheduledOn !== parts.ymd;
}

async function tick() {
  if (checking || isBackupRunning()) return;
  if (mongoose.connection.readyState !== 1) return;
  checking = true;
  try {
    const doc = await BackupSetting.findOne({ key: BACKUP_SETTINGS_KEY }).lean();
    if (!isDue(doc)) return;

    const today = zonedParts().ymd;
    // Claim the slot before the (possibly slow) run so a second tick in the
    // same hour cannot start a duplicate. A failed run is recorded in history;
    // the admin can retry from the Backups screen.
    await BackupSetting.updateOne(
      { key: BACKUP_SETTINGS_KEY },
      { $set: { lastScheduledOn: today } },
    ).catch(() => {});

    const result = await runBackup({ trigger: 'schedule' });
    console.log(
      `Scheduled backup ${result.fileName} written (${result.documents} documents, ${result.bytes} bytes).`,
    );
  } catch (err) {
    console.error('Scheduled backup failed:', err instanceof Error ? err.message : err);
  } finally {
    checking = false;
  }
}

export function startBackupScheduler() {
  if (started) return;
  started = true;
  const first = setTimeout(() => void tick(), FIRST_CHECK_MS);
  first.unref?.();
  timer = setInterval(() => void tick(), CHECK_INTERVAL_MS);
  timer.unref?.();
  console.log('Automatic backup scheduler started (checks every minute).');
}

export function stopBackupScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}

export { isDue };

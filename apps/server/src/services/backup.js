import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { BACKUP_SETTINGS_KEY, BackupSetting } from '../models/backup-setting.model.js';
import { logActivity } from './activity.js';

/**
 * Data backups: a gzipped JSON snapshot of every collection, written to disk
 * and pruned to the admin's retention count.
 *
 * JSON (not mongodump) because the API host is not guaranteed to have MongoDB
 * database tools installed. ObjectIds and Dates serialise through their normal
 * toJSON forms, which keeps the file readable and restorable with a small
 * script. Credentials encrypted at rest stay encrypted in the snapshot.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** apps/server/backups by default; BACKUP_DIR overrides it (relative to cwd). */
export const BACKUP_DIR = env.BACKUP_DIR
  ? path.resolve(process.cwd(), env.BACKUP_DIR)
  : path.resolve(HERE, '../../backups');

const FILE_PATTERN = /^healthcentria-backup-\d{8}-\d{6}(\d{3})?\.json\.gz$/;
const MAX_HISTORY = 20;

/** Set while a run is in flight so manual + scheduled runs cannot overlap. */
let activeRun = null;

export function isBackupRunning() {
  return activeRun !== null;
}

function backupError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

/** Local calendar parts for a moment, in the configured backup timezone. */
export function zonedParts(date = new Date(), timeZone = env.BACKUP_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  })
    .formatToParts(date)
    .filter((part) => part.type !== 'literal');
  const get = (type) => parts.find((part) => part.type === type)?.value ?? '';
  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: weekdayIndex,
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

/**
 * UTC offset of a timezone at a given instant, in minutes. Used to turn the
 * admin's chosen local hour into an exact next-run timestamp for the UI.
 */
function offsetMinutes(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return (asUtc - date.getTime()) / 60000;
}

/** The next scheduled run, or null when automatic backups are off. */
export function nextRunAt(doc, now = new Date()) {
  if (!doc?.enabled) return null;
  const timeZone = env.BACKUP_TIMEZONE;
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);
    const parts = zonedParts(candidate, timeZone);
    if (doc.frequency === 'weekly' && parts.weekday !== doc.dayOfWeek) continue;
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      doc.hour,
      0,
      0,
    );
    const runAt = new Date(asUtc - offsetMinutes(candidate, timeZone) * 60000);
    if (runAt.getTime() > now.getTime()) return runAt;
  }
  return null;
}

function fileNameFor(date) {
  const parts = zonedParts(date);
  return `healthcentria-backup-${parts.year}${pad(parts.month)}${pad(parts.day)}-${pad(
    parts.hour,
  )}${pad(parts.minute)}${pad(parts.second)}${String(date.getMilliseconds()).padStart(3, '0')}.json.gz`;
}

export function isValidBackupName(name) {
  return typeof name === 'string' && FILE_PATTERN.test(name);
}

/** Absolute path for a validated file name. Throws on traversal attempts. */
export function backupPath(name) {
  if (!isValidBackupName(name)) throw backupError('BACKUP_NOT_FOUND', 'Backup file not found.');
  return path.join(BACKUP_DIR, name);
}

async function ensureDir() {
  await fsp.mkdir(BACKUP_DIR, { recursive: true });
}

/** Newest first. Reads the directory each call — the list is small. */
export async function listBackupFiles() {
  try {
    await ensureDir();
    const entries = await fsp.readdir(BACKUP_DIR, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile() || !FILE_PATTERN.test(entry.name)) continue;
      const stat = await fsp.stat(path.join(BACKUP_DIR, entry.name));
      files.push({
        name: entry.name,
        bytes: stat.size,
        createdAt: stat.mtime.toISOString(),
      });
    }
    return files.sort((a, b) => b.name.localeCompare(a.name));
  } catch (err) {
    console.error('Could not list backups:', err instanceof Error ? err.message : err);
    return [];
  }
}

async function pruneBackups(retention) {
  const files = await listBackupFiles();
  const keep = Math.max(1, Number(retention) || 1);
  const removed = [];
  for (const file of files.slice(keep)) {
    try {
      await fsp.unlink(path.join(BACKUP_DIR, file.name));
      removed.push(file.name);
    } catch (err) {
      console.error(`Could not remove old backup ${file.name}:`, err instanceof Error ? err.message : err);
    }
  }
  return removed;
}

async function writeSnapshot(finalPath, startedAt) {
  const db = mongoose.connection.db;
  if (!db) throw backupError('BACKUP_DB_UNAVAILABLE', 'Database is not connected. Try again later.');

  await ensureDir();
  const tmpPath = `${finalPath}.tmp`;
  const gzip = createGzip({ level: 9 });
  const out = fs.createWriteStream(tmpPath);
  const written = pipeline(gzip, out);
  written.catch(() => {});

  const write = async (chunk) => {
    if (!gzip.write(chunk)) await once(gzip, 'drain');
  };

  let collections = 0;
  let documents = 0;

  try {
    await write(
      `{"format":"healthcentria-backup","version":1,"createdAt":${JSON.stringify(
        startedAt.toISOString(),
      )},"database":${JSON.stringify(db.databaseName)},"collections":{`,
    );

    let firstCollection = true;
    for (const collection of await db.collections()) {
      if (collection.collectionName.startsWith('system.')) continue;
      if (!firstCollection) await write(',');
      firstCollection = false;

      await write(`${JSON.stringify(collection.collectionName)}:[`);
      let firstDocument = true;
      for await (const document of collection.find({})) {
        if (!firstDocument) await write(',');
        firstDocument = false;
        await write(JSON.stringify(document));
        documents += 1;
      }
      await write(']');
      collections += 1;
    }

    await write('}}');
    gzip.end();
    await written;
  } catch (err) {
    gzip.destroy();
    out.destroy();
    await fsp.rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }

  await fsp.rename(tmpPath, finalPath);
  const stat = await fsp.stat(finalPath);
  return { collections, documents, bytes: stat.size };
}

/**
 * Write one snapshot and record the outcome. Never runs two at once.
 *
 * `req` is optional: scheduled runs have no request, so the activity entry is
 * written with the actorId/actorRole the scheduler passes instead.
 */
export async function runBackup({ trigger = 'manual', req } = {}) {
  if (activeRun) {
    throw backupError('BACKUP_RUNNING', 'A backup is already running. Try again when it finishes.');
  }
  if (mongoose.connection.readyState !== 1) {
    throw backupError('BACKUP_DB_UNAVAILABLE', 'Database is not connected. Try again later.');
  }

  activeRun = (async () => {
    const startedAt = new Date();
    const fileName = fileNameFor(startedAt);
    const filePath = path.join(BACKUP_DIR, fileName);
    const run = {
      startedAt,
      finishedAt: null,
      ok: false,
      trigger,
      fileName,
      bytes: 0,
      collections: 0,
      documents: 0,
      durationMs: 0,
      error: '',
    };

    try {
      const result = await writeSnapshot(filePath, startedAt);
      Object.assign(run, result, {
        ok: true,
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
      });

      const doc = await BackupSetting.findOneAndUpdate(
        { key: BACKUP_SETTINGS_KEY },
        {
          $set: {
            lastRunAt: run.finishedAt,
            lastStatus: 'success',
            lastError: '',
            lastFile: fileName,
            lastBytes: result.bytes,
            lastDocuments: result.documents,
            ...(req?.user?.id ? { updatedBy: req.user.id } : {}),
          },
          $push: { runs: { $each: [run], $slice: -MAX_HISTORY } },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).lean();

      const removed = await pruneBackups(doc?.retention ?? 7);
      await logActivity({
        req,
        action: 'system.backup',
        target: { type: 'system', id: 'backup', label: 'Data backup' },
        detail: `Backup ${fileName} written (${trigger}): ${result.documents} document(s) across ${result.collections} collection(s).${
          removed.length ? ` Removed ${removed.length} old file(s).` : ''
        }`,
        actorId: req?.user?.id,
        actorRole: req?.user?.role ?? '',
      });

      return { ...run, removed: removed.length, directory: BACKUP_DIR };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      run.finishedAt = new Date();
      run.durationMs = Date.now() - startedAt.getTime();
      run.error = message.slice(0, 500);
      await fsp.rm(filePath, { force: true }).catch(() => {});

      await BackupSetting.findOneAndUpdate(
        { key: BACKUP_SETTINGS_KEY },
        {
          $set: {
            lastRunAt: run.finishedAt,
            lastStatus: 'failed',
            lastError: run.error,
            ...(req?.user?.id ? { updatedBy: req.user.id } : {}),
          },
          $push: { runs: { $each: [run], $slice: -MAX_HISTORY } },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).catch(() => {});

      await logActivity({
        req,
        action: 'system.backup',
        target: { type: 'system', id: 'backup', label: 'Data backup' },
        outcome: 'failed',
        detail: `Backup failed (${trigger}): ${message}`,
        actorId: req?.user?.id,
        actorRole: req?.user?.role ?? '',
      });

      throw err;
    } finally {
      run.finishedAt = run.finishedAt ?? new Date();
      run.durationMs = run.durationMs || Date.now() - startedAt.getTime();
    }
  })();

  try {
    return await activeRun;
  } finally {
    activeRun = null;
  }
}

/** Remove one snapshot file. Returns false when it was already gone. */
export async function deleteBackupFile(name) {
  const target = backupPath(name);
  try {
    await fsp.unlink(target);
    return true;
  } catch (err) {
    if (err?.code === 'ENOENT') return false;
    throw err;
  }
}

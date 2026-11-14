import { createFileRoute } from '@tanstack/react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import {
  Archive,
  Clock3,
  DatabaseBackup,
  Download,
  HardDrive,
  LoaderCircle,
  Play,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { DashboardShell } from '../../components/dashboard-shell';
import { adminNav } from '../../components/ops-nav';
import {
  CardHeading,
  EmptyNote,
  InlineNotice,
  PageHero,
  StatTile,
  StatusPill,
  chipButton,
  dangerChipButton,
  fieldLabel,
  inputClass,
  panel,
  primaryButton,
  secondaryButton,
  selectClass,
} from '../../components/app-ui';
import { formatDateTime } from '../../components/record-meta';
import { PinCancelled, useSuperPin } from '../../components/super-pin';
import { Toast, type ToastMessage } from '../../components/toast';
import { getSession } from '../../lib/auth';
import {
  ApiError,
  deleteBackupFile,
  downloadBackupFile,
  getBackupSettings,
  runBackupNow,
  updateBackupSettings,
  type BackupSettings,
} from '../../lib/api';
import { getTodayService } from '../../lib/schedule';

export const Route = createFileRoute('/admin/backups')({
  component: AdminBackups,
});

type ScheduleForm = Pick<BackupSettings, 'enabled' | 'frequency' | 'hour' | 'dayOfWeek' | 'retention'>;

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function hourLabel(hour: number): string {
  const suffix = hour < 12 ? 'AM' : 'PM';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:00 ${suffix}`;
}

function fileSize(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formFrom(settings: BackupSettings): ScheduleForm {
  return {
    enabled: settings.enabled,
    frequency: settings.frequency,
    hour: settings.hour,
    dayOfWeek: settings.dayOfWeek,
    retention: settings.retention,
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong. Try again.';
}

function AdminBackups() {
  const reduceMotion = useReducedMotion();
  const session = getSession();
  const today = getTodayService();
  const { withPin, dialog: pinDialog } = useSuperPin();

  const [settings, setSettings] = useState<BackupSettings | null>(null);
  const [form, setForm] = useState<ScheduleForm | null>(null);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [busyFile, setBusyFile] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  function apply(next: BackupSettings) {
    setSettings(next);
    setForm(formFrom(next));
  }

  function load() {
    setLoadError('');
    getBackupSettings()
      .then(apply)
      .catch((err: unknown) => setLoadError(errorMessage(err)));
  }

  useEffect(load, []);

  const rise = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const riseTransition = { type: 'spring', bounce: 0, duration: 0.35 } as const;

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      const next = await withPin('Save the automatic backup schedule', (pin) =>
        updateBackupSettings(form, pin),
      );
      apply(next);
      setToast({
        tone: 'success',
        message: next.enabled
          ? `Automatic backups saved: ${next.frequency} at ${hourLabel(next.hour)}.`
          : 'Automatic backups turned off.',
      });
    } catch (err) {
      if (!(err instanceof PinCancelled)) {
        setToast({ tone: 'error', message: errorMessage(err) });
      }
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    setRunning(true);
    try {
      const next = await withPin('Write a data backup now', (pin) => runBackupNow(pin));
      apply(next);
      setToast({
        tone: 'success',
        message: `Backup written: ${next.run.fileName} (${fileSize(next.run.bytes)}).`,
      });
    } catch (err) {
      if (!(err instanceof PinCancelled)) {
        setToast({ tone: 'error', message: errorMessage(err) });
      }
    } finally {
      setRunning(false);
    }
  }

  async function remove(name: string) {
    setBusyFile(name);
    try {
      const next = await withPin(`Delete the backup file ${name}?`, (pin) =>
        deleteBackupFile(name, pin),
      );
      setSettings((current) => (current ? { ...current, files: next.files } : current));
      setToast({ tone: 'success', message: 'Backup file deleted.' });
    } catch (err) {
      if (!(err instanceof PinCancelled)) {
        setToast({ tone: 'error', message: errorMessage(err) });
      }
    } finally {
      setBusyFile(null);
    }
  }

  async function download(name: string) {
    setBusyFile(name);
    try {
      await downloadBackupFile(name);
    } catch (err) {
      setToast({ tone: 'error', message: errorMessage(err) });
    } finally {
      setBusyFile(null);
    }
  }

  const totalBytes = (settings?.files ?? []).reduce((sum, file) => sum + file.bytes, 0);
  const latest = settings?.history?.[0];

  return (
    <DashboardShell
      title="Backups"
      subtitle="Automatic data snapshots and retention"
      roleLabel="Admin"
      userName={session?.name}
      userEmail={session?.email ?? ''}
      todayService={`${today.name} — ${today.detail}`}
      nav={adminNav}
      notificationsTo="/staff/notifications"
      mainClassName="max-w-5xl"
    >
      <motion.div {...rise} transition={riseTransition}>
        <PageHero
          eyebrow="Data security"
          title="Keep a copy of the clinic data"
          description="The server writes a gzipped JSON snapshot of every collection on the schedule you set. Files stay on the API host unless you download them; older files are removed once the retention count is reached."
          action={
            <StatusPill tone={settings?.enabled ? 'teal' : 'slate'}>
              {settings?.enabled ? 'Automatic' : 'Off'}
            </StatusPill>
          }
        />
      </motion.div>

      {loadError && (
        <motion.div {...rise} transition={{ ...riseTransition, delay: 0.03 }}>
          <InlineNotice>{loadError}</InlineNotice>
        </motion.div>
      )}

      <motion.div
        {...rise}
        transition={{ ...riseTransition, delay: 0.04 }}
        className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatTile
          icon={Clock3}
          label="Last backup"
          value={settings?.lastRunAt ? formatDateTime(settings.lastRunAt) : 'Never'}
          hint={
            settings?.lastStatus === 'failed'
              ? 'Last attempt failed'
              : latest?.ok
                ? `${latest.documents} documents`
                : 'No run recorded yet'
          }
          tone={settings?.lastStatus === 'failed' ? 'amber' : 'teal'}
        />
        <StatTile
          icon={Archive}
          label="Stored files"
          value={settings?.files.length ?? '—'}
          hint={`Keep ${settings?.retention ?? 7} · ${fileSize(totalBytes)} total`}
          tone="sky"
        />
        <StatTile
          icon={RefreshCw}
          label="Next run"
          value={settings?.enabled ? formatDateTime(settings.nextRunAt) : 'Off'}
          hint={settings?.enabled ? `${settings.frequency} · ${hourLabel(settings.hour)}` : 'Turn on below'}
          tone="slate"
        />
        <StatTile
          icon={ShieldCheck}
          label="Contents"
          value="Full snapshot"
          hint="Users, charts, appointments, logs"
          tone="teal"
        />
      </motion.div>

      <motion.section
        {...rise}
        transition={{ ...riseTransition, delay: 0.08 }}
        className={panel}
      >
        <CardHeading
          title="Schedule"
          description="Times use the server's backup timezone (Asia/Manila by default). Saving needs the superadmin PIN."
          action={
            <button
              type="button"
              onClick={load}
              className={chipButton}
              disabled={saving || running}
            >
              <RefreshCw size={14} aria-hidden /> Refresh
            </button>
          }
        />

        {!form ? (
          <EmptyNote className="mt-4">Loading backup settings…</EmptyNote>
        ) : (
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="flex items-start gap-3 rounded-xl border border-slate-200/80 bg-white p-4">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
                  className="mt-0.5 size-4 accent-[#1f55a8]"
                />
                <span>
                  <span className="block text-[13.5px] font-semibold text-slate-900">
                    Run automatic backups
                  </span>
                  <span className="mt-0.5 block text-[12.5px] leading-5 text-slate-500">
                    When off, only the manual <strong>Back up now</strong> button writes a file.
                  </span>
                </span>
              </label>
            </div>

            <div>
              <label htmlFor="backup-frequency" className={fieldLabel}>
                Frequency
              </label>
              <select
                id="backup-frequency"
                value={form.frequency}
                onChange={(event) =>
                  setForm({ ...form, frequency: event.target.value as ScheduleForm['frequency'] })
                }
                className={selectClass}
              >
                <option value="daily">Every day</option>
                <option value="weekly">Every week</option>
              </select>
            </div>

            <div>
              <label htmlFor="backup-hour" className={fieldLabel}>
                Time of day
              </label>
              <select
                id="backup-hour"
                value={form.hour}
                onChange={(event) => setForm({ ...form, hour: Number(event.target.value) })}
                className={selectClass}
              >
                {HOURS.map((hour) => (
                  <option key={hour} value={hour}>
                    {hourLabel(hour)}
                  </option>
                ))}
              </select>
            </div>

            {form.frequency === 'weekly' && (
              <div>
                <label htmlFor="backup-day" className={fieldLabel}>
                  Day of the week
                </label>
                <select
                  id="backup-day"
                  value={form.dayOfWeek}
                  onChange={(event) => setForm({ ...form, dayOfWeek: Number(event.target.value) })}
                  className={selectClass}
                >
                  {DAYS.map((day, index) => (
                    <option key={day} value={index}>
                      {day}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label htmlFor="backup-retention" className={fieldLabel}>
                Files to keep
              </label>
              <input
                id="backup-retention"
                type="number"
                min={1}
                max={60}
                value={form.retention}
                onChange={(event) => setForm({ ...form, retention: Number(event.target.value) })}
                className={inputClass}
              />
              <p className="mt-1.5 text-[11.5px] leading-5 text-slate-500">
                Older snapshots are deleted after each successful run (1–60).
              </p>
            </div>

            <div className="sm:col-span-2">
              <p className={fieldLabel}>Backup folder on the server</p>
              <p className="break-all rounded-xl border border-slate-200/80 bg-slate-50 px-3 py-2.5 font-mono text-[12px] text-slate-600">
                {settings?.directory ?? '—'}
              </p>
            </div>

            {settings?.lastStatus === 'failed' && settings.lastError && (
              <div className="sm:col-span-2">
                <InlineNotice>Last backup failed: {settings.lastError}</InlineNotice>
              </div>
            )}

            <div className="flex flex-col gap-2.5 sm:col-span-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={runNow}
                className={secondaryButton}
                disabled={running || saving}
              >
                {running ? (
                  <LoaderCircle size={16} className="animate-spin" aria-hidden />
                ) : (
                  <Play size={15} aria-hidden />
                )}
                {running ? 'Writing snapshot…' : 'Back up now'}
              </button>
              <button type="button" onClick={save} className={primaryButton} disabled={saving || running}>
                {saving && <LoaderCircle size={16} className="animate-spin" aria-hidden />}
                {saving ? 'Saving…' : 'Save schedule'}
              </button>
            </div>
          </div>
        )}
      </motion.section>

      <motion.section
        {...rise}
        transition={{ ...riseTransition, delay: 0.12 }}
        className={panel}
      >
        <CardHeading
          title="Backups on disk"
          description="Newest first. Download a copy somewhere safe; deleting here cannot be undone."
        />
        {settings === null ? (
          <EmptyNote className="mt-4">Loading files…</EmptyNote>
        ) : settings.files.length === 0 ? (
          <EmptyNote className="mt-4">
            No backups yet. Use <strong>Back up now</strong> to write the first one.
          </EmptyNote>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-slate-200/80 text-[10.5px] uppercase tracking-[0.08em] text-slate-500">
                  <th className="py-2 pr-3 font-bold">File</th>
                  <th className="py-2 pr-3 font-bold">Size</th>
                  <th className="py-2 pr-3 font-bold">Written</th>
                  <th className="py-2 text-right font-bold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {settings.files.map((file) => (
                  <tr key={file.name} className="border-b border-slate-100 last:border-0">
                    <td className="py-2.5 pr-3 font-mono text-[11.5px] text-slate-700">{file.name}</td>
                    <td className="py-2.5 pr-3 text-slate-600">{fileSize(file.bytes)}</td>
                    <td className="py-2.5 pr-3 text-slate-600">{formatDateTime(file.createdAt)}</td>
                    <td className="py-2.5">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => download(file.name)}
                          className={chipButton}
                          disabled={busyFile === file.name}
                        >
                          <Download size={13} aria-hidden /> Download
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(file.name)}
                          className={dangerChipButton}
                          disabled={busyFile === file.name}
                        >
                          <Trash2 size={13} aria-hidden /> Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.section>

      <motion.section
        {...rise}
        transition={{ ...riseTransition, delay: 0.16 }}
        className={panel}
      >
        <CardHeading
          title="Recent runs"
          description="The last ten attempts, from the schedule and the manual button."
        />
        {!settings || settings.history.length === 0 ? (
          <EmptyNote className="mt-4">No runs recorded yet.</EmptyNote>
        ) : (
          <ul className="mt-4 divide-y divide-slate-200/70">
            {settings.history.map((run) => (
              <li key={`${run.startedAt}-${run.fileName}`} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-[13px] font-semibold text-slate-800">
                    <span
                      aria-hidden
                      className={`size-2 rounded-full ${run.ok ? 'bg-emerald-500' : 'bg-red-500'}`}
                    />
                    {run.ok ? 'Success' : 'Failed'}
                    <span className="font-normal text-slate-400">·</span>
                    <span className="font-normal capitalize text-slate-500">{run.trigger}</span>
                  </p>
                  <p className="mt-0.5 text-[12px] text-slate-500">
                    {formatDateTime(run.startedAt)}
                    {run.ok
                      ? ` · ${run.documents} documents · ${fileSize(run.bytes)} · ${run.durationMs} ms`
                      : ` · ${run.error || 'unknown error'}`}
                  </p>
                </div>
                {run.fileName && run.ok && (
                  <span className="font-mono text-[11px] text-slate-400">{run.fileName}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </motion.section>

      <motion.section
        {...rise}
        transition={{ ...riseTransition, delay: 0.2 }}
        className={panel}
      >
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
            <DatabaseBackup size={19} aria-hidden />
          </span>
          <div>
            <h2 className="font-display text-[15px] font-semibold tracking-[-0.01em] text-slate-900">
              Where these files live
            </h2>
            <p className="mt-1 text-[13px] leading-6 text-slate-600">
              Snapshots are stored on the machine running the API. If that host uses an ephemeral
              disk (some PaaS plans reset on deploy), download the files or mount a persistent volume
              through <code className="rounded bg-slate-100 px-1 py-0.5 text-[12px]">BACKUP_DIR</code>.
              MongoDB Atlas clusters also have their own cloud backup option.
            </p>
            <p className="mt-2 flex items-center gap-1.5 text-[12px] text-slate-500">
              <HardDrive size={13} aria-hidden /> A snapshot includes password hashes and encrypted
              integration secrets; treat the files as sensitive.
            </p>
          </div>
        </div>
      </motion.section>

      {pinDialog}

      <AnimatePresence>
        {toast && (
          <Toast
            key={`${toast.tone}-${toast.message}`}
            toast={toast}
            onDone={() => setToast(null)}
          />
        )}
      </AnimatePresence>
    </DashboardShell>
  );
}

import { createFileRoute } from '@tanstack/react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import ReCAPTCHA from 'react-google-recaptcha';
import {
  ChevronDown,
  Download,
  Info,
  KeyRound,
  LoaderCircle,
  Mail,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { DashboardShell } from '../../components/dashboard-shell';
import { adminNav } from '../../components/ops-nav';
import { formatDateTime } from '../../components/record-meta';
import { Toast, type ToastMessage } from '../../components/toast';
import {
  CardHeading,
  InlineNotice,
  PageHero,
  Segmented,
  StatusPill,
  SuccessNote,
  fieldLabel,
  inputClass,
  panel,
  primaryButton,
  secondaryButton,
} from '../../components/app-ui';
import { PinCancelled, PinDialog, type PinRequest, type WithPin } from '../../components/super-pin';
import { getSession } from '../../lib/auth';
import {
  ApiError,
  downloadVisitsCsv,
  getAuthSettings,
  getEmailIntegrationSettings,
  getGoogleCalendarSettings,
  getGoogleIntegrationSettings,
  getGoogleSheetsSettings,
  getGoogleDriveSettings,
  startGoogleDriveConnect,
  disconnectGoogleDrive,
  testGoogleDriveUpload,
  type GoogleDriveSettings,
  resetGoogleSheetsSettings,
  testGoogleSheetsConnection,
  updateGoogleSheetsSettings,
  type GoogleSheetsSettings,
  getPublicSettings,
  getRecaptchaIntegrationSettings,
  resetEmailIntegrationSettings,
  resetGoogleIntegrationSettings,
  resetRecaptchaIntegrationSettings,
  updateRecaptchaIntegrationSettings,
  type RecaptchaIntegrationSettings,
  syncGoogleCalendar,
  testEmailDelivery,
  testGoogleCalendarConnection,
  updateAuthSettings,
  updateEmailIntegrationSettings,
  updateGoogleCalendarSettings,
  updateGoogleIntegrationSettings,
  type AuthSettings,
  type EmailIntegrationSettings,
  type GoogleCalendarSettings,
  type GoogleIntegrationSettings,
} from '../../lib/api';
import { getTodayService } from '../../lib/schedule';
import { cn } from '../../lib/utils';

export const Route = createFileRoute('/admin/settings')({
  component: AdminSettings,
});

const destructiveButton =
  'inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-red-600 px-5 text-sm font-semibold text-white shadow-[0_6px_18px_-8px_rgba(220,38,38,0.7)] transition-transform active:scale-[0.97] disabled:opacity-60';

function Toggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        checked ? 'bg-teal-600' : 'bg-slate-300',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'inline-block size-5 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  );
}

/** Collapse long runs of mask bullets so masked values fit on one line. */
function compactMask(value: string | null | undefined): string {
  return (value ?? '').replace(/•{4,}/g, '••••');
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="mt-2 px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">{children}</h2>
  );
}

/**
 * The "Configure ▾" disclosure at the bottom of an integration card. Advanced
 * fields stay hidden until the admin asks for them. Drafts live in the parent,
 * so collapsing never discards half-typed values.
 */
function ConfigureSection({
  id,
  label,
  summary,
  defaultOpen = false,
  children,
}: {
  id: string;
  label: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const reduceMotion = useReducedMotion();
  const panelId = `${id}-panel`;

  return (
    <div className="mt-4 border-t border-slate-200/80 pt-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1.5 rounded-lg py-1.5 text-[13px] font-semibold text-teal-700 transition-colors hover:text-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
        >
          {label}
          <ChevronDown
            size={16}
            aria-hidden
            className={cn('transition-transform duration-200', open && 'rotate-180')}
          />
        </button>
        {summary && <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-slate-500">{summary}</div>}
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="panel"
            id={panelId}
            initial={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduceMotion ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
            className="-mx-1 overflow-hidden px-1"
          >
            <div className="pb-1 pt-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ResetDialog({
  title,
  description,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: ReactNode;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    cancelRef.current?.focus();
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', bounce: 0, duration: 0.25 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-dialog-title"
        className="w-full max-w-md rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_24px_70px_-28px_rgba(15,60,90,0.45)] sm:p-6"
      >
        <h2 id="reset-dialog-title" className="font-display text-lg font-semibold tracking-[-0.02em] text-slate-900">
          {title}
        </h2>
        <div className="mt-2 text-[13.5px] leading-6 text-slate-600">{description}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className={secondaryButton}
          >
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={busy} className={destructiveButton}>
            {busy && <LoaderCircle size={16} className="animate-spin" aria-hidden />}
            {busy ? 'Resetting…' : 'Reset to default'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

/**
 * Google Sheets export card. The spreadsheet belongs to a person and is shared
 * with the Calendar service account as Editor; every export adds a new tab.
 * Saving or resetting the spreadsheet needs the superadmin PIN, and a new
 * spreadsheet is tested on the server before it is saved.
 */
function GoogleSheetsCard({
  withPin,
  onToast,
  enabled,
  toggling,
  onToggle,
}: {
  withPin: WithPin;
  onToast: (t: ToastMessage) => void;
  /** The on/off switch lives in the shared platform settings; undefined while loading. */
  enabled: boolean | undefined;
  toggling: boolean;
  onToggle: (next: boolean) => void;
}) {
  const reduceMotion = useReducedMotion();
  const [sheets, setSheets] = useState<GoogleSheetsSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getGoogleSheetsSettings()
      .then((r) => {
        if (!cancelled) setSheets(r);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof ApiError ? err.message : 'Could not load Google Sheets status.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    const value = draft.trim();
    if (!value || saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const r = await withPin('Change the Google Sheets export spreadsheet.', (pin) =>
        updateGoogleSheetsSettings({ spreadsheetId: value }, pin),
      );
      setSheets(r);
      setDraft('');
      onToast({ tone: 'success', message: 'Spreadsheet tested and saved.' });
    } catch (err) {
      if (err instanceof PinCancelled) return;
      setError(
        err instanceof ApiError
          ? (err.errors?.spreadsheetId?.[0] ?? err.message)
          : 'Could not save the spreadsheet. Try again.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    if (testing) return;
    setTesting(true);
    setError(null);
    setMessage(null);
    try {
      const r = await testGoogleSheetsConnection();
      setMessage(`Connected to "${r.title}". The service account can add and remove tabs.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach Google Sheets. Try again.');
    } finally {
      setTesting(false);
    }
  }

  async function reset() {
    if (resetting) return;
    setResetting(true);
    try {
      const r = await withPin('Reset the Google Sheets spreadsheet to the server default.', (pin) =>
        resetGoogleSheetsSettings(pin),
      );
      setSheets(r);
      setResetOpen(false);
      onToast({ tone: 'success', message: 'Google Sheets reset to the server default.' });
    } catch (err) {
      if (err instanceof PinCancelled) return;
      onToast({ tone: 'error', message: err instanceof ApiError ? err.message : 'Could not reset. Try again.' });
    } finally {
      setResetting(false);
    }
  }

  return (
    <>
      <motion.section
        id="google-sheets"
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={{ type: 'spring', bounce: 0, duration: 0.35, delay: 0.13 }}
        className={panel}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <CardHeading
              title="Google Sheets"
              description="Reports and the Activity log can be exported to one shared spreadsheet. Each export adds a new tab and returns a link. Only people the spreadsheet is shared with can open it."
            />
          </div>
          <div className="flex items-center gap-2.5">
            {toggling && <LoaderCircle size={17} className="animate-spin text-slate-400" aria-hidden />}
            {sheets === null ? (
              <StatusPill tone={loadError ? 'red' : 'slate'}>{loadError ? 'Unavailable' : 'Loading…'}</StatusPill>
            ) : !sheets.configured ? (
              <StatusPill tone="amber">Not set up</StatusPill>
            ) : null}
            {enabled !== undefined && (
              <>
                <StatusPill tone={enabled ? 'teal' : 'slate'}>{enabled ? 'On' : 'Off'}</StatusPill>
                <Toggle
                  checked={enabled}
                  disabled={toggling}
                  label="Allow exports to Google Sheets"
                  onChange={onToggle}
                />
              </>
            )}
          </div>
        </div>

        {enabled === false && (
          <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-[12.5px] leading-5 text-amber-900 ring-1 ring-inset ring-amber-600/20">
            Google Sheets export is off. The &ldquo;Export to Sheets&rdquo; buttons show an error until it is turned
            back on. CSV export and tabs already in the spreadsheet are not affected.
          </p>
        )}
        {loadError && <InlineNotice className="mt-4">{loadError}</InlineNotice>}
        {error && <InlineNotice className="mt-4">{error}</InlineNotice>}
        {message && <SuccessNote className="mt-4">{message}</SuccessNote>}
        {sheets && !sheets.serviceAccountConfigured && (
          <InlineNotice className="mt-4">
            The Google service account is not set in the server .env (the same one Google Calendar uses).
          </InlineNotice>
        )}

        {sheets && (
          <ConfigureSection
            id="sheets-config"
            label="Configure spreadsheet"
            defaultOpen={!sheets.configured}
            summary={
              <>
                <StatusPill tone={sheets.source === 'custom' ? 'sky' : 'slate'}>
                  {sheets.source === 'custom' ? 'Custom' : 'Default'}
                </StatusPill>
                {sheets.spreadsheetUrl && (
                  <a
                    href={sheets.spreadsheetUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-teal-700 underline-offset-4 hover:underline"
                  >
                    Open spreadsheet
                  </a>
                )}
              </>
            }
          >
            <div className="space-y-4">
              <dl className="grid gap-3 text-[12.5px] sm:grid-cols-2">
                <div className="rounded-xl bg-white px-3.5 py-3 ring-1 ring-inset ring-slate-200">
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Spreadsheet ID</dt>
                  <dd className="mt-1 break-all font-mono text-[11.5px] leading-5 text-slate-700">
                    {sheets.spreadsheetId || 'Not set'}
                  </dd>
                </div>
                <div className="rounded-xl bg-white px-3.5 py-3 ring-1 ring-inset ring-slate-200">
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Share it with (Editor)
                  </dt>
                  <dd className="mt-1 break-all font-mono text-[11.5px] leading-5 text-slate-700">
                    {sheets.serviceAccountEmail || 'Service account not set'}
                  </dd>
                </div>
              </dl>

              <form onSubmit={save} className="space-y-2">
                <label htmlFor="sheets-id" className={fieldLabel}>
                  New spreadsheet <span className="font-normal text-slate-500">(ID or full link)</span>
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    id="sheets-id"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/…/edit"
                    autoComplete="off"
                    className={inputClass}
                  />
                  <button type="submit" disabled={!draft.trim() || saving} className={`${primaryButton} shrink-0`}>
                    {saving && <LoaderCircle size={16} className="animate-spin" aria-hidden />}
                    {saving ? 'Testing…' : 'Test & save'}
                  </button>
                </div>
                <p className="text-[12px] leading-5 text-slate-500">
                  The server checks it can open the spreadsheet and add a tab before saving, so a typo or a missing
                  share can&apos;t break exports.
                </p>
              </form>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={test}
                  disabled={testing || !sheets.configured}
                  className={secondaryButton}
                >
                  {testing ? (
                    <LoaderCircle size={16} className="animate-spin" aria-hidden />
                  ) : (
                    <RefreshCw size={16} aria-hidden />
                  )}
                  {testing ? 'Testing…' : 'Test connection'}
                </button>
                {sheets.source === 'custom' && (
                  <button type="button" onClick={() => setResetOpen(true)} className={secondaryButton}>
                    <RotateCcw size={16} aria-hidden /> Reset to default
                  </button>
                )}
              </div>
            </div>
          </ConfigureSection>
        )}
      </motion.section>

      {resetOpen && (
        <ResetDialog
          title="Reset Google Sheets?"
          description={
            <>
              The custom spreadsheet will be removed from Settings. Exports will use the spreadsheet in the
              server&apos;s <code className="font-mono text-[12px]">.env</code> file
              {sheets?.defaultSet ? '.' : ', and none is set there, so Sheets exports will stop until one is added.'}
            </>
          }
          busy={resetting}
          onCancel={() => setResetOpen(false)}
          onConfirm={reset}
        />
      )}
    </>
  );
}

/**
 * Google Drive card. Exported PDFs are uploaded as the connected Google account
 * (OAuth), because the service account has no Drive storage. Connecting and
 * disconnecting need the superadmin PIN; the token is stored encrypted on the
 * server and never reaches the browser.
 */
function GoogleDriveCard({
  withPin,
  onToast,
  enabled,
  toggling,
  onToggle,
}: {
  withPin: WithPin;
  onToast: (t: ToastMessage) => void;
  enabled: boolean | undefined;
  toggling: boolean;
  onToggle: (next: boolean) => void;
}) {
  const reduceMotion = useReducedMotion();
  const [drive, setDrive] = useState<GoogleDriveSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getGoogleDriveSettings()
      .then((r) => {
        if (!cancelled) setDrive(r);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof ApiError ? err.message : 'Could not load Google Drive status.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Back from Google's consent screen: ?drive=connected or ?drive=error&message=…
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('drive');
    if (!result) return;
    if (result === 'connected') onToast({ tone: 'success', message: 'Google Drive connected.' });
    else setError(params.get('message') || 'Could not connect Google Drive.');
    params.delete('drive');
    params.delete('message');
    const qs = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`);
    // onToast is stable for this purpose; run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect() {
    if (connecting) return;
    setConnecting(true);
    setError(null);
    setMessage(null);
    try {
      const r = await withPin('Connect a Google account for PDF uploads.', (pin) => startGoogleDriveConnect(pin));
      // A full-page navigation (not a pop-up), so browsers never block it.
      window.location.assign(r.url);
    } catch (err) {
      setConnecting(false);
      if (err instanceof PinCancelled) return;
      setError(err instanceof ApiError ? err.message : 'Could not start the Google sign-in. Try again.');
    }
  }

  async function test() {
    if (testing) return;
    setTesting(true);
    setError(null);
    setMessage(null);
    try {
      const r = await testGoogleDriveUpload();
      setMessage(`Upload test passed: a test file was saved to "${r.folderName}" and removed again.`);
      setDrive((d) => (d ? { ...d, lastError: '', needsReconnect: false } : d));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The upload test failed. Try again.');
      getGoogleDriveSettings()
        .then(setDrive)
        .catch(() => {});
    } finally {
      setTesting(false);
    }
  }

  async function disconnect() {
    if (disconnecting) return;
    setDisconnecting(true);
    try {
      const r = await withPin('Disconnect Google Drive.', (pin) => disconnectGoogleDrive(pin));
      setDrive(r);
      setDisconnectOpen(false);
      onToast({ tone: 'success', message: 'Google Drive disconnected.' });
    } catch (err) {
      if (err instanceof PinCancelled) return;
      onToast({ tone: 'error', message: err instanceof ApiError ? err.message : 'Could not disconnect. Try again.' });
    } finally {
      setDisconnecting(false);
    }
  }

  const status: { tone: 'teal' | 'amber' | 'red' | 'slate'; label: string } | null =
    drive === null
      ? null
      : !drive.clientConfigured
        ? { tone: 'amber', label: 'Not set up' }
        : drive.needsReconnect
          ? { tone: 'red', label: 'Reconnect needed' }
          : drive.connected
            ? { tone: 'teal', label: 'Connected' }
            : { tone: 'amber', label: 'Not connected' };

  return (
    <>
      <motion.section
        id="google-drive"
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={{ type: 'spring', bounce: 0, duration: 0.35, delay: 0.135 }}
        className={panel}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <CardHeading
              title="Google Drive"
              description="Exported PDFs are saved to a Drive folder and the link is emailed to the superadmin and anyone picked during export. Files stay private: only people they are shared with can open them."
            />
          </div>
          <div className="flex items-center gap-2.5">
            {toggling && <LoaderCircle size={17} className="animate-spin text-slate-400" aria-hidden />}
            {drive === null ? (
              <StatusPill tone={loadError ? 'red' : 'slate'}>{loadError ? 'Unavailable' : 'Loading…'}</StatusPill>
            ) : status && status.label !== 'Connected' ? (
              <StatusPill tone={status.tone}>{status.label}</StatusPill>
            ) : null}
            {enabled !== undefined && (
              <>
                <StatusPill tone={enabled ? 'teal' : 'slate'}>{enabled ? 'On' : 'Off'}</StatusPill>
                <Toggle
                  checked={enabled}
                  disabled={toggling}
                  label="Upload exported PDFs to Google Drive"
                  onChange={onToggle}
                />
              </>
            )}
          </div>
        </div>

        {enabled === false && (
          <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-[12.5px] leading-5 text-amber-900 ring-1 ring-inset ring-amber-600/20">
            Drive uploads are off. PDFs still download, but they are not saved to Drive and no links are emailed.
          </p>
        )}
        {loadError && <InlineNotice className="mt-4">{loadError}</InlineNotice>}
        {error && <InlineNotice className="mt-4">{error}</InlineNotice>}
        {message && <SuccessNote className="mt-4">{message}</SuccessNote>}
        {drive?.needsReconnect && (
          <InlineNotice className="mt-4">
            Google ended the connection (apps in &ldquo;Testing&rdquo; mode expire after 7 days). Click Reconnect.
          </InlineNotice>
        )}
        {drive && !drive.clientConfigured && (
          <InlineNotice className="mt-4">
            Add DEFAULT_GOOGLE_DRIVE_CLIENT_ID and DEFAULT_GOOGLE_DRIVE_CLIENT_SECRET to the server .env, then restart
            the server.
          </InlineNotice>
        )}

        {drive && drive.clientConfigured && (
          <ConfigureSection
            id="drive-config"
            label="Connection & folder"
            defaultOpen={!drive.connected || drive.needsReconnect}
            summary={
              drive.connected ? (
                <span className="truncate">{drive.accountEmail || 'Connected account'}</span>
              ) : (
                <span>No account connected</span>
              )
            }
          >
            <div className="space-y-4">
              <dl className="grid gap-3 text-[12.5px] sm:grid-cols-2">
                <div className="rounded-xl bg-white px-3.5 py-3 ring-1 ring-inset ring-slate-200">
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Google account</dt>
                  <dd className="mt-1 break-all text-slate-700">
                    {drive.connected ? drive.accountEmail || 'Connected' : 'Not connected'}
                  </dd>
                  {drive.connectedAt && (
                    <dd className="mt-0.5 text-[11.5px] text-slate-500">Since {formatDateTime(drive.connectedAt)}</dd>
                  )}
                </div>
                <div className="rounded-xl bg-white px-3.5 py-3 ring-1 ring-inset ring-slate-200">
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Upload folder</dt>
                  <dd className="mt-1 text-slate-700">
                    {drive.folderUrl ? (
                      <a
                        href={drive.folderUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-teal-700 underline-offset-4 hover:underline"
                      >
                        {drive.folderName || 'Open folder'}
                      </a>
                    ) : (
                      'Chosen when you connect'
                    )}
                  </dd>
                  {drive.lastUploadAt && (
                    <dd className="mt-0.5 text-[11.5px] text-slate-500">
                      Last upload {formatDateTime(drive.lastUploadAt)}
                    </dd>
                  )}
                </div>
              </dl>

              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={connect} disabled={connecting} className={primaryButton}>
                  {connecting ? (
                    <LoaderCircle size={16} className="animate-spin" aria-hidden />
                  ) : (
                    <KeyRound size={16} aria-hidden />
                  )}
                  {connecting
                    ? 'Opening Google…'
                    : drive.needsReconnect
                      ? 'Reconnect Google Drive'
                      : drive.connected
                        ? 'Switch account'
                        : 'Connect Google Drive'}
                </button>
                {drive.connected && (
                  <button
                    type="button"
                    onClick={test}
                    disabled={testing || drive.needsReconnect}
                    className={secondaryButton}
                  >
                    {testing ? (
                      <LoaderCircle size={16} className="animate-spin" aria-hidden />
                    ) : (
                      <RefreshCw size={16} aria-hidden />
                    )}
                    {testing ? 'Testing…' : 'Test upload'}
                  </button>
                )}
                {drive.connected && (
                  <button type="button" onClick={() => setDisconnectOpen(true)} className={secondaryButton}>
                    <RotateCcw size={16} aria-hidden /> Disconnect
                  </button>
                )}
              </div>

              <p className="text-[12px] leading-5 text-slate-500">
                Sign in with the Google account that should own the PDFs (ideally the superadmin&apos;s). HealthCentria
                only gets access to files it creates, never the rest of the Drive. If it can&apos;t use the folder set
                in .env, it creates its own &ldquo;HealthCentria Reports&rdquo; folder, which you can move anywhere in
                Drive.
              </p>
            </div>
          </ConfigureSection>
        )}
      </motion.section>

      {disconnectOpen && (
        <ResetDialog
          title="Disconnect Google Drive?"
          description={
            <>
              New PDFs will no longer be saved to Drive or emailed until an account is connected again. Files already
              in Drive are not deleted.
            </>
          }
          busy={disconnecting}
          onCancel={() => setDisconnectOpen(false)}
          onConfirm={disconnect}
        />
      )}
    </>
  );
}

function AdminSettings() {
  const [pinRequest, setPinRequest] = useState<PinRequest | null>(null);
  /** Opens the PIN prompt and runs `run(pin)`; resolves with its result once the server accepts the PIN. */
  const withPin = useCallback(
    <T,>(title: string, run: (pin: string) => Promise<T>): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        setPinRequest({ title, run, resolve: resolve as (value: unknown) => void, reject });
      }),
    [],
  );
  const closePin = useCallback(() => setPinRequest(null), []);
  const reduceMotion = useReducedMotion();
  const session = getSession();
  const today = getTodayService();
  const [settings, setSettings] = useState<AuthSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [google, setGoogle] = useState<GoogleIntegrationSettings | null>(null);
  const [googleLoadError, setGoogleLoadError] = useState<string | null>(null);
  const [googleClientId, setGoogleClientId] = useState('');
  const [googleClientSecret, setGoogleClientSecret] = useState('');
  const [googleSaving, setGoogleSaving] = useState(false);
  const [googleResetting, setGoogleResetting] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const [email, setEmail] = useState<EmailIntegrationSettings | null>(null);
  const [emailLoadError, setEmailLoadError] = useState<string | null>(null);
  const [emailHost, setEmailHost] = useState('');
  const [emailPort, setEmailPort] = useState('');
  const [emailUser, setEmailUser] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailFrom, setEmailFrom] = useState('');
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailTesting, setEmailTesting] = useState(false);
  const [emailResetting, setEmailResetting] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailMessage, setEmailMessage] = useState<string | null>(null);
  const [emailResetOpen, setEmailResetOpen] = useState(false);

  const [recaptcha, setRecaptchaKeys] = useState<RecaptchaIntegrationSettings | null>(null);
  const [recaptchaLoadError, setRecaptchaLoadError] = useState<string | null>(null);
  // The active site key is public; the test challenge needs it when only the
  // secret is being replaced.
  const [activeSiteKey, setActiveSiteKey] = useState('');
  const [recaptchaSiteKey, setRecaptchaSiteKey] = useState('');
  const [recaptchaSecretKey, setRecaptchaSecretKey] = useState('');
  const [recaptchaTestKey, setRecaptchaTestKey] = useState<string | null>(null);
  const [recaptchaTestToken, setRecaptchaTestToken] = useState<string | null>(null);
  const [recaptchaSaving, setRecaptchaSaving] = useState(false);
  const [recaptchaResetting, setRecaptchaResetting] = useState(false);
  const [recaptchaResetOpen, setRecaptchaResetOpen] = useState(false);
  const [recaptchaError, setRecaptchaError] = useState<string | null>(null);

  const [calendar, setCalendar] = useState<GoogleCalendarSettings | null>(null);
  const [calendarLoadError, setCalendarLoadError] = useState<string | null>(null);
  const [calendarSaving, setCalendarSaving] = useState(false);
  const [calendarTesting, setCalendarTesting] = useState(false);
  const [calendarSyncing, setCalendarSyncing] = useState(false);
  const [calendarActionError, setCalendarActionError] = useState<string | null>(null);
  const [calendarMessage, setCalendarMessage] = useState<string | null>(null);

  const [reportRange, setReportRange] = useState<'30' | '90'>('30');
  const [reportExporting, setReportExporting] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportMessage, setReportMessage] = useState<string | null>(null);

  const dismissToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    let cancelled = false;
    getAuthSettings()
      .then((r) => {
        if (!cancelled) setSettings(r.settings);
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load settings. Reload the page to try again.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getGoogleIntegrationSettings()
      .then((r) => {
        if (!cancelled) {
          setGoogle({
            clientIdMasked: r.clientIdMasked,
            clientSecretMasked: r.clientSecretMasked,
            source: r.source,
          });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setGoogleLoadError(
            err instanceof ApiError ? err.message : 'Could not load Google credentials. Reload the page to try again.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getGoogleCalendarSettings()
      .then((r) => {
        if (!cancelled) {
          setCalendar(r);
          setCalendarLoadError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setCalendarLoadError(
            err instanceof ApiError
              ? err.message
              : 'Could not load Google Calendar status. Reload the page to try again.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getEmailIntegrationSettings()
      .then((r) => {
        if (!cancelled) {
          setEmail({
            host: r.host,
            port: r.port,
            userMasked: r.userMasked,
            passwordSet: r.passwordSet,
            fromAddress: r.fromAddress,
            source: r.source,
            configured: r.configured,
            lastTestedAt: r.lastTestedAt,
            lastTestOk: r.lastTestOk,
            lastTestError: r.lastTestError,
          });
          setEmailLoadError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setEmailLoadError(
            err instanceof ApiError ? err.message : 'Could not load email settings. Reload the page to try again.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshActiveSiteKey = useCallback(() => {
    getPublicSettings()
      .then((r) => setActiveSiteKey(r.recaptchaSiteKey ?? ''))
      .catch(() => {
        // Only needed for the test challenge; the admin can still type a site key.
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    getRecaptchaIntegrationSettings()
      .then((r) => {
        if (!cancelled) {
          setRecaptchaKeys({
            siteKeyMasked: r.siteKeyMasked,
            secretKeyMasked: r.secretKeyMasked,
            source: r.source,
            configured: r.configured,
          });
          setRecaptchaLoadError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setRecaptchaLoadError(
            err instanceof ApiError ? err.message : 'Could not load reCAPTCHA keys. Reload the page to try again.',
          );
        }
      });
    refreshActiveSiteKey();
    return () => {
      cancelled = true;
    };
  }, [refreshActiveSiteKey]);

  /** Any edit invalidates a previous test: it was solved against other keys. */
  function clearRecaptchaTest() {
    setRecaptchaTestKey(null);
    setRecaptchaTestToken(null);
    setRecaptchaError(null);
  }

  function startRecaptchaTest() {
    const key = recaptchaSiteKey.trim() || activeSiteKey;
    if (!key) {
      setRecaptchaError('Enter a site key first.');
      return;
    }
    setRecaptchaError(null);
    setRecaptchaTestToken(null);
    setRecaptchaTestKey(key);
  }

  async function saveRecaptchaKeys(e: FormEvent) {
    e.preventDefault();
    if (recaptchaSaving || !recaptchaTestToken || !recaptchaTestKey) return;
    const siteKey = recaptchaSiteKey.trim();
    const secretKey = recaptchaSecretKey.trim();
    if (!siteKey && !secretKey) return;

    setRecaptchaSaving(true);
    setRecaptchaError(null);
    try {
      const token = recaptchaTestToken;
      const r = await withPin('Save new reCAPTCHA keys.', (pin) =>
        updateRecaptchaIntegrationSettings(
          {
            ...(siteKey ? { siteKey } : {}),
            ...(secretKey ? { secretKey } : {}),
            testToken: token,
          },
          pin,
        ),
      );
      setRecaptchaKeys({
        siteKeyMasked: r.siteKeyMasked,
        secretKeyMasked: r.secretKeyMasked,
        source: r.source,
        configured: r.configured,
      });
      setActiveSiteKey(recaptchaTestKey);
      setRecaptchaSiteKey('');
      setRecaptchaSecretKey('');
      clearRecaptchaTest();
      setRecaptchaLoadError(null);
      setToast({ tone: 'success', message: 'reCAPTCHA keys verified and saved.' });
    } catch (err) {
      if (err instanceof PinCancelled) return;
      // A token is single-use: whatever happened, the admin must solve a new one.
      setRecaptchaTestToken(null);
      setRecaptchaTestKey(null);
      setRecaptchaError(
        err instanceof ApiError
          ? (err.errors?.testToken?.[0] ?? err.errors?.siteKey?.[0] ?? err.errors?.secretKey?.[0] ?? err.message)
          : 'Could not save the reCAPTCHA keys. Try again.',
      );
    } finally {
      setRecaptchaSaving(false);
    }
  }

  async function resetRecaptchaKeys() {
    if (recaptchaResetting) return;
    setRecaptchaResetting(true);
    try {
      const r = await withPin('Reset reCAPTCHA keys to the server defaults.', (pin) =>
        resetRecaptchaIntegrationSettings(pin),
      );
      setRecaptchaKeys({
        siteKeyMasked: r.siteKeyMasked,
        secretKeyMasked: r.secretKeyMasked,
        source: r.source,
        configured: r.configured,
      });
      setRecaptchaSiteKey('');
      setRecaptchaSecretKey('');
      clearRecaptchaTest();
      setRecaptchaResetOpen(false);
      refreshActiveSiteKey();
      setToast({ tone: 'success', message: 'reCAPTCHA keys reset to the server defaults.' });
    } catch (err) {
      if (err instanceof PinCancelled) return;
      setToast({
        tone: 'error',
        message: err instanceof ApiError ? err.message : 'Could not reset reCAPTCHA keys. Try again.',
      });
    } finally {
      setRecaptchaResetting(false);
    }
  }

  async function setGoogleSignIn(next: boolean) {
    if (!settings || saving) return;
    const previous = settings;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      // The switch flips only after the PIN is accepted and the change is saved.
      const r = await withPin(`Turn Google sign-in ${next ? 'on' : 'off'}.`, (pin) =>
        updateAuthSettings({ googleSignInEnabled: next }, pin),
      );
      setSettings(r.settings);
      setSaved(true);
    } catch (err) {
      setSettings(previous);
      if (err instanceof PinCancelled) return;
      setSaveError(err instanceof ApiError ? err.message : 'Could not save the setting. Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function setRecaptcha(next: boolean) {
    if (!settings || saving) return;
    const previous = settings;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const r = await withPin(`Turn reCAPTCHA protection ${next ? 'on' : 'off'}.`, (pin) =>
        updateAuthSettings({ recaptchaEnabled: next }, pin),
      );
      setSettings(r.settings);
      setSaved(true);
    } catch (err) {
      setSettings(previous);
      if (err instanceof PinCancelled) return;
      setSaveError(err instanceof ApiError ? err.message : 'Could not save the setting. Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function setNotificationEmails(next: boolean) {
    if (!settings || saving) return;
    const previous = settings;
    setSaving(true);
    try {
      const r = await withPin(`Turn notification emails ${next ? 'on' : 'off'}.`, (pin) =>
        updateAuthSettings({ notificationEmailsEnabled: next }, pin),
      );
      setSettings(r.settings);
      setToast({ tone: 'success', message: `Notification emails ${next ? 'turned on' : 'turned off'}.` });
    } catch (err) {
      setSettings(previous);
      if (err instanceof PinCancelled) return;
      setToast({
        tone: 'error',
        message: err instanceof ApiError ? err.message : 'Could not save the notification email setting. Try again.',
      });
    } finally {
      setSaving(false);
    }
  }

  async function setDriveEnabled(next: boolean) {
    if (!settings || saving) return;
    const previous = settings;
    setSaving(true);
    try {
      const r = await withPin(`Turn Google Drive uploads ${next ? 'on' : 'off'}.`, (pin) =>
        updateAuthSettings({ googleDriveEnabled: next }, pin),
      );
      setSettings(r.settings);
      setToast({ tone: 'success', message: `Google Drive uploads ${next ? 'turned on' : 'turned off'}.` });
    } catch (err) {
      setSettings(previous);
      if (err instanceof PinCancelled) return;
      setToast({
        tone: 'error',
        message: err instanceof ApiError ? err.message : 'Could not save the Google Drive setting. Try again.',
      });
    } finally {
      setSaving(false);
    }
  }

  async function setSheetsEnabled(next: boolean) {
    if (!settings || saving) return;
    const previous = settings;
    setSaving(true);
    try {
      const r = await withPin(`Turn Google Sheets export ${next ? 'on' : 'off'}.`, (pin) =>
        updateAuthSettings({ googleSheetsEnabled: next }, pin),
      );
      setSettings(r.settings);
      setToast({ tone: 'success', message: `Google Sheets export ${next ? 'turned on' : 'turned off'}.` });
    } catch (err) {
      setSettings(previous);
      if (err instanceof PinCancelled) return;
      setToast({
        tone: 'error',
        message: err instanceof ApiError ? err.message : 'Could not save the Google Sheets setting. Try again.',
      });
    } finally {
      setSaving(false);
    }
  }

  async function saveGoogleCredentials(e: FormEvent) {
    e.preventDefault();
    if (googleSaving) return;
    const clientId = googleClientId.trim();
    const clientSecret = googleClientSecret.trim();
    if (!clientId && !clientSecret) return;

    setGoogleSaving(true);
    try {
      const r = await withPin('Save new Google sign-in credentials.', (pin) =>
        updateGoogleIntegrationSettings(
          {
            ...(clientId ? { clientId } : {}),
            ...(clientSecret ? { clientSecret } : {}),
          },
          pin,
        ),
      );
      setGoogle({
        clientIdMasked: r.clientIdMasked,
        clientSecretMasked: r.clientSecretMasked,
        source: r.source,
      });
      setGoogleClientId('');
      setGoogleClientSecret('');
      setGoogleLoadError(null);
      setToast({ tone: 'success', message: 'Google credentials saved.' });
    } catch (err) {
      if (err instanceof PinCancelled) return;
      setToast({
        tone: 'error',
        message: err instanceof ApiError ? err.message : 'Could not save Google credentials. Try again.',
      });
    } finally {
      setGoogleSaving(false);
    }
  }

  async function resetGoogleCredentials() {
    if (googleResetting) return;
    setGoogleResetting(true);
    try {
      const r = await withPin('Reset Google sign-in credentials to the server defaults.', (pin) =>
        resetGoogleIntegrationSettings(pin),
      );
      setGoogle({
        clientIdMasked: r.clientIdMasked,
        clientSecretMasked: r.clientSecretMasked,
        source: r.source,
      });
      setGoogleClientId('');
      setGoogleClientSecret('');
      setGoogleLoadError(null);
      setResetOpen(false);
      setToast({ tone: 'success', message: 'Google credentials reset to the server defaults.' });
    } catch (err) {
      if (err instanceof PinCancelled) return;
      setToast({
        tone: 'error',
        message: err instanceof ApiError ? err.message : 'Could not reset Google credentials. Try again.',
      });
    } finally {
      setGoogleResetting(false);
    }
  }

  function applyEmailSettings(r: EmailIntegrationSettings) {
    setEmail({
      host: r.host,
      port: r.port,
      userMasked: r.userMasked,
      passwordSet: r.passwordSet,
      fromAddress: r.fromAddress,
      source: r.source,
      configured: r.configured,
      lastTestedAt: r.lastTestedAt,
      lastTestOk: r.lastTestOk,
      lastTestError: r.lastTestError,
    });
    setEmailHost('');
    setEmailPort('');
    setEmailUser('');
    setEmailPassword('');
    setEmailFrom('');
  }

  async function saveEmailSettings(e: FormEvent) {
    e.preventDefault();
    if (emailSaving) return;
    const host = emailHost.trim();
    const portText = emailPort.trim();
    const user = emailUser.trim();
    const password = emailPassword;
    const fromAddress = emailFrom.trim();

    if (!host && !portText && !user && !password && !fromAddress) return;

    if (portText) {
      const port = Number(portText);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        setEmailError('Port must be a number between 1 and 65535.');
        return;
      }
    }

    setEmailSaving(true);
    setEmailError(null);
    setEmailMessage(null);
    try {
      const r = await withPin('Save new email delivery (SMTP) settings.', (pin) =>
        updateEmailIntegrationSettings(
          {
            ...(host ? { host } : {}),
            ...(portText ? { port: Number(portText) } : {}),
            ...(user ? { user } : {}),
            ...(password ? { password } : {}),
            ...(fromAddress ? { fromAddress } : {}),
          },
          pin,
        ),
      );
      applyEmailSettings(r);
      setEmailLoadError(null);
      setToast({ tone: 'success', message: 'Email delivery settings saved.' });
    } catch (err) {
      if (err instanceof PinCancelled) return;
      setEmailError(err instanceof ApiError ? err.message : 'Could not save email settings. Try again.');
    } finally {
      setEmailSaving(false);
    }
  }

  async function testEmailSettings() {
    if (emailTesting) return;
    setEmailTesting(true);
    setEmailError(null);
    setEmailMessage(null);
    try {
      const r = await testEmailDelivery();
      setEmailMessage(r.message);
    } catch (err) {
      setEmailError(err instanceof ApiError ? err.message : 'Could not send the test email. Try again.');
    } finally {
      setEmailTesting(false);
    }
  }

  async function resetEmailSettings() {
    if (emailResetting) return;
    setEmailResetting(true);
    try {
      const r = await withPin('Reset email delivery to the server defaults.', (pin) =>
        resetEmailIntegrationSettings(pin),
      );
      applyEmailSettings(r);
      setEmailLoadError(null);
      setEmailResetOpen(false);
      setToast({ tone: 'success', message: 'Email settings reset to the server defaults.' });
    } catch (err) {
      if (err instanceof PinCancelled) return;
      setToast({
        tone: 'error',
        message: err instanceof ApiError ? err.message : 'Could not reset email settings. Try again.',
      });
    } finally {
      setEmailResetting(false);
    }
  }

  async function setCalendarSync(next: boolean) {
    if (!calendar || calendarSaving) return;
    const previous = calendar;
    setCalendarSaving(true);
    setCalendarActionError(null);
    setCalendarMessage(null);
    try {
      const r = await withPin(`Turn Google Calendar sync ${next ? 'on' : 'off'}.`, (pin) =>
        updateGoogleCalendarSettings({ enabled: next }, pin),
      );
      setCalendar(r);
      setCalendarMessage(`Automatic calendar sync ${next ? 'enabled' : 'disabled'}.`);
    } catch (err) {
      setCalendar(previous);
      if (err instanceof PinCancelled) return;
      setCalendarActionError(
        err instanceof ApiError ? err.message : 'Could not save the calendar setting. Try again.',
      );
    } finally {
      setCalendarSaving(false);
    }
  }

  async function testCalendar() {
    if (!calendar?.configured || calendarTesting) return;
    setCalendarTesting(true);
    setCalendarActionError(null);
    setCalendarMessage(null);
    try {
      const r = await testGoogleCalendarConnection();
      setCalendarMessage(`Connected to Google Calendar (${r.calendarId}).`);
    } catch (err) {
      setCalendarActionError(
        err instanceof ApiError ? err.message : 'Could not connect to Google Calendar. Try again.',
      );
    } finally {
      setCalendarTesting(false);
    }
  }

  async function syncCalendarNow() {
    if (!calendar?.configured || calendarSyncing) return;
    setCalendarSyncing(true);
    setCalendarActionError(null);
    setCalendarMessage(null);
    try {
      const r = await syncGoogleCalendar();
      setCalendar(r.status);
      const failed = r.retried.failed + r.upcoming.failed;
      if (failed > 0) {
        setCalendarActionError(
          `Sync finished with ${failed} failed item(s). Check the calendar sharing and server logs, then try again.`,
        );
      } else {
        setCalendarMessage(
          `Sync finished. Retried ${r.retried.ok}/${r.retried.total}; upcoming ${r.upcoming.ok}/${r.upcoming.total}.`,
        );
      }
    } catch (err) {
      setCalendarActionError(
        err instanceof ApiError ? err.message : 'Could not sync with Google Calendar. Try again.',
      );
    } finally {
      setCalendarSyncing(false);
    }
  }

  async function exportReportCsv() {
    if (reportExporting) return;
    setReportExporting(true);
    setReportError(null);
    setReportMessage(null);
    try {
      await downloadVisitsCsv(Number(reportRange));
      setReportMessage(`Visits report for the last ${reportRange} days downloaded.`);
    } catch (err) {
      setReportError(err instanceof ApiError ? err.message : 'Could not generate the report. Try again.');
    } finally {
      setReportExporting(false);
    }
  }

  const googleOn = settings?.googleSignInEnabled ?? false;
  // Every on/off switch on the page counts toward the header summary — add
  // future toggles to this list and the "x of y active" pill follows.
  const accessToggles = [
    ...(settings
      ? [
          settings.googleSignInEnabled,
          settings.recaptchaEnabled,
          settings.notificationEmailsEnabled,
          settings.googleSheetsEnabled,
          settings.googleDriveEnabled,
        ]
      : []),
    ...(calendar ? [calendar.enabled] : []),
  ];
  const activeToggles = accessToggles.filter(Boolean).length;
  const hasNewGoogleValue = Boolean(googleClientId.trim() || googleClientSecret.trim());
  const hasNewEmailValue = Boolean(
    emailHost.trim() || emailPort.trim() || emailUser.trim() || emailPassword || emailFrom.trim(),
  );

  return (
    <>
      <DashboardShell
        title="Settings"
        subtitle="Sign-in methods and connected services"
        roleLabel="Admin"
        userName={session?.name}
        userEmail={session?.email ?? ''}
        todayService={`${today.name} — ${today.detail}`}
        nav={adminNav}
        notificationsTo="/staff/notifications"
        mainClassName="max-w-3xl"
      >
        <motion.div
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
          transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
        >
          <PageHero
            eyebrow="Access & integrations"
            title="Access Controls"
            description="Control the integrations and protections that keep the clinic portal secure and connected. Each card shows its on/off switch and status; open Configure only when you need to change credentials."
            action={
              settings === null ? (
                <StatusPill tone={loadError ? 'red' : 'slate'}>
                  {loadError ? 'Unavailable' : 'Checking status…'}
                </StatusPill>
              ) : (
                <StatusPill tone="teal" className="normal-case">
                  {activeToggles} of {accessToggles.length} active
                </StatusPill>
              )
            }
          />
        </motion.div>

        <SectionLabel>Sign-in &amp; security</SectionLabel>

        <motion.section
          id="google-integration"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
          transition={{ type: 'spring', bounce: 0, duration: 0.35, delay: 0.04 }}
          className={panel}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-xl">
              <CardHeading
                title="Google sign-in"
                description="Let patients sign in with their Google account. Turning this off hides the Google button on the login page and blocks the Google sign-in route. Email and password login keeps working."
              />
            </div>

            <div className="flex items-center gap-3">
              {saving && <LoaderCircle size={17} className="animate-spin text-slate-400" aria-hidden />}
              {settings === null ? (
                <StatusPill tone={loadError ? 'red' : 'slate'}>{loadError ? 'Unavailable' : 'Loading…'}</StatusPill>
              ) : (
                <div className="flex items-center gap-2.5">
                  <StatusPill tone={googleOn ? 'teal' : 'slate'}>{googleOn ? 'On' : 'Off'}</StatusPill>
                  <Toggle
                    checked={googleOn}
                    disabled={saving}
                    label="Allow Google sign-in"
                    onChange={setGoogleSignIn}
                  />
                </div>
              )}
            </div>
          </div>

          {loadError && <InlineNotice className="mt-4">{loadError}</InlineNotice>}
          {saveError && <InlineNotice className="mt-4">{saveError}</InlineNotice>}

          {settings && !settings.googleConfigured && (
            <div className="mt-4 flex items-start gap-2 rounded-xl bg-slate-50 px-3.5 py-2.5 text-[12.5px] leading-5 text-slate-600 ring-1 ring-inset ring-slate-200">
              <ShieldAlert size={15} className="mt-0.5 shrink-0 text-amber-600" aria-hidden />
              <span>
                Google OAuth credentials are not configured on this server, so Google sign-in cannot work either
                way. Add them under Configure credentials below.
              </span>
            </div>
          )}

          {settings && settings.googleConfigured && !googleOn && (
            <p className="mt-4 rounded-xl bg-amber-50 px-3.5 py-2.5 text-[12.5px] leading-5 text-amber-900 ring-1 ring-inset ring-amber-600/20">
              Google sign-in is off. Patients who created their account through Google and never set a password
              cannot log in until it is turned back on.
            </p>
          )}

          {settings && googleOn && (
            <SuccessNote className="mt-4 flex items-center gap-1.5">
              <ShieldCheck size={15} aria-hidden />
              Google sign-in is available to patients.
            </SuccessNote>
          )}

          {saved && <p className="mt-2.5 text-[12px] font-medium text-slate-500">Saved.</p>}

          {googleLoadError && <InlineNotice className="mt-4">{googleLoadError}</InlineNotice>}

          {google && (
            <ConfigureSection
              id="google-credentials"
              label="Configure credentials"
              defaultOpen={settings ? !settings.googleConfigured : false}
              summary={
                <>
                  {hasNewGoogleValue && <span className="font-medium text-amber-700">Unsaved changes · </span>}
                  <StatusPill tone={google.source === 'custom' ? 'teal' : 'slate'}>
                    {google.source === 'custom' ? 'Custom' : 'Default'}
                  </StatusPill>
                </>
              }
            >
              <p className="mb-4 text-[12.5px] leading-5 text-slate-500">
                Override the server&apos;s default Google OAuth credentials. Patients and staff keep using the
                normal “Continue with Google” button.
              </p>
              <form onSubmit={saveGoogleCredentials} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="google-client-id" className={fieldLabel}>
                      Client ID
                    </label>
                    <input
                      id="google-client-id"
                      type="text"
                      autoComplete="off"
                      spellCheck={false}
                      value={googleClientId}
                      onChange={(e) => setGoogleClientId(e.target.value)}
                      placeholder={compactMask(google.clientIdMasked) || 'No Client ID configured'}
                      className={cn(inputClass, 'font-mono text-[12.5px]')}
                    />
                    <p className="mt-1.5 break-all font-mono text-[11.5px] leading-5 text-slate-500">
                      Current: <span className="text-slate-700">{compactMask(google.clientIdMasked) || 'Not set'}</span>
                    </p>
                  </div>

                  <div>
                    <label htmlFor="google-client-secret" className={fieldLabel}>
                      Client Secret
                    </label>
                    <input
                      id="google-client-secret"
                      type="password"
                      autoComplete="new-password"
                      spellCheck={false}
                      value={googleClientSecret}
                      onChange={(e) => setGoogleClientSecret(e.target.value)}
                      placeholder={compactMask(google.clientSecretMasked) || 'No Client Secret configured'}
                      className={cn(inputClass, 'font-mono text-[12.5px]')}
                    />
                    <p className="mt-1.5 break-all font-mono text-[11.5px] leading-5 text-slate-500">
                      Current:{' '}
                      <span className="text-slate-700">{compactMask(google.clientSecretMasked) || 'Not set'}</span>
                    </p>
                  </div>
                </div>

                <p className="text-[12px] leading-5 text-slate-500">
                  Leave a field blank to keep its current value. The secret is encrypted on the server and is
                  never sent back to this page.
                  {google.source === 'default' && (
                    <>
                      {' '}
                      Currently using the defaults from{' '}
                      <code className="font-mono text-[11px]">apps/server/.env</code>.
                    </>
                  )}
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="submit"
                    disabled={googleSaving || !hasNewGoogleValue}
                    className={primaryButton}
                  >
                    {googleSaving ? (
                      <LoaderCircle size={16} className="animate-spin" aria-hidden />
                    ) : (
                      <KeyRound size={16} aria-hidden />
                    )}
                    {googleSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setResetOpen(true)}
                    disabled={google.source !== 'custom' || googleSaving || googleResetting}
                    title={
                      google.source === 'custom'
                        ? 'Delete custom credentials and use the .env defaults'
                        : 'Already using the .env defaults'
                    }
                    className={secondaryButton}
                  >
                    <RotateCcw size={16} aria-hidden />
                    Reset to default
                  </button>
                </div>
              </form>
            </ConfigureSection>
          )}
        </motion.section>

        <motion.section
          id="recaptcha"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
          transition={{ type: 'spring', bounce: 0, duration: 0.35, delay: 0.08 }}
          className={panel}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-xl">
              <CardHeading
                title="reCAPTCHA protection"
                description="Protect patient login and registration from automated submissions. Turning this off hides the CAPTCHA challenge and skips server-side verification."
              />
            </div>

            <div className="flex items-center gap-3">
              {saving && <LoaderCircle size={17} className="animate-spin text-slate-400" aria-hidden />}
              {settings === null ? (
                <StatusPill tone={loadError ? 'red' : 'slate'}>
                  {loadError ? 'Unavailable' : 'Loading…'}
                </StatusPill>
              ) : (
                <div className="flex items-center gap-2.5">
                  <StatusPill tone={settings.recaptchaEnabled ? 'teal' : 'slate'}>
                    {settings.recaptchaEnabled ? 'On' : 'Off'}
                  </StatusPill>
                  <Toggle
                    checked={settings.recaptchaEnabled}
                    disabled={saving}
                    label="Enable reCAPTCHA protection"
                    onChange={setRecaptcha}
                  />
                </div>
              )}
            </div>
          </div>

          {loadError && <InlineNotice className="mt-4">{loadError}</InlineNotice>}
          {saveError && <InlineNotice className="mt-4">{saveError}</InlineNotice>}
          {saved && <p className="mt-2.5 text-[12px] font-medium text-slate-500">Saved.</p>}

          {settings?.recaptchaEnabled && recaptcha && !recaptcha.configured && (
            <div className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-[12.5px] leading-5 text-amber-900 ring-1 ring-inset ring-amber-600/20">
              <ShieldAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                reCAPTCHA is on but no keys are configured, so the challenge cannot appear. Add keys under Configure
                keys below.
              </span>
            </div>
          )}

          {recaptchaLoadError && <InlineNotice className="mt-4">{recaptchaLoadError}</InlineNotice>}

          {recaptcha && (
            <ConfigureSection
              id="recaptcha-keys"
              label="Configure keys"
              defaultOpen={!recaptcha.configured}
              summary={
                <>
                  {(recaptchaSiteKey.trim() || recaptchaSecretKey.trim()) && (
                    <span className="font-medium text-amber-700">Unsaved changes · </span>
                  )}
                  <StatusPill tone={recaptcha.source === 'custom' ? 'teal' : 'slate'}>
                    {recaptcha.source === 'custom' ? 'Custom' : 'Default'}
                  </StatusPill>
                </>
              }
            >
              <p className="mb-4 text-[12.5px] leading-5 text-slate-500">
                Use a reCAPTCHA v2 &ldquo;I&apos;m not a robot&rdquo; checkbox key pair from{' '}
                <a
                  href="https://www.google.com/recaptcha/admin"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-teal-700 underline-offset-2 hover:underline"
                >
                  google.com/recaptcha/admin
                </a>
                , with this site&apos;s domain added to the key.
              </p>
              <form onSubmit={saveRecaptchaKeys} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="recaptcha-site-key" className={fieldLabel}>
                      Site key
                    </label>
                    <input
                      id="recaptcha-site-key"
                      type="text"
                      autoComplete="off"
                      spellCheck={false}
                      value={recaptchaSiteKey}
                      onChange={(e) => {
                        setRecaptchaSiteKey(e.target.value);
                        clearRecaptchaTest();
                      }}
                      placeholder={compactMask(recaptcha.siteKeyMasked) || 'No site key configured'}
                      className={cn(inputClass, 'font-mono text-[12.5px]')}
                    />
                    <p className="mt-1.5 break-all font-mono text-[11.5px] leading-5 text-slate-500">
                      Current: <span className="text-slate-700">{compactMask(recaptcha.siteKeyMasked) || 'Not set'}</span>
                    </p>
                  </div>

                  <div>
                    <label htmlFor="recaptcha-secret-key" className={fieldLabel}>
                      Secret key
                    </label>
                    <input
                      id="recaptcha-secret-key"
                      type="password"
                      autoComplete="new-password"
                      spellCheck={false}
                      value={recaptchaSecretKey}
                      onChange={(e) => {
                        setRecaptchaSecretKey(e.target.value);
                        clearRecaptchaTest();
                      }}
                      placeholder={compactMask(recaptcha.secretKeyMasked) || 'No secret key configured'}
                      className={cn(inputClass, 'font-mono text-[12.5px]')}
                    />
                    <p className="mt-1.5 break-all font-mono text-[11.5px] leading-5 text-slate-500">
                      Current:{' '}
                      <span className="text-slate-700">{compactMask(recaptcha.secretKeyMasked) || 'Not set'}</span>
                    </p>
                  </div>
                </div>

                <p className="text-[12px] leading-5 text-slate-500">
                  Leave a field blank to keep its current value. The secret is encrypted on the server and is never
                  sent back to this page.
                  {recaptcha.source === 'default' && (
                    <>
                      {' '}
                      Currently using the defaults from{' '}
                      <code className="font-mono text-[11px]">apps/server/.env</code>.
                    </>
                  )}
                </p>

                {/* Safety check: everyone (admins too) logs in through this challenge, so a
                    mismatched pair would lock the clinic out. The server only saves keys
                    after verifying a challenge solved with the new site key. */}
                {(recaptchaSiteKey.trim() || recaptchaSecretKey.trim()) && (
                  <div className="rounded-xl bg-slate-50 px-3.5 py-3 ring-1 ring-inset ring-slate-200">
                    <p className="flex items-start gap-1.5 text-[12.5px] leading-5 text-slate-600">
                      <Info size={14} className="mt-0.5 shrink-0 text-slate-400" aria-hidden />
                      <span>
                        Before saving, solve one challenge with the new keys. This makes sure they work, so a wrong
                        key can never lock staff and patients out of login.
                      </span>
                    </p>
                    {recaptchaTestKey ? (
                      <div className="mt-3 space-y-2">
                        <ReCAPTCHA
                          key={recaptchaTestKey}
                          sitekey={recaptchaTestKey}
                          onChange={(token) => setRecaptchaTestToken(token)}
                          onExpired={() => setRecaptchaTestToken(null)}
                        />
                        {recaptchaTestToken ? (
                          <p className="text-[12px] font-medium text-teal-700">Challenge solved. You can save now.</p>
                        ) : (
                          <p className="text-[12px] leading-5 text-slate-500">
                            If the box says &ldquo;Invalid domain for site key&rdquo; or &ldquo;Invalid key
                            type&rdquo;, fix the key in the reCAPTCHA admin console first.
                          </p>
                        )}
                      </div>
                    ) : (
                      <button type="button" onClick={startRecaptchaTest} className={cn(secondaryButton, 'mt-3')}>
                        <ShieldCheck size={16} aria-hidden />
                        Test the new keys
                      </button>
                    )}
                  </div>
                )}

                {recaptchaError && <InlineNotice>{recaptchaError}</InlineNotice>}

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="submit"
                    disabled={recaptchaSaving || !recaptchaTestToken}
                    title={recaptchaTestToken ? undefined : 'Test the new keys first'}
                    className={primaryButton}
                  >
                    {recaptchaSaving ? (
                      <LoaderCircle size={16} className="animate-spin" aria-hidden />
                    ) : (
                      <KeyRound size={16} aria-hidden />
                    )}
                    {recaptchaSaving ? 'Verifying…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRecaptchaResetOpen(true)}
                    disabled={recaptcha.source !== 'custom' || recaptchaSaving || recaptchaResetting}
                    title={
                      recaptcha.source === 'custom'
                        ? 'Delete custom keys and use the .env defaults'
                        : 'Already using the .env defaults'
                    }
                    className={secondaryButton}
                  >
                    <RotateCcw size={16} aria-hidden />
                    Reset to default
                  </button>
                </div>
              </form>
            </ConfigureSection>
          )}
        </motion.section>

        <SectionLabel>Connected services</SectionLabel>

        <motion.section
          id="email-delivery"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
          transition={{ type: 'spring', bounce: 0, duration: 0.35, delay: 0.1 }}
          className={panel}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-xl">
              <CardHeading
                title="Email delivery"
                description="This switch controls notification emails only: announcements, appointment confirmations and updates, and reminders. Password reset and email verification codes are always sent, even when it is off."
              />
            </div>

            <div className="flex items-center gap-3">
              {saving && <LoaderCircle size={17} className="animate-spin text-slate-400" aria-hidden />}
              {settings === null ? (
                <StatusPill tone={loadError ? 'red' : 'slate'}>{loadError ? 'Unavailable' : 'Loading…'}</StatusPill>
              ) : (
                <div className="flex items-center gap-2.5">
                  <StatusPill tone={settings.notificationEmailsEnabled ? 'teal' : 'slate'}>
                    {settings.notificationEmailsEnabled ? 'On' : 'Off'}
                  </StatusPill>
                  <Toggle
                    checked={settings.notificationEmailsEnabled}
                    disabled={saving}
                    label="Send notification emails"
                    onChange={setNotificationEmails}
                  />
                </div>
              )}
            </div>
          </div>

          {settings && !settings.notificationEmailsEnabled && (
            <p className="mt-4 rounded-xl bg-amber-50 px-3.5 py-2.5 text-[12.5px] leading-5 text-amber-900 ring-1 ring-inset ring-amber-600/20">
              Notification emails are off. Announcements, appointment updates, and reminders still appear in the app,
              but patients are not emailed. Password reset and verification codes are still sent.
            </p>
          )}

          {emailLoadError && <InlineNotice className="mt-4">{emailLoadError}</InlineNotice>}
          {emailError && <InlineNotice className="mt-4">{emailError}</InlineNotice>}
          {emailMessage && <SuccessNote className="mt-4">{emailMessage}</SuccessNote>}

          {email && !email.configured && (
            <div className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-[12.5px] leading-5 text-amber-900 ring-1 ring-inset ring-amber-600/20">
              <ShieldAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                No SMTP account is configured, so password reset codes and announcements are not being sent.
                Add your mail provider&apos;s details below.
              </span>
            </div>
          )}

          {email?.lastTestOk === false && email.lastTestError && (
            <InlineNotice className="mt-4">Last test failed: {email.lastTestError}</InlineNotice>
          )}

          {email && (
            <ConfigureSection
              id="email-settings"
              label="Configure SMTP"
              defaultOpen={!email.configured}
              summary={
                <>
                  {hasNewEmailValue && <span className="font-medium text-amber-700">Unsaved changes · </span>}
                  {!email.configured ? (
                    <StatusPill tone="amber">Not configured</StatusPill>
                  ) : email.lastTestOk === false ? (
                    <StatusPill tone="red">Last test failed</StatusPill>
                  ) : (
                    <StatusPill tone="teal">Working</StatusPill>
                  )}{' '}
                  {email.host && (
                    <span className="font-mono text-[11.5px]">
                      {email.host}:{email.port}
                    </span>
                  )}{' '}
                  <StatusPill tone={email.source === 'custom' ? 'teal' : 'slate'}>
                    {email.source === 'custom' ? 'Custom' : 'Default'}
                  </StatusPill>
                </>
              }
            >
              <form onSubmit={saveEmailSettings} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="email-host" className={fieldLabel}>
                      SMTP host
                    </label>
                    <input
                      id="email-host"
                      type="text"
                      autoComplete="off"
                      spellCheck={false}
                      value={emailHost}
                      onChange={(e) => setEmailHost(e.target.value)}
                      placeholder={email.host || 'smtp-relay.brevo.com'}
                      className={cn(inputClass, 'font-mono text-[12.5px]')}
                    />
                    <p className="mt-1.5 break-all font-mono text-[11.5px] leading-5 text-slate-500">
                      Current: <span className="text-slate-700">{email.host || 'Not set'}</span>
                    </p>
                  </div>

                  <div>
                    <label htmlFor="email-port" className={fieldLabel}>
                      Port
                    </label>
                    <input
                      id="email-port"
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      value={emailPort}
                      onChange={(e) => setEmailPort(e.target.value)}
                      placeholder={String(email.port || 587)}
                      className={cn(inputClass, 'font-mono text-[12.5px]')}
                    />
                    <p className="mt-1.5 font-mono text-[11.5px] leading-5 text-slate-500">
                      Current: <span className="text-slate-700">{email.port || 'Not set'}</span>
                    </p>
                  </div>

                  <div>
                    <label htmlFor="email-user" className={fieldLabel}>
                      Username
                    </label>
                    <input
                      id="email-user"
                      type="text"
                      autoComplete="off"
                      spellCheck={false}
                      value={emailUser}
                      onChange={(e) => setEmailUser(e.target.value)}
                      placeholder={compactMask(email.userMasked) || 'No username configured'}
                      className={cn(inputClass, 'font-mono text-[12.5px]')}
                    />
                    <p className="mt-1.5 break-all font-mono text-[11.5px] leading-5 text-slate-500">
                      Current: <span className="text-slate-700">{compactMask(email.userMasked) || 'Not set'}</span>
                    </p>
                  </div>

                  <div>
                    <label htmlFor="email-password" className={fieldLabel}>
                      Password or API key
                    </label>
                    <input
                      id="email-password"
                      type="password"
                      autoComplete="new-password"
                      spellCheck={false}
                      value={emailPassword}
                      onChange={(e) => setEmailPassword(e.target.value)}
                      placeholder={email.passwordSet ? 'Stored — leave blank to keep' : 'No password configured'}
                      className={cn(inputClass, 'font-mono text-[12.5px]')}
                    />
                    <p className="mt-1.5 font-mono text-[11.5px] leading-5 text-slate-500">
                      Current: <span className="text-slate-700">{email.passwordSet ? 'Stored' : 'Not set'}</span>
                    </p>
                  </div>
                </div>

                <div>
                  <label htmlFor="email-from" className={fieldLabel}>
                    From address
                  </label>
                  <input
                    id="email-from"
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    value={emailFrom}
                    onChange={(e) => setEmailFrom(e.target.value)}
                    placeholder={email.fromAddress || 'HealthCentria <clinic@your-domain.com>'}
                    className={cn(inputClass, 'font-mono text-[12.5px]')}
                  />
                  <p className="mt-1.5 break-all font-mono text-[11.5px] leading-5 text-slate-500">
                    Current: <span className="text-slate-700">{email.fromAddress || 'Not set'}</span>
                  </p>
                </div>

                <p className="text-[12px] leading-5 text-slate-500">
                  Leave a field blank to keep its current value. The password is encrypted on the server and is
                  never sent back to this page.
                  {email.source === 'default' && (
                    <>
                      {' '}
                      Currently using the defaults from{' '}
                      <code className="font-mono text-[11px]">apps/server/.env</code>.
                    </>
                  )}
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  <button type="submit" disabled={emailSaving || !hasNewEmailValue} className={primaryButton}>
                    {emailSaving ? (
                      <LoaderCircle size={16} className="animate-spin" aria-hidden />
                    ) : (
                      <Mail size={16} aria-hidden />
                    )}
                    {emailSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={testEmailSettings}
                    disabled={emailTesting || emailSaving || !email.configured}
                    className={secondaryButton}
                  >
                    {emailTesting ? (
                      <LoaderCircle size={16} className="animate-spin" aria-hidden />
                    ) : (
                      <Send size={16} aria-hidden />
                    )}
                    {emailTesting ? 'Sending…' : 'Send test email'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEmailResetOpen(true)}
                    disabled={email.source !== 'custom' || emailSaving || emailResetting}
                    title={
                      email.source === 'custom'
                        ? 'Delete custom SMTP settings and use the .env defaults'
                        : 'Already using the .env defaults'
                    }
                    className={secondaryButton}
                  >
                    <RotateCcw size={16} aria-hidden />
                    Reset to default
                  </button>
                </div>

                <p className="text-[12px] leading-5 text-slate-500">
                  The test email is sent to your own admin address. If it fails, the mail provider&apos;s error
                  appears at the top of this card.
                </p>

                {email.lastTestOk === true && (
                  <SuccessNote>Last test succeeded {formatDateTime(email.lastTestedAt)}.</SuccessNote>
                )}
              </form>
            </ConfigureSection>
          )}
        </motion.section>

        <motion.section
          id="google-calendar"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
          transition={{ type: 'spring', bounce: 0, duration: 0.35, delay: 0.12 }}
          className={panel}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-xl">
              <CardHeading
                title="Google Calendar"
                description="Mirror confirmed appointments and walk-ins to one clinic calendar. Pending requests stay in the app. This is additive — booking, confirmation, and cancellation keep working if Google is unavailable."
              />
            </div>

            <div className="flex items-center gap-3">
              {calendarSaving && <LoaderCircle size={17} className="animate-spin text-slate-400" aria-hidden />}
              {calendar === null ? (
                <StatusPill tone={calendarLoadError ? 'red' : 'slate'}>
                  {calendarLoadError ? 'Unavailable' : 'Loading…'}
                </StatusPill>
              ) : (
                <div className="flex items-center gap-2.5">
                  <StatusPill tone={calendar.enabled ? 'teal' : 'slate'}>
                    {calendar.enabled ? 'On' : 'Off'}
                  </StatusPill>
                  <Toggle
                    checked={calendar.enabled}
                    disabled={calendarSaving || calendarTesting || calendarSyncing}
                    label="Sync confirmed appointments to Google Calendar"
                    onChange={setCalendarSync}
                  />
                </div>
              )}
            </div>
          </div>

          {calendarLoadError && <InlineNotice className="mt-4">{calendarLoadError}</InlineNotice>}
          {calendarActionError && <InlineNotice className="mt-4">{calendarActionError}</InlineNotice>}
          {calendarMessage && <SuccessNote className="mt-4">{calendarMessage}</SuccessNote>}
          {calendar?.configured && calendar.lastError && (
            <InlineNotice className="mt-4">Last sync error: {calendar.lastError}</InlineNotice>
          )}

          {calendar && calendar.configured && (
            <ConfigureSection
              id="calendar-details"
              label="Details & sync"
              summary={
                <span className={calendar.failed > 0 ? 'font-medium text-red-700' : undefined}>
                  {calendar.synced} synced · {calendar.failed} failed
                </span>
              }
            >
              <div className="space-y-4">
                <dl className="grid gap-3 text-[12.5px] sm:grid-cols-2">
                  <div className="rounded-xl bg-white px-3.5 py-3 ring-1 ring-inset ring-slate-200">
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Calendar ID</dt>
                    <dd className="mt-1 break-all font-mono text-[11.5px] leading-5 text-slate-700">
                      {calendar.calendarId || 'Not set'}
                    </dd>
                  </div>
                  <div className="rounded-xl bg-white px-3.5 py-3 ring-1 ring-inset ring-slate-200">
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Time zone</dt>
                    <dd className="mt-1 text-slate-700">{calendar.timezone}</dd>
                  </div>
                  <div className="rounded-xl bg-white px-3.5 py-3 ring-1 ring-inset ring-slate-200">
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Last successful sync
                    </dt>
                    <dd className="mt-1 text-slate-700">{formatDateTime(calendar.lastSyncedAt)}</dd>
                  </div>
                  <div className="rounded-xl bg-white px-3.5 py-3 ring-1 ring-inset ring-slate-200">
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Linked events</dt>
                    <dd className="mt-1 text-slate-700">
                      {calendar.synced} synced · {calendar.pending} pending · {calendar.failed} failed
                    </dd>
                  </div>
                </dl>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={testCalendar}
                    disabled={calendarTesting || calendarSyncing}
                    className={secondaryButton}
                  >
                    {calendarTesting ? (
                      <LoaderCircle size={16} className="animate-spin" aria-hidden />
                    ) : (
                      <RefreshCw size={16} aria-hidden />
                    )}
                    {calendarTesting ? 'Testing…' : 'Test connection'}
                  </button>
                  <button
                    type="button"
                    onClick={syncCalendarNow}
                    disabled={calendarTesting || calendarSyncing}
                    className={primaryButton}
                  >
                    {calendarSyncing ? (
                      <LoaderCircle size={16} className="animate-spin" aria-hidden />
                    ) : (
                      <RefreshCw size={16} aria-hidden />
                    )}
                    {calendarSyncing ? 'Syncing…' : 'Sync upcoming'}
                  </button>
                </div>

                <p className="text-[12px] leading-5 text-slate-500">
                  Events are all-day, marked private, and contain only the patient name and service. Keep the
                  clinic calendar private and shared only with authorized staff. Clinical notes and contact details
                  are never sent. Cancelling an appointment removes its event. Manual sync still works when automatic
                  sync is off.
                </p>
              </div>
            </ConfigureSection>
          )}
        </motion.section>

        <GoogleSheetsCard
          withPin={withPin}
          onToast={setToast}
          enabled={settings?.googleSheetsEnabled}
          toggling={saving}
          onToggle={setSheetsEnabled}
        />

        <GoogleDriveCard
          withPin={withPin}
          onToast={setToast}
          enabled={settings?.googleDriveEnabled}
          toggling={saving}
          onToggle={setDriveEnabled}
        />

        <SectionLabel>Tools</SectionLabel>

        <motion.section
          id="reports-export"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
          transition={{ type: 'spring', bounce: 0, duration: 0.35, delay: 0.14 }}
          className={panel}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-xl">
              <CardHeading
                title="Reports export"
                description="Download the visits-per-service report as a CSV file. The same report staff see under Reports — date range, each service, completed visits, and the total."
              />
            </div>
            <StatusPill tone="teal">CSV</StatusPill>
          </div>

          {reportError && <InlineNotice className="mt-4">{reportError}</InlineNotice>}
          {reportMessage && <SuccessNote className="mt-4">{reportMessage}</SuccessNote>}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-3.5 py-3 ring-1 ring-inset ring-slate-200">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[13px] font-medium text-slate-700">Report window</span>
              <Segmented
                ariaLabel="Report window"
                value={reportRange}
                onChange={setReportRange}
                options={[
                  { key: '30', label: '30 days' },
                  { key: '90', label: '90 days' },
                ]}
              />
            </div>
            <button
              type="button"
              onClick={exportReportCsv}
              disabled={reportExporting}
              className={primaryButton}
            >
              {reportExporting ? (
                <LoaderCircle size={16} className="animate-spin" aria-hidden />
              ) : (
                <Download size={16} aria-hidden />
              )}
              {reportExporting ? 'Generating…' : 'Generate CSV'}
            </button>
          </div>

          <p className="mt-3 text-[12px] leading-5 text-slate-500">
            Only completed appointments are counted. The CSV opens in Excel or Google Sheets and includes a UTF-8
            BOM so service names render correctly.
          </p>
        </motion.section>
      </DashboardShell>

      <AnimatePresence>
        {toast && <Toast key={`${toast.tone}-${toast.message}`} toast={toast} onDone={dismissToast} />}
      </AnimatePresence>

      {resetOpen && (
        <ResetDialog
          title="Reset to default credentials?"
          description={
            <>
              The custom Google Client ID and Client Secret will be deleted. Google sign-in will immediately
              fall back to the credentials in the server&apos;s{' '}
              <code className="font-mono text-[12px]">.env</code> file.
            </>
          }
          busy={googleResetting}
          onCancel={() => setResetOpen(false)}
          onConfirm={resetGoogleCredentials}
        />
      )}

      {recaptchaResetOpen && (
        <ResetDialog
          title="Reset reCAPTCHA keys?"
          description={
            <>
              The custom site key and secret key will be deleted. Login, registration, and password reset will
              immediately use the keys in the server&apos;s <code className="font-mono text-[12px]">.env</code> file,
              so make sure those are valid for this site&apos;s domain.
            </>
          }
          busy={recaptchaResetting}
          onCancel={() => setRecaptchaResetOpen(false)}
          onConfirm={resetRecaptchaKeys}
        />
      )}

      {emailResetOpen && (
        <ResetDialog
          title="Reset email delivery?"
          description={
            <>
              The custom SMTP host, username, and password will be deleted. Email delivery will immediately
              fall back to the SMTP settings in the server&apos;s{' '}
              <code className="font-mono text-[12px]">.env</code> file.
            </>
          }
          busy={emailResetting}
          onCancel={() => setEmailResetOpen(false)}
          onConfirm={resetEmailSettings}
        />
      )}

      {pinRequest && <PinDialog key={pinRequest.title} request={pinRequest} onClose={closePin} />}
    </>
  );
}

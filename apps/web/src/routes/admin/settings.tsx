import { createFileRoute } from '@tanstack/react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  CalendarDays,
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
  StatusPill,
  SuccessNote,
  fieldLabel,
  inputClass,
  panel,
  primaryButton,
  secondaryButton,
} from '../../components/app-ui';
import { getSession } from '../../lib/auth';
import {
  ApiError,
  getAuthSettings,
  getEmailIntegrationSettings,
  getGoogleCalendarSettings,
  getGoogleIntegrationSettings,
  resetEmailIntegrationSettings,
  resetGoogleIntegrationSettings,
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

function AdminSettings() {
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

  const [calendar, setCalendar] = useState<GoogleCalendarSettings | null>(null);
  const [calendarLoadError, setCalendarLoadError] = useState<string | null>(null);
  const [calendarSaving, setCalendarSaving] = useState(false);
  const [calendarTesting, setCalendarTesting] = useState(false);
  const [calendarSyncing, setCalendarSyncing] = useState(false);
  const [calendarActionError, setCalendarActionError] = useState<string | null>(null);
  const [calendarMessage, setCalendarMessage] = useState<string | null>(null);

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

  async function setGoogleSignIn(next: boolean) {
    if (!settings || saving) return;
    const previous = settings;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    // Optimistic: the switch flips immediately and rolls back if the API rejects it.
    setSettings({ ...settings, googleSignInEnabled: next });
    try {
      const r = await updateAuthSettings({ googleSignInEnabled: next });
      setSettings(r.settings);
      setSaved(true);
    } catch {
      setSettings(previous);
      setSaveError('Could not save the setting. Try again.');
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
    setSettings({ ...settings, recaptchaEnabled: next });
    try {
      const r = await updateAuthSettings({ recaptchaEnabled: next });
      setSettings(r.settings);
      setSaved(true);
    } catch {
      setSettings(previous);
      setSaveError('Could not save the setting. Try again.');
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
      const r = await updateGoogleIntegrationSettings({
        ...(clientId ? { clientId } : {}),
        ...(clientSecret ? { clientSecret } : {}),
      });
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
      const r = await resetGoogleIntegrationSettings();
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
      const r = await updateEmailIntegrationSettings({
        ...(host ? { host } : {}),
        ...(portText ? { port: Number(portText) } : {}),
        ...(user ? { user } : {}),
        ...(password ? { password } : {}),
        ...(fromAddress ? { fromAddress } : {}),
      });
      applyEmailSettings(r);
      setEmailLoadError(null);
      setToast({ tone: 'success', message: 'Email delivery settings saved.' });
    } catch (err) {
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
      const r = await resetEmailIntegrationSettings();
      applyEmailSettings(r);
      setEmailLoadError(null);
      setEmailResetOpen(false);
      setToast({ tone: 'success', message: 'Email settings reset to the server defaults.' });
    } catch (err) {
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
    // Optimistic: the switch flips immediately and rolls back if the API rejects it.
    setCalendar({ ...calendar, enabled: next });
    try {
      const r = await updateGoogleCalendarSettings({ enabled: next });
      setCalendar(r);
      setCalendarMessage(`Automatic calendar sync ${next ? 'enabled' : 'disabled'}.`);
    } catch (err) {
      setCalendar(previous);
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

  const googleOn = settings?.googleSignInEnabled ?? false;
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
            title="Sign-in & integrations"
            description="Control how patients sign in and which services the clinic calendar mirrors to. Email and password always stay available for local accounts."
            action={
              settings === null ? (
                <StatusPill tone={loadError ? 'red' : 'slate'}>{loadError ? 'Unavailable' : 'Loading…'}</StatusPill>
              ) : (
                <StatusPill tone={googleOn ? 'teal' : 'slate'}>
                  Google {googleOn ? 'on' : 'off'}
                </StatusPill>
              )
            }
          />
        </motion.div>

        <motion.section
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
          transition={{ type: 'spring', bounce: 0, duration: 0.35, delay: 0.04 }}
          className={panel}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-xl">
              <CardHeading
                title="Sign-in methods"
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
                way.
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
        </motion.section>

        <motion.section
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

          <p className="mt-4 rounded-xl bg-slate-50 px-3.5 py-2.5 text-[12.5px] leading-5 text-slate-600 ring-1 ring-inset ring-slate-200">
            The challenge appears on the public login and registration pages when the web app&apos;s reCAPTCHA site
            key is configured. When enabled, the server verifies submissions using its secret key.
          </p>
          {loadError && <InlineNotice className="mt-4">{loadError}</InlineNotice>}
          {saveError && <InlineNotice className="mt-4">{saveError}</InlineNotice>}
          {saved && <p className="mt-2.5 text-[12px] font-medium text-slate-500">Saved.</p>}
        </motion.section>

        <motion.section
          id="google-integration"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
          transition={{ type: 'spring', bounce: 0, duration: 0.35, delay: 0.08 }}
          className={panel}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-xl">
              <CardHeading
                title="Google Integration"
                description="Override the server's default Google OAuth credentials. Only admins can change these; patients and staff keep using the normal “Continue with Google” button."
              />
            </div>

            {google === null ? (
              <StatusPill tone={googleLoadError ? 'red' : 'slate'}>
                {googleLoadError ? 'Unavailable' : 'Loading…'}
              </StatusPill>
            ) : (
              <StatusPill tone={google.source === 'custom' ? 'teal' : 'slate'}>
                {google.source === 'custom' ? 'Custom' : 'Default'}
              </StatusPill>
            )}
          </div>

          {googleLoadError && <InlineNotice className="mt-4">{googleLoadError}</InlineNotice>}

          {google && (
            <form onSubmit={saveGoogleCredentials} className="mt-5 space-y-4">
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
                    placeholder={google.clientIdMasked || 'No Client ID configured'}
                    className={cn(inputClass, 'font-mono text-[12.5px]')}
                  />
                  <p className="mt-1.5 break-all font-mono text-[11.5px] leading-5 text-slate-500">
                    Current: <span className="text-slate-700">{google.clientIdMasked || 'Not set'}</span>
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
                    placeholder={google.clientSecretMasked || 'No Client Secret configured'}
                    className={cn(inputClass, 'font-mono text-[12.5px]')}
                  />
                  <p className="mt-1.5 break-all font-mono text-[11.5px] leading-5 text-slate-500">
                    Current: <span className="text-slate-700">{google.clientSecretMasked || 'Not set'}</span>
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
          )}
        </motion.section>

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
                description="The SMTP account used for password reset codes and announcements. Changes apply immediately — no server restart needed."
              />
            </div>

            {email === null ? (
              <StatusPill tone={emailLoadError ? 'red' : 'slate'}>
                {emailLoadError ? 'Unavailable' : 'Loading…'}
              </StatusPill>
            ) : !email.configured ? (
              <StatusPill tone="amber">Not configured</StatusPill>
            ) : (
              <StatusPill tone={email.source === 'custom' ? 'teal' : 'slate'}>
                {email.source === 'custom' ? 'Custom' : 'Default'}
              </StatusPill>
            )}
          </div>

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

          {email && (
            <form onSubmit={saveEmailSettings} className="mt-5 space-y-4">
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
                    placeholder={email.userMasked || 'No username configured'}
                    className={cn(inputClass, 'font-mono text-[12.5px]')}
                  />
                  <p className="mt-1.5 break-all font-mono text-[11.5px] leading-5 text-slate-500">
                    Current: <span className="text-slate-700">{email.userMasked || 'Not set'}</span>
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
                  placeholder={email.fromAddress || 'E-Kalinga <clinic@your-domain.com>'}
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
                appears above.
              </p>

              {email.lastTestOk === false && email.lastTestError && (
                <InlineNotice>Last test failed: {email.lastTestError}</InlineNotice>
              )}
              {email.lastTestOk === true && (
                <SuccessNote>
                  Last test succeeded {formatDateTime(email.lastTestedAt)}.
                </SuccessNote>
              )}
            </form>
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

            {calendar === null ? (
              <StatusPill tone={calendarLoadError ? 'red' : 'slate'}>
                {calendarLoadError ? 'Unavailable' : 'Loading…'}
              </StatusPill>
            ) : !calendar.configured ? (
              <StatusPill tone="amber">Not configured</StatusPill>
            ) : (
              <StatusPill tone={calendar.enabled ? 'teal' : 'slate'}>
                {calendar.enabled ? 'On' : 'Off'}
              </StatusPill>
            )}
          </div>

          {calendarLoadError && <InlineNotice className="mt-4">{calendarLoadError}</InlineNotice>}
          {calendarActionError && <InlineNotice className="mt-4">{calendarActionError}</InlineNotice>}
          {calendarMessage && <SuccessNote className="mt-4">{calendarMessage}</SuccessNote>}

          {calendar && !calendar.configured && (
            <div className="mt-5 rounded-xl bg-slate-50 px-4 py-3.5 text-[12.5px] leading-6 text-slate-600 ring-1 ring-inset ring-slate-200">
              <div className="flex items-center gap-2 font-semibold text-slate-800">
                <CalendarDays size={16} className="text-slate-500" aria-hidden />
                Clinic calendar is not connected
              </div>
              <p className="mt-2">
                Add <code className="font-mono text-[11.5px]">GOOGLE_CALENDAR_ID</code>,{' '}
                <code className="font-mono text-[11.5px]">GOOGLE_SERVICE_ACCOUNT_EMAIL</code>, and{' '}
                <code className="font-mono text-[11.5px]">GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY</code> to{' '}
                <code className="font-mono text-[11.5px]">apps/server/.env</code>, then restart the API. Use the
                clinic calendar's ID from its settings (not “primary”), share it with the service account, and give
                it “Make changes to events”.
              </p>
              <p className="mt-2">
                No patient or staff screen changes. Until it is configured, appointments behave exactly as they do
                now.
              </p>
            </div>
          )}

          {calendar && calendar.configured && (
            <div className="mt-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-3.5 py-3 ring-1 ring-inset ring-slate-200">
                <div className="flex items-center gap-2.5">
                  <StatusPill tone={calendar.enabled ? 'teal' : 'slate'}>
                    {calendar.enabled ? 'On' : 'Off'}
                  </StatusPill>
                  <span className="text-[13px] font-medium text-slate-700">
                    Sync confirmed appointments automatically
                  </span>
                </div>
                <div className="flex items-center gap-2.5">
                  {calendarSaving && <LoaderCircle size={16} className="animate-spin text-slate-400" aria-hidden />}
                  <Toggle
                    checked={calendar.enabled}
                    disabled={calendarSaving || calendarTesting || calendarSyncing}
                    label="Sync confirmed appointments to Google Calendar"
                    onChange={setCalendarSync}
                  />
                </div>
              </div>

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

              {calendar.lastError && (
                <InlineNotice>Last sync error: {calendar.lastError}</InlineNotice>
              )}

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
                Events are all-day, marked private, and contain only the patient name and service. Keep the clinic
                calendar private and shared only with authorized staff. Clinical notes and contact details are never
                sent. Cancelling an appointment removes its event. Manual sync still works when automatic sync is
                off.
              </p>
            </div>
          )}
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
    </>
  );
}

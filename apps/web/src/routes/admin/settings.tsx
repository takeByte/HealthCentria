import { createFileRoute } from '@tanstack/react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { KeyRound, LoaderCircle, RotateCcw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { DashboardShell } from '../../components/dashboard-shell';
import { adminNav } from '../../components/ops-nav';
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
  getGoogleIntegrationSettings,
  resetGoogleIntegrationSettings,
  updateAuthSettings,
  updateGoogleIntegrationSettings,
  type AuthSettings,
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

function ResetGoogleDialog({
  busy,
  onCancel,
  onConfirm,
}: {
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
        aria-labelledby="reset-google-title"
        className="w-full max-w-md rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_24px_70px_-28px_rgba(15,60,90,0.45)] sm:p-6"
      >
        <h2 id="reset-google-title" className="font-display text-lg font-semibold tracking-[-0.02em] text-slate-900">
          Reset to default credentials?
        </h2>
        <p className="mt-2 text-[13.5px] leading-6 text-slate-600">
          The custom Google Client ID and Client Secret will be deleted. Google sign-in will immediately
          fall back to the credentials in the server&apos;s <code className="font-mono text-[12px]">.env</code>{' '}
          file.
        </p>
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

  const googleOn = settings?.googleSignInEnabled ?? false;
  const hasNewGoogleValue = Boolean(googleClientId.trim() || googleClientSecret.trim());

  return (
    <>
      <DashboardShell
        title="Settings"
        subtitle="How patients sign in to HealthCentria"
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
            eyebrow="Access & security"
            title="How patients sign in"
            description="Control the sign-in methods available at the door. Email and password always stay available for local accounts."
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
      </DashboardShell>

      <AnimatePresence>
        {toast && <Toast key={`${toast.tone}-${toast.message}`} toast={toast} onDone={dismissToast} />}
      </AnimatePresence>

      {resetOpen && (
        <ResetGoogleDialog
          busy={googleResetting}
          onCancel={() => setResetOpen(false)}
          onConfirm={resetGoogleCredentials}
        />
      )}
    </>
  );
}

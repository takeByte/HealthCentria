import { createFileRoute } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Info, LoaderCircle, Mail } from 'lucide-react';
import { DashboardShell } from '../../components/dashboard-shell';
import { patientNav } from '../../components/patient-nav';
import { CardHeading, EmptyNote, InlineNotice, cardPadding } from '../../components/app-ui';
import { Toast, type ToastMessage } from '../../components/toast';
import { getSession } from '../../lib/auth';
import { getEmailPreferences, updateEmailPreferences, type EmailPreferences } from '../../lib/api';
import { getTodayService } from '../../lib/schedule';
import { cn } from '../../lib/utils';

export const Route = createFileRoute('/app/settings')({
  component: PatientSettings,
});

const OPTIONS: Array<{ key: keyof EmailPreferences; title: string; description: string }> = [
  {
    key: 'announcements',
    title: 'Announcements',
    description: 'Emails when the center posts an announcement, such as schedule changes or vaccination days.',
  },
  {
    key: 'appointments',
    title: 'Appointment updates',
    description:
      'Emails when your appointment is confirmed or declined, and the reminder the day before a confirmed visit.',
  },
];

function Switch({
  checked,
  busy,
  onChange,
  labelledBy,
}: {
  checked: boolean;
  busy: boolean;
  onChange: (next: boolean) => void;
  labelledBy: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      disabled={busy}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]/40 disabled:opacity-60',
        checked ? 'bg-[#0f766e]' : 'bg-slate-300',
      )}
    >
      <span
        className={cn(
          'flex size-5 items-center justify-center rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      >
        {busy && <LoaderCircle size={12} className="animate-spin text-slate-500" aria-hidden />}
      </span>
    </button>
  );
}

function PatientSettings() {
  const reduceMotion = useReducedMotion();
  const session = getSession();
  const today = getTodayService();
  const [prefs, setPrefs] = useState<EmailPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<keyof EmailPreferences | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  useEffect(() => {
    let cancelled = false;
    getEmailPreferences()
      .then((r) => {
        if (!cancelled) setPrefs(r.preferences);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load your settings.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(key: keyof EmailPreferences, next: boolean) {
    if (!prefs || busyKey) return;
    setBusyKey(key);
    try {
      const r = await updateEmailPreferences({ [key]: next });
      setPrefs(r.preferences);
      const label = OPTIONS.find((o) => o.key === key)?.title ?? 'Emails';
      setToast({ tone: 'success', message: `${label} emails turned ${next ? 'on' : 'off'}.` });
    } catch (err) {
      setToast({ tone: 'error', message: err instanceof Error ? err.message : 'Could not save. Try again.' });
    } finally {
      setBusyKey(null);
    }
  }

  const rise = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

  return (
    <DashboardShell
      title="Settings"
      subtitle="Choose which emails you receive"
      roleLabel="Patient"
      userName={session?.name}
      userEmail={session?.email ?? ''}
      todayService={`${today.name} — ${today.detail}`}
      nav={patientNav}
      notificationsTo="/app/notifications"
    >
      {error && <InlineNotice>{error}</InlineNotice>}
      {prefs === null && !error && <EmptyNote>Loading settings…</EmptyNote>}

      {prefs !== null && (
        <motion.section
          {...rise}
          transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
          className={`app-card ${cardPadding}`}
          aria-label="Email preferences"
        >
          <CardHeading
            title="Email notifications"
            description={`Sent to ${session?.email ?? 'your email address'}. Turning one off only stops the email. You will still see it in the app.`}
          />
          <ul className="mt-4 divide-y divide-slate-200/70 border-t border-slate-200/70">
            {OPTIONS.map((o) => (
              <li key={o.key} className="flex items-start justify-between gap-4 py-4">
                <div className="min-w-0">
                  <p id={`pref-${o.key}`} className="flex items-center gap-1.5 text-[14px] font-semibold text-slate-900">
                    <Mail size={14} aria-hidden className="text-slate-500" /> {o.title}
                  </p>
                  <p className="mt-1 text-[12.5px] leading-5 text-slate-600">{o.description}</p>
                </div>
                <Switch
                  checked={prefs[o.key]}
                  busy={busyKey === o.key}
                  onChange={(next) => void toggle(o.key, next)}
                  labelledBy={`pref-${o.key}`}
                />
              </li>
            ))}
          </ul>
          <p className="mt-1 flex items-start gap-2 rounded-xl bg-[#0f766e]/8 px-3.5 py-3 text-[12.5px] leading-5 text-[#134e4a] ring-1 ring-inset ring-[#0f766e]/12">
            <Info size={15} aria-hidden className="mt-0.5 shrink-0 text-[#0f766e]" />
            <span>
              Security emails, such as email verification codes and password reset codes, are always sent and can't be
              turned off.
            </span>
          </p>
        </motion.section>
      )}

      {toast && <Toast toast={toast} onDone={() => setToast(null)} />}
    </DashboardShell>
  );
}

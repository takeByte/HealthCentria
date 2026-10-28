import { createFileRoute, Link } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, LoaderCircle, Plus } from 'lucide-react';
import { DashboardShell } from '../../../components/dashboard-shell';
import { patientNav } from '../../../components/patient-nav';
import { CardHeading, EmptyNote, InlineNotice, StatusChip, cardPadding, chipButton, primaryButton } from '../../../components/app-ui';
import { getSession } from '../../../lib/auth';
import { ApiError, cancelAppointment, myAppointments, type Appointment } from '../../../lib/api';
import { getTodayService } from '../../../lib/schedule';
import { cn } from '../../../lib/utils';

export const Route = createFileRoute('/app/appointments/')({
  component: MyAppointments,
});

type Tab = 'upcoming' | 'past' | 'all';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
  { key: 'all', label: 'All' },
];

function serviceName(a: Appointment): string {
  return typeof a.service === 'object' ? a.service.name : 'Service';
}

function formatDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' });
}

function todayYMD(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

function AppointmentCard({ appt, onCancelled }: { appt: Appointment; onCancelled: (a: Appointment) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancellable = appt.status === 'pending' || appt.status === 'confirmed';

  async function doCancel() {
    setPending(true);
    setError(null);
    try {
      const r = await cancelAppointment(appt.id);
      onCancelled(r.appointment);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel. Try again.');
      setConfirming(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <article className={`app-card ${cardPadding}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-[15.5px] font-semibold leading-snug tracking-[-0.01em] text-slate-900">
            {serviceName(appt)}
          </h3>
          <p className="mt-1 text-[13px] text-slate-600">{formatDay(appt.day)}</p>
        </div>
        <StatusChip status={appt.status} />
      </div>

      {appt.status === 'declined' && appt.declineReason && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[12.5px] leading-5 text-red-800">
          <span className="font-semibold">Reason: </span>
          {appt.declineReason}
        </p>
      )}
      {appt.notes && (
        <p className="mt-3 rounded-lg bg-slate-50/80 px-3 py-2 text-[12.5px] leading-5 text-slate-600">
          <span className="font-semibold text-slate-700">Notes: </span>
          {appt.notes}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2.5 text-[12.5px] font-medium text-destructive">
          {error}
        </p>
      )}

      {cancellable && !confirming && (
        <button type="button" onClick={() => setConfirming(true)} className={`${chipButton} mt-3.5`}>
          Cancel appointment
        </button>
      )}

      {cancellable && confirming && (
        <div className="mt-3.5 rounded-xl bg-slate-50 p-2.5">
          <p className="px-1 pb-2 text-[12.5px] font-medium text-slate-700">
            Cancel this visit? The slot is released to other patients.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={doCancel}
              disabled={pending}
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-destructive/10 text-[13px] font-semibold text-destructive transition-transform active:scale-[0.97] disabled:opacity-60"
            >
              {pending && <LoaderCircle size={14} className="animate-spin" aria-hidden />}
              Yes, cancel it
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className="h-9 flex-1 rounded-lg border border-slate-200 bg-white text-[13px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 active:scale-[0.97] disabled:opacity-60"
            >
              Keep it
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function MyAppointments() {
  const reduceMotion = useReducedMotion();
  const session = getSession();
  const today = getTodayService();
  const [tab, setTab] = useState<Tab>('upcoming');
  const [list, setList] = useState<Appointment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    myAppointments()
      .then((r) => {
        if (!cancelled) setList(r.appointments);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load appointments.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(() => {
    if (!list) return null;
    const t = todayYMD();
    if (tab === 'upcoming') return list.filter((a) => a.day >= t && (a.status === 'pending' || a.status === 'confirmed'));
    if (tab === 'past') return list.filter((a) => a.day < t || !['pending', 'confirmed'].includes(a.status));
    return list;
  }, [list, tab]);

  return (
    <DashboardShell
      title="My Appointments"
      subtitle="Requests the center has confirmed, and what came before"
      roleLabel="Patient"
      userName={session?.name}
      userEmail={session?.email ?? ''}
      todayService={`${today.name} — ${today.detail}`}
      nav={patientNav}
      notificationsTo="/app/notifications"
    >
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
        className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div role="tablist" aria-label="Filter appointments" className="flex rounded-xl bg-slate-100/80 p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'h-9 flex-1 rounded-lg px-4 text-[13px] font-semibold transition-all duration-150 active:scale-[0.97] sm:flex-none',
                tab === t.key
                  ? 'bg-white text-slate-900 shadow-[0_1px_3px_rgba(15,60,90,0.12)]'
                  : 'text-slate-500 hover:text-slate-800',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <Link to="/app/appointments/new" search={{ service: undefined }} className={`${primaryButton} h-10 px-4 text-[13px]`}>
          <Plus size={16} aria-hidden /> Book new
        </Link>
      </motion.div>

      {error && <InlineNotice>{error}</InlineNotice>}
      {visible === null && !error && <EmptyNote>Loading appointments…</EmptyNote>}
      {visible !== null && visible.length === 0 && (
        <section className={`app-card ${cardPadding}`}>
          <CardHeading
            title={tab === 'upcoming' ? 'No upcoming visits' : 'Nothing here yet'}
            description={
              tab === 'upcoming'
                ? 'When you book, your request appears here until staff confirm it.'
                : 'Cancelled, declined and completed visits stay in this list.'
            }
          />
          {tab === 'upcoming' && (
            <Link
              to="/app/appointments/new"
              search={{ service: undefined }}
              className={`${primaryButton} mt-4 h-10 px-4 text-[13px]`}
            >
              <CalendarCheck size={16} aria-hidden /> Book a visit
            </Link>
          )}
        </section>
      )}

      {visible !== null && visible.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {visible.map((a) => (
            <AppointmentCard
              key={a.id}
              appt={a}
              onCancelled={(updated) => setList((l) => (l ?? []).map((x) => (x.id === updated.id ? updated : x)))}
            />
          ))}
        </div>
      )}
    </DashboardShell>
  );
}

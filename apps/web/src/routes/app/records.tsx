import { createFileRoute, Link } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, FileText, Info, Pill } from 'lucide-react';
import { DashboardShell } from '../../components/dashboard-shell';
import { patientNav } from '../../components/patient-nav';
import { CardHeading, EmptyNote, InlineNotice, cardPadding } from '../../components/app-ui';
import { getSession } from '../../lib/auth';
import { myAppointments, type Appointment } from '../../lib/api';
import { getTodayService } from '../../lib/schedule';

export const Route = createFileRoute('/app/records')({
  component: MyRecords,
});

/** Text-link action — the quietest way to offer a next step inside a card. */
const textLink =
  'inline-flex items-center gap-1 text-[13px] font-semibold text-teal-700 hover:underline hover:underline-offset-4';

function serviceName(a: Appointment): string {
  return typeof a.service === 'object' ? a.service.name : 'Service';
}

function formatDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function MyRecords() {
  const reduceMotion = useReducedMotion();
  const session = getSession();
  const today = getTodayService();
  const [list, setList] = useState<Appointment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    myAppointments()
      .then((r) => {
        if (!cancelled) setList(r.appointments);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load records.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visits = useMemo(() => {
    if (!list) return null;
    return list
      .filter((a) => a.status === 'completed')
      .sort((a, b) => (a.day < b.day ? 1 : -1));
  }, [list]);

  const rise = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

  return (
    <DashboardShell
      title="My Records"
      subtitle="Visit notes written by center staff"
      roleLabel="Patient"
      userName={session?.name}
      userEmail={session?.email ?? ''}
      todayService={`${today.name} — ${today.detail}`}
      nav={patientNav}
      notificationsTo="/app/notifications"
    >
      <motion.p
        {...rise}
        transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
        className="flex items-start gap-2.5 rounded-xl bg-teal-600/8 px-4 py-3 text-[12.5px] leading-5 text-teal-900 ring-1 ring-inset ring-teal-600/12"
      >
        <Info size={15} aria-hidden className="mt-0.5 shrink-0 text-teal-700" />
        <span>
          Read-only — these are written by center staff. For corrections, ask the front desk.
        </span>
      </motion.p>

      {error && <InlineNotice>{error}</InlineNotice>}
      {visits === null && !error && <EmptyNote>Loading records…</EmptyNote>}

      {visits !== null && visits.length === 0 && (
        <motion.section {...rise} transition={{ type: 'spring', bounce: 0, duration: 0.35 }} className={`app-card ${cardPadding}`}>
          <CardHeading
            title="No visit records yet"
            description="After a completed visit, the diagnosis and prescription staff recorded appear here — and stay here for every future visit."
          />
          <Link to="/app/appointments/new" search={{ service: undefined }} className={`${textLink} mt-4`}>
            Book your first visit
          </Link>
        </motion.section>
      )}

      {visits !== null && visits.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {visits.map((v, i) => (
            <motion.article
              key={v.id}
              {...rise}
              transition={{ type: 'spring', bounce: 0, duration: 0.35, delay: Math.min(i * 0.03, 0.12) }}
              className={`app-card ${cardPadding}`}
            >
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                  <ClipboardList size={18} aria-hidden />
                </span>
                <div className="min-w-0">
                  <h3 className="font-display text-[15.5px] font-semibold leading-snug tracking-[-0.01em] text-slate-900">
                    {serviceName(v)}
                  </h3>
                  <p className="mt-0.5 text-[12.5px] text-slate-500">{formatDay(v.day)}</p>
                </div>
              </div>

              <dl className="mt-4 space-y-3 border-t border-slate-200/70 pt-3.5">
                <div>
                  <dt className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.09em] text-slate-500">
                    <FileText size={12} aria-hidden /> Diagnosis
                  </dt>
                  <dd className="mt-1 text-[13px] leading-6 text-slate-800">{v.diagnosis || '—'}</dd>
                </div>
                <div>
                  <dt className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.09em] text-slate-500">
                    <Pill size={12} aria-hidden /> Prescription
                  </dt>
                  <dd className="mt-1 text-[13px] leading-6 text-slate-800">{v.prescription || '—'}</dd>
                </div>
                {v.visitNotes && (
                  <div>
                    <dt className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-slate-500">Visit notes</dt>
                    <dd className="mt-1 text-[13px] leading-6 text-slate-700">{v.visitNotes}</dd>
                  </div>
                )}
              </dl>
            </motion.article>
          ))}
        </div>
      )}
    </DashboardShell>
  );
}

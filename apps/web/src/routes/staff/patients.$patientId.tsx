import { createFileRoute, Link } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import { ArrowLeft, CalendarCheck, ClipboardList, FileText, Pill } from 'lucide-react';
import { DashboardShell } from '../../components/dashboard-shell';
import { opsNav } from '../../components/ops-nav';
import {
  CardHeading,
  EmptyNote,
  InlineNotice,
  StatTile,
  StatusChip,
  StatusPill,
  panel,
  secondaryButton,
} from '../../components/app-ui';
import { getSession } from '../../lib/auth';
import { getPatient, type PatientDetail, type PatientVisit } from '../../lib/api';
import { getTodayService } from '../../lib/schedule';

export const Route = createFileRoute('/staff/patients/$patientId')({
  component: PatientDetailPage,
});

function serviceName(v: PatientVisit): string {
  return typeof v.service === 'object' ? v.service.name : 'Service';
}

function formatDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-PH', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function PatientDetailPage() {
  const reduceMotion = useReducedMotion();
  const session = getSession();
  const today = getTodayService();
  const { patientId } = Route.useParams();
  const [patient, setPatient] = useState<PatientDetail | null>(null);
  const [visits, setVisits] = useState<PatientVisit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setPatient(null);
    setVisits(null);
    getPatient(patientId)
      .then((r) => {
        if (!cancelled) {
          setPatient(r.patient);
          setVisits(r.visits);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load patient.');
      });
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  const completed = (visits ?? []).filter((v) => v.status === 'completed');

  const facts: Array<[string, string]> = patient
    ? [
        ['Contact', patient.contactNumber || '—'],
        ['Address', patient.address || '—'],
        ['Household', patient.householdNumber || '—'],
        ['Birthdate', `${String(patient.birthdate).slice(0, 10)} · ${patient.sex}`],
        ['PhilHealth', patient.philHealthNumber || '—'],
        ['Emergency', [patient.emergencyName, patient.emergencyNumber].filter(Boolean).join(' · ') || '—'],
      ]
    : [];

  const rise = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const riseTransition = { type: 'spring', bounce: 0, duration: 0.35 } as const;

  return (
    <DashboardShell
      title="Patient record"
      subtitle={patient ? patient.email : 'Loading the patient chart'}
      roleLabel={session?.role === 'admin' ? 'Admin' : 'Staff'}
      userName={session?.name}
      userEmail={session?.email ?? ''}
      todayService={`${today.name} — ${today.detail}`}
      nav={opsNav(session?.role)}
      notificationsTo="/staff/notifications"
    >
      <motion.div {...rise} transition={riseTransition}>
        <Link to="/staff/patients" className={`${secondaryButton} h-9 px-3.5 text-[13px]`}>
          <ArrowLeft size={15} aria-hidden /> Back to patients
        </Link>
      </motion.div>

      {error && <InlineNotice>{error}</InlineNotice>}
      {patient === null && !error && <EmptyNote>Loading record…</EmptyNote>}

      {patient && (
        <>
          <motion.div
            {...rise}
            transition={{ ...riseTransition, delay: 0.04 }}
            className="grid gap-3.5 sm:grid-cols-3"
          >
            <StatTile
              icon={ClipboardList}
              label="Visits"
              value={visits?.length ?? '—'}
              hint="All appointments on record"
            />
            <StatTile
              icon={CalendarCheck}
              label="Completed"
              value={completed.length}
              hint="With clinical notes"
              tone="sky"
            />
            <StatTile
              icon={FileText}
              label="Status"
              value={patient.active ? 'Active' : 'Inactive'}
              hint={patient.active ? 'Can book visits' : 'Sign-in blocked'}
              tone={patient.active ? 'teal' : 'slate'}
            />
          </motion.div>

          <div className="grid items-start gap-5 lg:grid-cols-5">
            <motion.section
              {...rise}
              transition={{ ...riseTransition, delay: 0.08 }}
              className={`${panel} lg:sticky lg:top-24 lg:col-span-2`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden
                    className="flex size-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-600 to-blue-600 text-[16px] font-bold text-white shadow-[0_2px_8px_rgba(15,60,90,0.18)]"
                  >
                    {patient.name
                      .split(' ')
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((p) => p[0]?.toUpperCase())
                      .join('')}
                  </span>
                  <div className="min-w-0">
                    <h2 className="truncate font-display text-[18px] font-semibold tracking-[-0.02em] text-slate-900">
                      {patient.name}
                    </h2>
                    <p className="mt-0.5 truncate text-[13px] text-slate-600">{patient.email}</p>
                  </div>
                </div>
                {!patient.active && <StatusPill tone="slate">Inactive</StatusPill>}
              </div>
              <dl className="mt-5 grid gap-x-6 gap-y-3 border-t border-slate-200/70 pt-4 text-[13px] sm:grid-cols-2 lg:grid-cols-1">
                {facts.map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-slate-500">{label}</dt>
                    <dd className="mt-0.5 leading-5 text-slate-800">{value}</dd>
                  </div>
                ))}
              </dl>
            </motion.section>

            <motion.section
              {...rise}
              transition={{ ...riseTransition, delay: 0.12 }}
              className={`${panel} lg:col-span-3`}
            >
              <CardHeading
                title="Visit records"
                description={
                  visits === null
                    ? 'Loading visits…'
                    : `${completed.length} completed of ${visits.length} visit${visits.length === 1 ? '' : 's'}`
                }
              />
              {visits !== null && visits.length === 0 && (
                <EmptyNote className="mt-4">No visits yet for this patient.</EmptyNote>
              )}
              <div className="mt-4 grid gap-3">
                {(visits ?? []).map((v) => (
                  <article key={v.id} className="rounded-xl border border-slate-200/70 bg-white/70 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-display text-[14px] font-semibold tracking-[-0.01em] text-slate-900">
                          {serviceName(v)}
                        </h3>
                        <p className="mt-0.5 text-[12px] text-slate-500">{formatDay(v.day)}</p>
                      </div>
                      <StatusChip status={v.status} />
                    </div>
                    {v.status === 'completed' && (v.diagnosis || v.prescription || v.visitNotes) ? (
                      <dl className="mt-3 space-y-2 border-t border-slate-200/70 pt-3 text-[12.5px] leading-5">
                        {v.diagnosis && (
                          <div>
                            <dt className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.09em] text-slate-500">
                              <FileText size={12} aria-hidden /> Diagnosis
                            </dt>
                            <dd className="mt-0.5 text-slate-800">{v.diagnosis}</dd>
                          </div>
                        )}
                        {v.prescription && (
                          <div>
                            <dt className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.09em] text-slate-500">
                              <Pill size={12} aria-hidden /> Prescription
                            </dt>
                            <dd className="mt-0.5 text-slate-800">{v.prescription}</dd>
                          </div>
                        )}
                        {v.visitNotes && (
                          <div>
                            <dt className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-slate-500">
                              Visit notes
                            </dt>
                            <dd className="mt-0.5 text-slate-700">{v.visitNotes}</dd>
                          </div>
                        )}
                      </dl>
                    ) : (
                      <p className="mt-2 text-[12.5px] text-slate-500">No clinical record for this visit yet.</p>
                    )}
                  </article>
                ))}
              </div>
            </motion.section>
          </div>
        </>
      )}
    </DashboardShell>
  );
}

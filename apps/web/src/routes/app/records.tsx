import { createFileRoute, Link } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, FileText, Info, Pill, Printer, Search, X } from 'lucide-react';
import { DashboardShell } from '../../components/dashboard-shell';
import { patientNav } from '../../components/patient-nav';
import {
  CardHeading,
  EmptyNote,
  InlineNotice,
  cardPadding,
  chipButton,
  fieldLabel,
  inputClass,
  selectClass,
} from '../../components/app-ui';
import { MedicalProfileCard } from '../../components/medical-profile';
import { RecordMeta } from '../../components/record-meta';
import { getSession } from '../../lib/auth';
import { getMyPatientProfile, myAppointments, type Appointment, type PatientDetail } from '../../lib/api';
import { printRecords } from '../../lib/print-records';
import { getTodayService } from '../../lib/schedule';
import { cn } from '../../lib/utils';

export const Route = createFileRoute('/app/records')({
  component: MyRecords,
});

/** Text-link action — the quietest way to offer a next step inside a card. */
const textLink =
  'inline-flex items-center gap-1 text-[13px] font-semibold text-[#1f55a8] hover:underline hover:underline-offset-4';

function serviceName(a: Appointment): string {
  return typeof a.service === 'object' ? a.service.name : 'Service';
}

function formatDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function VisitCard({ visit, featured, delay }: { visit: Appointment; featured?: boolean; delay: number }) {
  const reduceMotion = useReducedMotion();
  const rise = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

  return (
    <motion.article
      {...rise}
      transition={{ type: 'spring', bounce: 0, duration: 0.35, delay }}
      className={cn(
        'app-card',
        cardPadding,
        featured && 'md:col-span-2 ring-1 ring-inset ring-[#0f766e]/25',
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
          <ClipboardList size={18} aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 className="font-display text-[15.5px] font-semibold leading-snug tracking-[-0.01em] text-slate-900">
            {serviceName(visit)}
            {featured && (
              <span className="ml-2 rounded-md bg-[#0f766e]/10 px-1.5 py-0.5 align-middle text-[10.5px] font-bold uppercase tracking-[0.08em] text-[#0f766e]">
                Latest visit
              </span>
            )}
          </h3>
          <p className="mt-0.5 text-[12.5px] text-slate-500">{formatDay(visit.day)}</p>
          <RecordMeta createdAt={visit.createdAt} updatedAt={visit.updatedAt} className="mt-1" />
        </div>
      </div>

      <dl className={cn('mt-4 space-y-3 border-t border-slate-200/70 pt-3.5', featured && 'md:grid md:grid-cols-2 md:gap-x-6 md:space-y-0')}>
        <div>
          <dt className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.09em] text-slate-500">
            <FileText size={12} aria-hidden /> Diagnosis
          </dt>
          <dd className="mt-1 text-[13px] leading-6 text-slate-800">{visit.diagnosis || '—'}</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.09em] text-slate-500">
            <Pill size={12} aria-hidden /> Prescription
          </dt>
          <dd className="mt-1 text-[13px] leading-6 text-slate-800">{visit.prescription || '—'}</dd>
        </div>
        {visit.visitNotes && (
          <div className={cn(featured && 'md:col-span-2')}>
            <dt className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-slate-500">Visit notes</dt>
            <dd className="mt-1 text-[13px] leading-6 text-slate-700">{visit.visitNotes}</dd>
          </div>
        )}
      </dl>
    </motion.article>
  );
}

function MyRecords() {
  const reduceMotion = useReducedMotion();
  const session = getSession();
  const today = getTodayService();
  const [list, setList] = useState<Appointment[] | null>(null);
  const [profile, setProfile] = useState<PatientDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [year, setYear] = useState('');
  const [serviceFilter, setServiceFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    myAppointments()
      .then((r) => {
        if (!cancelled) setList(r.appointments);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load records.');
      });
    // The medical profile is a bonus: if it fails, the visit records still show.
    getMyPatientProfile()
      .then((r) => {
        if (!cancelled) setProfile(r.patient);
      })
      .catch(() => undefined);
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

  const years = useMemo(
    () => (visits ? [...new Set(visits.map((v) => v.day.slice(0, 4)))].sort().reverse() : []),
    [visits],
  );
  const services = useMemo(
    () => (visits ? [...new Set(visits.map(serviceName))].sort((a, b) => a.localeCompare(b)) : []),
    [visits],
  );
  const filtersActive = Boolean(search.trim() || year || serviceFilter);

  const shown = useMemo(() => {
    if (!visits) return null;
    const q = search.trim().toLowerCase();
    return visits.filter((v) => {
      if (year && !v.day.startsWith(year)) return false;
      if (serviceFilter && serviceName(v) !== serviceFilter) return false;
      if (!q) return true;
      return [serviceName(v), v.diagnosis, v.prescription, v.visitNotes].some((t) => t.toLowerCase().includes(q));
    });
  }, [visits, search, year, serviceFilter]);

  function clearFilters() {
    setSearch('');
    setYear('');
    setServiceFilter('');
  }

  function handlePrint() {
    setPrintError(null);
    const filterNote = [
      year && `Year ${year}`,
      serviceFilter && `Service: ${serviceFilter}`,
      search.trim() && `Search: "${search.trim()}"`,
    ]
      .filter(Boolean)
      .join(' · ');
    const ok = printRecords({
      patientName: profile?.name || session?.name || session?.email || 'Patient',
      birthdate: profile?.birthdate,
      sex: profile?.sex,
      medical: profile?.medical ?? null,
      visits: shown ?? [],
      filterNote,
    });
    if (!ok) setPrintError('Your browser blocked the print window. Allow pop-ups for this site, then try again.');
  }

  const rise = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

  return (
    <DashboardShell
      title="My Records"
      subtitle="Your medical profile and visit notes from the center"
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
        className="flex items-start gap-2.5 rounded-xl bg-[#1f55a8]/8 px-4 py-3 text-[12.5px] leading-5 text-[#123c78] ring-1 ring-inset ring-[#1f55a8]/12"
      >
        <Info size={15} aria-hidden className="mt-0.5 shrink-0 text-[#1f55a8]" />
        <span>
          Read-only — these are written by center staff. For corrections, ask the front desk.
        </span>
      </motion.p>

      {profile && (
        <motion.div {...rise} transition={{ type: 'spring', bounce: 0, duration: 0.35, delay: 0.04 }}>
          <MedicalProfileCard
            medical={profile.medical}
            note={
              !profile.medical.recordedAt ? (
                <p className="text-[12.5px] leading-5 text-slate-600">
                  Nothing is on file yet. Ask the front desk at your next visit to record your allergies, conditions,
                  medications and vaccines.
                </p>
              ) : undefined
            }
          />
        </motion.div>
      )}

      {error && <InlineNotice>{error}</InlineNotice>}
      {printError && <InlineNotice>{printError}</InlineNotice>}
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

      {visits !== null && visits.length > 0 && shown !== null && (
        <>
          <motion.section
            {...rise}
            transition={{ type: 'spring', bounce: 0, duration: 0.35, delay: 0.06 }}
            className={`app-card ${cardPadding}`}
            aria-label="Filter visit records"
          >
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[12rem] flex-1">
                <label htmlFor="rec-search" className={fieldLabel}>
                  Search
                </label>
                <div className="relative">
                  <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    id="rec-search"
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Diagnosis, medicine, notes…"
                    className={cn(inputClass, 'pl-9')}
                  />
                </div>
              </div>
              <div className="w-full sm:w-32">
                <label htmlFor="rec-year" className={fieldLabel}>
                  Year
                </label>
                <select id="rec-year" value={year} onChange={(e) => setYear(e.target.value)} className={selectClass}>
                  <option value="">All years</option>
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-full sm:w-52">
                <label htmlFor="rec-service" className={fieldLabel}>
                  Service
                </label>
                <select
                  id="rec-service"
                  value={serviceFilter}
                  onChange={(e) => setServiceFilter(e.target.value)}
                  className={selectClass}
                >
                  <option value="">All services</option>
                  {services.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <button type="button" onClick={handlePrint} className={`${chipButton} h-11`}>
                <Printer size={15} aria-hidden /> Print / Save as PDF
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-slate-500" aria-live="polite">
              <span>
                {filtersActive
                  ? `Showing ${shown.length} of ${visits.length} visit${visits.length === 1 ? '' : 's'}`
                  : `${visits.length} completed visit${visits.length === 1 ? '' : 's'}`}
              </span>
              {filtersActive && (
                <button type="button" onClick={clearFilters} className={`${textLink} text-[12.5px]`}>
                  <X size={12} aria-hidden /> Clear filters
                </button>
              )}
            </div>
          </motion.section>

          {shown.length === 0 ? (
            <EmptyNote>No visits match your filters.</EmptyNote>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {shown.map((v, i) => (
                <VisitCard
                  key={v.id}
                  visit={v}
                  featured={!filtersActive && i === 0}
                  delay={Math.min(i * 0.03, 0.12)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </DashboardShell>
  );
}

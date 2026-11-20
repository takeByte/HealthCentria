import { useLiveRefresh } from '../../lib/realtime';
import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, CalendarDays, CheckCircle2, Clock3, LoaderCircle, Lock, Search } from 'lucide-react';
import { DashboardShell } from '../../components/dashboard-shell';
import { opsNav } from '../../components/ops-nav';
import {
  EmptyNote,
  InlineNotice,
  Segmented,
  StatTile,
  StatusChip,
  dangerChipButton,
  fieldLabel,
  inputClass,
  panel,
  primaryButton,
  secondaryButton,
  selectClass,
  textareaClass,
} from '../../components/app-ui';
import { RecordMeta } from '../../components/record-meta';
import { getSession } from '../../lib/auth';
import {
  ApiError,
  confirmAppointment,
  declineAppointment,
  listServices,
  queueAppointments,
  type Service,
  type StaffAppointment,
} from '../../lib/api';
import { getTodayService } from '../../lib/schedule';
import { sessionCan } from '../../lib/permissions';

export const Route = createFileRoute('/staff/appointments')({
  validateSearch: (search: Record<string, unknown>): { status?: StatusFilter } => ({
    status: STATUS_FILTERS.includes(search.status as StatusFilter)
      ? (search.status as StatusFilter)
      : undefined,
  }),
  beforeLoad: () => {
    const session = getSession();
    if (!sessionCan(session, 'appointments.manage')) throw redirect({ to: '/staff/dashboard' });
  },
  component: StaffQueue,
});

const STATUS_FILTERS = ['all', 'pending', 'confirmed', 'declined', 'completed', 'cancelled'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];
type DatePreset = 'today' | 'week' | 'all';

/**
 * How often the queue re-reads who is editing. Locks are taken and released on
 * the visit screen, which does not emit a live event, so the queue polls while
 * it is open instead of waiting for a reload.
 */
const QUEUE_REFRESH_MS = 5_000;

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function patientName(a: StaffAppointment): string {
  return typeof a.patient === 'object' ? a.patient.name : 'Patient';
}

function patientEmail(a: StaffAppointment): string {
  return typeof a.patient === 'object' ? a.patient.email : '';
}

function patientId(a: StaffAppointment): string | null {
  return typeof a.patient === 'object' && a.patient.id ? a.patient.id : null;
}

function serviceName(a: StaffAppointment): string {
  return typeof a.service === 'object' ? a.service.name : 'Service';
}

type EditingInfo = NonNullable<StaffAppointment['editing']>;

/** "in about 8 min" from the lease timestamp; the queue re-renders every 5 s. */
function lockRemaining(expiresAt?: string): string {
  const ms = expiresAt ? new Date(expiresAt).getTime() - Date.now() : Number.NaN;
  if (!Number.isFinite(ms) || ms <= 0) return 'in a moment';
  const minutes = Math.ceil(ms / 60_000);
  return minutes <= 1 ? 'in under a minute' : `in about ${minutes} min`;
}

/**
 * A visit link whose record is held by another screen. Deliberately focusable:
 * a native `disabled` button cannot be focused, so keyboard and screen-reader
 * users would never hear why it does not open. The visible lock notice is the
 * description; the click is inert because there is nothing safe to do.
 */
function LockedVisitButton({
  label,
  className,
  editing,
  describedBy,
}: {
  label: string;
  className: string;
  editing: EditingInfo;
  describedBy: string;
}) {
  return (
    <button
      type="button"
      aria-disabled="true"
      aria-describedby={describedBy}
      title={editing.mine ? 'Already open in another tab' : `Locked by ${editing.heldBy}`}
      className={`${secondaryButton} cursor-not-allowed text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-deep)]/30 ${className}`}
    >
      <Lock size={14} aria-hidden />
      {label}
    </button>
  );
}

function formatDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' });
}

function QueueCard({
  appt,
  canViewPatient,
  onChange,
}: {
  appt: StaffAppointment;
  canViewPatient: boolean;
  onChange: (a: StaffAppointment) => void;
}) {
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'confirm' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const linkedPatientId = patientId(appt);
  // A visit screen holds the record: nobody else may open it from the queue.
  const editing = appt.editing ?? null;

  async function run(action: 'confirm' | 'decline') {
    if (action === 'decline' && !reason.trim()) {
      setReasonError('A reason is required so the patient understands why.');
      return;
    }
    setBusy(action);
    setError(null);
    try {
      const r =
        action === 'confirm'
          ? await confirmAppointment(appt.id)
          : await declineAppointment(appt.id, reason.trim());
      onChange(r.appointment);
      setDeclining(false);
      setReason('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Action failed. Try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className={panel}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-[14.5px] font-semibold leading-snug tracking-[-0.01em] text-slate-900">
            {linkedPatientId && canViewPatient ? (
              <Link
                to="/staff/patients/$patientId"
                params={{ patientId: linkedPatientId }}
                className="rounded-sm hover:text-[var(--brand-deep)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-deep)]/30"
              >
                {patientName(appt)}
              </Link>
            ) : (
              patientName(appt)
            )}
          </h3>
          <p className="mt-0.5 text-[12.5px] text-slate-600">
            {serviceName(appt)} · {formatDay(appt.day)}
            {appt.timePreference !== 'any' ? ` · ${appt.timePreference === 'morning' ? 'Morning' : 'Afternoon'}` : ''}
          </p>
          {patientEmail(appt) && (
            <p className="mt-0.5 truncate text-[11.5px] text-slate-400">{patientEmail(appt)}</p>
          )}
          <RecordMeta
            createdAt={appt.createdAt}
            updatedAt={appt.updatedAt}
            updatedByName={appt.updatedByName}
            className="mt-1.5"
          />
        </div>
        <StatusChip status={appt.status} className="shrink-0" />
      </div>
      {appt.notes && (
        <p className="mt-3 rounded-lg bg-slate-50/80 px-3 py-2 text-[12.5px] leading-5 text-slate-600">
          <span className="font-semibold text-slate-700">Patient notes: </span>
          {appt.notes}
        </p>
      )}
      {appt.status === 'declined' && appt.declineReason && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-[12.5px] leading-5 text-red-800">
          <span className="font-semibold">Decline reason: </span>
          {appt.declineReason}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-[12.5px] font-medium text-destructive">
          {error}
        </p>
      )}

      {editing && (
        <p
          id={`visit-lock-${appt.id}`}
          role="status"
          className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] leading-5 text-amber-900 ring-1 ring-inset ring-amber-600/20"
        >
          <Lock size={14} aria-hidden className="mt-0.5 shrink-0" />
          <span>
            <span className="font-semibold">
              {editing.mine
                ? 'You are editing this visit in another tab.'
                : `${editing.heldBy} is currently editing this visit.`}
            </span>{' '}
            It unlocks on save, on leaving the screen, or {lockRemaining(editing.expiresAt)}.
          </span>
        </p>
      )}

      {appt.status === 'pending' && !declining && (
        <div className="mt-3.5 flex gap-2">
          <button
            type="button"
            onClick={() => run('confirm')}
            disabled={busy !== null}
            className={`${primaryButton} h-9 flex-1 px-3 text-[13px]`}
          >
            {busy === 'confirm' && <LoaderCircle size={14} className="animate-spin" aria-hidden />}
            Confirm
          </button>
          <button
            type="button"
            onClick={() => setDeclining(true)}
            disabled={busy !== null}
            className={`${dangerChipButton} flex-1`}
          >
            Decline
          </button>
        </div>
      )}

      {appt.status === 'pending' && declining && (
        <div className="mt-3.5 rounded-xl bg-slate-50/80 p-3">
          <label htmlFor={`reason-${appt.id}`} className={fieldLabel}>
            Decline reason * <span className="font-normal text-slate-500">(shown to the patient)</span>
          </label>
          <textarea
            id={`reason-${appt.id}`}
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setReasonError(null);
            }}
            placeholder="e.g. Clinic closed for holiday — please rebook next week"
            className={textareaClass}
          />
          {reasonError && (
            <p role="alert" className="mt-1 text-[12.5px] font-medium text-destructive">
              {reasonError}
            </p>
          )}
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              onClick={() => run('decline')}
              disabled={busy !== null}
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-destructive/10 text-[13px] font-semibold text-destructive transition-transform active:scale-[0.97] disabled:opacity-60"
            >
              {busy === 'decline' && <LoaderCircle size={14} className="animate-spin" aria-hidden />}
              Send decline
            </button>
            <button
              type="button"
              onClick={() => {
                setDeclining(false);
                setReason('');
                setReasonError(null);
              }}
              disabled={busy !== null}
              className={`${secondaryButton} h-9 flex-1 text-[13px]`}
            >
              Back
            </button>
          </div>
        </div>
      )}

      {appt.status === 'confirmed' &&
        (editing ? (
          <LockedVisitButton
            label="Complete visit"
            className="mt-3.5 h-9 px-3.5 text-[13px]"
            editing={editing}
            describedBy={`visit-lock-${appt.id}`}
          />
        ) : (
          <Link
            to="/staff/visits/$appointmentId"
            params={{ appointmentId: appt.id }}
            className={`${secondaryButton} mt-3.5 h-9 px-3.5 text-[13px]`}
          >
            Complete visit
          </Link>
        ))}

      {appt.status === 'completed' && (appt.diagnosis || appt.prescription || appt.visitNotes) && (
        <dl className="mt-3 space-y-2 rounded-xl bg-slate-50/80 p-3 text-[12.5px] leading-5">
          {appt.diagnosis && (
            <div>
              <dt className="font-semibold text-slate-500">Diagnosis</dt>
              <dd className="text-slate-800">{appt.diagnosis}</dd>
            </div>
          )}
          {appt.prescription && (
            <div>
              <dt className="font-semibold text-slate-500">Prescription</dt>
              <dd className="text-slate-800">{appt.prescription}</dd>
            </div>
          )}
          {appt.visitNotes && (
            <div>
              <dt className="font-semibold text-slate-500">Visit notes</dt>
              <dd className="text-slate-800">{appt.visitNotes}</dd>
            </div>
          )}
        </dl>
      )}
      {appt.status === 'completed' &&
        (editing ? (
          <LockedVisitButton
            label="View / edit record"
            className="mt-3 h-9 px-3.5 text-[13px]"
            editing={editing}
            describedBy={`visit-lock-${appt.id}`}
          />
        ) : (
          <Link
            to="/staff/visits/$appointmentId"
            params={{ appointmentId: appt.id }}
            className={`${secondaryButton} mt-3 h-9 px-3.5 text-[13px]`}
          >
            View / edit record
          </Link>
        ))}
    </article>
  );
}

function StaffQueue() {
  const reduceMotion = useReducedMotion();
  const session = getSession();
  const today = getTodayService();
  const canViewPatients = sessionCan(session, 'patients.manage');
  const { status: statusParam } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [list, setList] = useState<StaffAppointment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>(statusParam ?? 'all');
  const [preset, setPreset] = useState<DatePreset>('all');
  const [serviceId, setServiceId] = useState('');
  const [search, setSearch] = useState('');
  const [services, setServices] = useState<Service[]>([]);

  // Keeps the filter in sync when the URL changes (deep link or back button).
  useEffect(() => {
    setStatus(statusParam ?? 'all');
  }, [statusParam]);

  useEffect(() => {
    listServices().then((r) => setServices(r.services)).catch(() => {});
  }, []);

  const [liveTick, setLiveTick] = useState(0);
  useLiveRefresh(['appointments'], () => setLiveTick((t) => t + 1));

  // Lock changes do not emit a live event, so keep the queue's "being edited by"
  // fresh while the page is visible. Paused in a background tab.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') setLiveTick((t) => t + 1);
    }, QUEUE_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    const now = new Date();
    const filters: { status?: string; serviceId?: string; from?: string; to?: string } = {};
    if (status !== 'all') filters.status = status;
    if (serviceId) filters.serviceId = serviceId;
    if (preset === 'today') filters.from = filters.to = toYMD(now);
    if (preset === 'week') {
      filters.from = toYMD(now);
      const end = new Date(now);
      end.setDate(end.getDate() + 7);
      filters.to = toYMD(end);
    }
    queueAppointments(filters)
      .then((r) => {
        if (!cancelled) setList(r.appointments);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setList((l) => l ?? []);
          setError(err instanceof Error ? err.message : 'Could not load the queue.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [status, preset, serviceId, liveTick]);

  const pending = useMemo(() => (list ?? []).filter((a) => a.status === 'pending'), [list]);
  const summary = useMemo(() => {
    const todayKey = toYMD(new Date());
    const all = list ?? [];
    return {
      today: all.filter((a) => a.day === todayKey && (a.status === 'confirmed' || a.status === 'pending')).length,
      pending: all.filter((a) => a.status === 'pending').length,
      confirmed: all.filter((a) => a.status === 'confirmed').length,
      completed: all.filter((a) => a.status === 'completed').length,
    };
  }, [list]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return list ?? [];
    return (list ?? []).filter((a) =>
      [patientName(a), patientEmail(a), serviceName(a)].some((field) => field.toLowerCase().includes(q)),
    );
  }, [list, search]);

  return (
    <DashboardShell
      title="Appointments"
      subtitle="Confirm, decline or complete today's queue"
      roleLabel={session?.role === 'admin' ? 'Admin' : 'Staff'}
      userName={session?.name}
      userEmail={session?.email ?? ''}
      todayService={`${today.name} — ${today.detail}`}
      nav={opsNav(session?.role, session?.permissions)}
      notificationsTo="/staff/notifications"
    >
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
      >
        {pending.length > 0 ? (
          <p
            role="status"
            className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-2.5 text-[12.5px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-600/20"
          >
            <span aria-hidden className="size-2 rounded-full bg-amber-500" />
            {pending.length} request{pending.length === 1 ? '' : 's'} waiting for review
          </p>
        ) : (
          list !== null && (
            <p
              role="status"
              className="flex items-center gap-2 rounded-xl bg-[var(--brand-deep)]/8 px-4 py-2.5 text-[12.5px] font-semibold text-[var(--brand-ink)] ring-1 ring-inset ring-[var(--brand-deep)]/15"
            >
              <span aria-hidden className="size-2 rounded-full bg-[var(--brand-deep)]" />
              Queue clear — nothing pending.
            </p>
          )
        )}
      </motion.div>

      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={{ type: 'spring', bounce: 0, duration: 0.35, delay: 0.04 }}
        className="grid grid-cols-2 gap-3.5 xl:grid-cols-4"
      >
        <StatTile
          icon={CalendarCheck}
          label="Today"
          value={list === null ? '—' : summary.today}
          hint="Confirmed + pending"
        />
        <StatTile
          icon={Clock3}
          label="Pending"
          value={list === null ? '—' : summary.pending}
          hint={summary.pending === 0 ? 'Queue is clear' : 'Needs review'}
          tone="amber"
        />
        <StatTile
          icon={CalendarCheck}
          label="Confirmed"
          value={list === null ? '—' : summary.confirmed}
          hint="Ready for the visit"
          tone="sky"
        />
        <StatTile
          icon={CheckCircle2}
          label="Completed"
          value={list === null ? '—' : summary.completed}
          hint="Records saved"
          tone="slate"
        />
      </motion.div>

      <div className={`${panel} py-4`}>
        <div className="relative">
          <Search
            size={17}
            aria-hidden
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            id="appointment-search"
            type="search"
            placeholder="Search patient by name or email…"
            aria-label="Search appointments by patient name, email, or service"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${inputClass} pl-10`}
          />
        </div>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Segmented
            ariaLabel="Date range"
            value={preset}
            onChange={setPreset}
            className="sm:w-auto"
            options={[
              { key: 'today', label: 'Today' },
              { key: 'week', label: '7 days' },
              { key: 'all', label: 'All' },
            ]}
          />
          <select
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            aria-label="Filter by service"
            className={`${selectClass} sm:w-auto sm:min-w-44`}
          >
            <option value="">All services</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => {
              const next = e.target.value as StatusFilter;
              setStatus(next);
              // Keeps a filtered queue shareable, and matches the dashboard tile link.
              void navigate({ search: next === 'all' ? {} : { status: next }, replace: true });
            }}
            aria-label="Filter by status"
            className={`${selectClass} sm:w-auto sm:min-w-40`}
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? 'All statuses' : s[0].toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <InlineNotice>{error}</InlineNotice>}
      {list === null && !error && <EmptyNote>Loading queue…</EmptyNote>}
      {list !== null && list.length === 0 && !error && (
        <EmptyNote>No appointments match these filters.</EmptyNote>
      )}
      {list !== null && list.length > 0 && filtered.length === 0 && !error && (
        <EmptyNote>No patient matches “{search.trim()}”.</EmptyNote>
      )}

      <AnimatePresence mode="popLayout" initial={false}>
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((a) => (
            <motion.div
              key={a.id}
              layout
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0 }}
              transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
            >
              <QueueCard
                appt={a}
                canViewPatient={canViewPatients}
                onChange={(updated) => setList((l) => (l ?? []).map((x) => (x.id === updated.id ? updated : x)))}
              />
            </motion.div>
          ))}
        </div>
      </AnimatePresence>

      <p className="flex items-center gap-2 text-[12.5px] text-slate-500">
        <CalendarDays size={15} aria-hidden /> Walk-in registration lives under Walk-in; visit records are saved
        when you complete an appointment.
      </p>
    </DashboardShell>
  );
}

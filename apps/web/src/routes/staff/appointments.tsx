import { createFileRoute } from '@tanstack/react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, CalendarDays, CheckCircle2, Clock3, LoaderCircle } from 'lucide-react';
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
  panel,
  primaryButton,
  secondaryButton,
  selectClass,
  textareaClass,
} from '../../components/app-ui';
import { getSession } from '../../lib/auth';
import {
  ApiError,
  completeAppointment,
  confirmAppointment,
  declineAppointment,
  listServices,
  queueAppointments,
  type Service,
  type StaffAppointment,
} from '../../lib/api';
import { getTodayService } from '../../lib/schedule';

export const Route = createFileRoute('/staff/appointments')({
  component: StaffQueue,
});

type StatusFilter = 'all' | 'pending' | 'confirmed' | 'declined' | 'completed' | 'cancelled';
type DatePreset = 'today' | 'week' | 'all';

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function patientName(a: StaffAppointment): string {
  return typeof a.patient === 'object' ? a.patient.name : 'Patient';
}

function patientEmail(a: StaffAppointment): string {
  return typeof a.patient === 'object' ? a.patient.email : '';
}

function serviceName(a: StaffAppointment): string {
  return typeof a.service === 'object' ? a.service.name : 'Service';
}

function formatDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' });
}

function QueueCard({
  appt,
  onChange,
}: {
  appt: StaffAppointment;
  onChange: (a: StaffAppointment) => void;
}) {
  const [declining, setDeclining] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [diagnosis, setDiagnosis] = useState('');
  const [prescription, setPrescription] = useState('');
  const [visitNotes, setVisitNotes] = useState('');
  const [busy, setBusy] = useState<'confirm' | 'decline' | 'complete' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: 'confirm' | 'decline' | 'complete') {
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
          : action === 'decline'
            ? await declineAppointment(appt.id, reason.trim())
            : await completeAppointment(appt.id, {
                diagnosis: diagnosis.trim(),
                prescription: prescription.trim(),
                visitNotes: visitNotes.trim(),
              });
      onChange(r.appointment);
      setDeclining(false);
      setCompleting(false);
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
            {patientName(appt)}
          </h3>
          <p className="mt-0.5 text-[12.5px] text-slate-600">
            {serviceName(appt)} · {formatDay(appt.day)}
            {appt.timePreference !== 'any' ? ` · ${appt.timePreference === 'morning' ? 'Morning' : 'Afternoon'}` : ''}
          </p>
          {patientEmail(appt) && (
            <p className="mt-0.5 truncate text-[11.5px] text-slate-400">{patientEmail(appt)}</p>
          )}
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

      {appt.status === 'confirmed' && !completing && (
        <button
          type="button"
          onClick={() => setCompleting(true)}
          className={`${secondaryButton} mt-3.5 h-9 px-3.5 text-[13px]`}
        >
          Complete visit
        </button>
      )}

      {appt.status === 'confirmed' && completing && (
        <div className="mt-3.5 space-y-3 rounded-xl bg-slate-50/80 p-3">
          <p className="text-[12.5px] font-semibold text-slate-700">
            Visit record <span className="font-normal text-slate-500">(saved on completion, visible to the patient)</span>
          </p>
          <div>
            <label htmlFor={`diag-${appt.id}`} className={fieldLabel}>Diagnosis</label>
            <textarea
              id={`diag-${appt.id}`}
              rows={2}
              maxLength={1000}
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
              placeholder="e.g. Acute viral nasopharyngitis"
              className={textareaClass}
            />
          </div>
          <div>
            <label htmlFor={`rx-${appt.id}`} className={fieldLabel}>Prescription</label>
            <textarea
              id={`rx-${appt.id}`}
              rows={2}
              maxLength={1000}
              value={prescription}
              onChange={(e) => setPrescription(e.target.value)}
              placeholder="e.g. Paracetamol 500mg every 6 hours for 3 days"
              className={textareaClass}
            />
          </div>
          <div>
            <label htmlFor={`vn-${appt.id}`} className={fieldLabel}>Visit notes</label>
            <textarea
              id={`vn-${appt.id}`}
              rows={2}
              maxLength={2000}
              value={visitNotes}
              onChange={(e) => setVisitNotes(e.target.value)}
              placeholder="Advice, follow-up instructions…"
              className={textareaClass}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => run('complete')}
              disabled={busy !== null}
              className={`${primaryButton} h-9 flex-1 px-3 text-[13px]`}
            >
              {busy === 'complete' && <LoaderCircle size={14} className="animate-spin" aria-hidden />}
              Save &amp; complete
            </button>
            <button
              type="button"
              onClick={() => setCompleting(false)}
              disabled={busy !== null}
              className="h-9 flex-1 rounded-lg border border-slate-200 bg-white text-[13px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 active:scale-[0.97] disabled:opacity-60"
            >
              Back
            </button>
          </div>
        </div>
      )}

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
    </article>
  );
}

function StaffQueue() {
  const reduceMotion = useReducedMotion();
  const session = getSession();
  const today = getTodayService();
  const [list, setList] = useState<StaffAppointment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [preset, setPreset] = useState<DatePreset>('all');
  const [serviceId, setServiceId] = useState('');
  const [services, setServices] = useState<Service[]>([]);

  useEffect(() => {
    listServices().then((r) => setServices(r.services)).catch(() => {});
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
          setList([]);
          setError(err instanceof Error ? err.message : 'Could not load the queue.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [status, preset, serviceId]);

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

  return (
    <DashboardShell
      title="Appointments"
      subtitle="Confirm, decline or complete today's queue"
      roleLabel={session?.role === 'admin' ? 'Admin' : 'Staff'}
      userName={session?.name}
      userEmail={session?.email ?? ''}
      todayService={`${today.name} — ${today.detail}`}
      nav={opsNav(session?.role)}
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
              className="flex items-center gap-2 rounded-xl bg-teal-600/8 px-4 py-2.5 text-[12.5px] font-semibold text-teal-900 ring-1 ring-inset ring-teal-600/15"
            >
              <span aria-hidden className="size-2 rounded-full bg-teal-600" />
              Queue clear — nothing pending.
            </p>
          )
        )}
      </motion.div>

      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={{ type: 'spring', bounce: 0, duration: 0.35, delay: 0.04 }}
        className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4"
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
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
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            aria-label="Filter by status"
            className={`${selectClass} sm:w-auto sm:min-w-40`}
          >
            {(['all', 'pending', 'confirmed', 'declined', 'completed', 'cancelled'] as const).map((s) => (
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

      <AnimatePresence mode="popLayout" initial={false}>
        <div className="grid gap-4 md:grid-cols-2">
          {(list ?? []).map((a) => (
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

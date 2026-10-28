import { createFileRoute } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState, type FormEvent } from 'react';
import { CalendarCheck, LoaderCircle, ShieldCheck, Users } from 'lucide-react';
import { DashboardShell } from '../../components/dashboard-shell';
import { opsNav } from '../../components/ops-nav';
import {
  InlineNotice,
  Segmented,
  StatTile,
  SuccessNote,
  fieldLabel,
  inputClass,
  panel,
  primaryButton,
  secondaryButton,
  selectClass,
  textareaClass,
} from '../../components/app-ui';
import { getSession } from '../../lib/auth';
import {
  ApiError,
  listServices,
  lookupPatient,
  walkInAppointment,
  type Service,
  type StaffAppointment,
} from '../../lib/api';
import { getTodayService } from '../../lib/schedule';

export const Route = createFileRoute('/staff/walk-in')({
  component: WalkIn,
});

function todayYMD(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

type Mode = 'existing' | 'new';

function WalkIn() {
  const reduceMotion = useReducedMotion();
  const session = getSession();
  const today = getTodayService();
  const day = todayYMD();
  const [mode, setMode] = useState<Mode>('existing');
  const [services, setServices] = useState<Service[]>([]);
  const [serviceId, setServiceId] = useState('');
  const [email, setEmail] = useState('');
  const [found, setFound] = useState<{ id: string; name: string; email: string } | null>(null);
  const [lookupMsg, setLookupMsg] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [np, setNp] = useState<{
    fullName: string;
    email: string;
    birthdate: string;
    sex: 'Female' | 'Male' | 'Other' | 'Prefer not to say';
    address: string;
    householdNumber: string;
    contactNumber: string;
    philHealthNumber: string;
    emergencyName: string;
    emergencyNumber: string;
  }>({
    fullName: '',
    email: '',
    birthdate: '',
    sex: 'Female',
    address: '',
    householdNumber: '',
    contactNumber: '',
    philHealthNumber: '',
    emergencyName: '',
    emergencyNumber: '',
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ appt: StaffAppointment; tempPassword?: string } | null>(null);

  useEffect(() => {
    listServices().then((r) => setServices(r.services)).catch(() => {});
  }, []);

  async function handleLookup() {
    setLookupMsg(null);
    setFound(null);
    try {
      const r = await lookupPatient(email.trim());
      setFound(r.patient);
    } catch (err) {
      setLookupMsg(err instanceof ApiError ? err.message : 'Lookup failed.');
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);
    if (!serviceId) {
      setError('Select a service.');
      return;
    }
    setPending(true);
    try {
      const r = await walkInAppointment({
        serviceId,
        day,
        notes: notes.trim(),
        ...(mode === 'existing' ? { patientEmail: (found?.email ?? email).trim().toLowerCase() } : { newPatient: { ...np, email: np.email.trim().toLowerCase() } }),
      });
      setDone({ appt: r.appointment, tempPassword: r.tempPassword });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Walk-in booking failed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <DashboardShell
      title="Walk-in"
      subtitle="Register someone who is at the desk right now"
      roleLabel={session?.role === 'admin' ? 'Admin' : 'Staff'}
      userName={session?.name}
      userEmail={session?.email ?? ''}
      todayService={`${today.name} — ${today.detail}`}
      nav={opsNav(session?.role)}
      notificationsTo="/staff/notifications"
      mainClassName="max-w-3xl"
    >
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
        className="grid gap-3.5 sm:grid-cols-3"
      >
        <StatTile
          icon={CalendarCheck}
          label="Today"
          value={day}
          hint="Same-day visits only"
        />
        <StatTile
          icon={ShieldCheck}
          label="Auto-confirmed"
          value="Yes"
          hint="Present at the desk"
          tone="sky"
        />
        <StatTile
          icon={Users}
          label="Services open"
          value={services.filter((s) => s.active).length}
          hint="Available for walk-ins"
          tone="slate"
        />
      </motion.div>

      <motion.section
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={{ type: 'spring', bounce: 0, duration: 0.35, delay: 0.04 }}
        className={panel}
      >
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-teal-600/10 text-teal-700">
            <CalendarCheck size={18} aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-[15px] font-semibold tracking-[-0.01em] text-slate-900">
              Same-day walk-in — auto-confirmed
            </h2>
            <p className="mt-1 text-[13px] leading-5 text-slate-500">
              Today ({day}). The patient is present, so the visit is confirmed immediately instead of waiting
              in the queue.
            </p>
          </div>
        </div>

        <Segmented
          ariaLabel="Patient mode"
          className="mt-5"
          value={mode}
          onChange={setMode}
          options={[
            { key: 'existing', label: 'Existing patient' },
            { key: 'new', label: 'New patient' },
          ]}
        />

        <form onSubmit={handleSubmit} className="mt-5 grid gap-4">
          <div>
            <label htmlFor="wi-service" className={fieldLabel}>
              Service *
            </label>
            <select
              id="wi-service"
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
              className={selectClass}
            >
              <option value="">Select service</option>
              {services.filter((s) => s.active).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {mode === 'existing' ? (
            <div>
              <label htmlFor="wi-email" className={fieldLabel}>
                Patient email *
              </label>
              <div className="flex gap-2">
                <input
                  id="wi-email"
                  type="email"
                  placeholder="patient@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                />
                <button type="button" onClick={handleLookup} className={secondaryButton}>
                  Find
                </button>
              </div>
              {lookupMsg && (
                <p role="alert" className="mt-1.5 text-[12.5px] font-medium text-destructive">
                  {lookupMsg}
                </p>
              )}
              {found && (
                <p role="status" className="mt-1.5 text-[12.5px] font-semibold text-teal-800">
                  Found: {found.name} ({found.email})
                </p>
              )}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {(
                [
                  ['fullName', 'Full name *', 'text'],
                  ['email', 'Email *', 'email'],
                  ['birthdate', 'Birthdate *', 'date'],
                  ['address', 'Address *', 'text'],
                  ['householdNumber', 'Household number *', 'text'],
                  ['contactNumber', 'Contact number *', 'tel'],
                  ['philHealthNumber', 'PhilHealth (optional)', 'text'],
                  ['emergencyName', 'Emergency contact name *', 'text'],
                  ['emergencyNumber', 'Emergency contact number *', 'tel'],
                ] as const
              ).map(([k, label, type]) => (
                <div key={k} className={k === 'fullName' || k === 'address' ? 'sm:col-span-2' : ''}>
                  <label htmlFor={`wi-${k}`} className={fieldLabel}>{label}</label>
                  <input
                    id={`wi-${k}`}
                    type={type}
                    value={np[k]}
                    onChange={(e) => setNp((p) => ({ ...p, [k]: e.target.value }))}
                    className={inputClass}
                  />
                </div>
              ))}
              <div>
                <label htmlFor="wi-sex" className={fieldLabel}>Sex *</label>
                <select
                  id="wi-sex"
                  value={np.sex}
                  onChange={(e) => setNp((p) => ({ ...p, sex: e.target.value as typeof p.sex }))}
                  className={selectClass}
                >
                  {['Female', 'Male', 'Other', 'Prefer not to say'].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div>
            <label htmlFor="wi-notes" className={fieldLabel}>Notes</label>
            <textarea
              id="wi-notes"
              rows={2}
              maxLength={500}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reason for visit…"
              className={textareaClass}
            />
          </div>

          {error && <InlineNotice>{error}</InlineNotice>}
          {done && (
            <SuccessNote>
              <p className="font-semibold">Walk-in confirmed for {done.appt.day}.</p>
              {done.tempPassword && (
                <p className="mt-1">
                  New account:{' '}
                  {done.appt.patient && typeof done.appt.patient === 'object' ? done.appt.patient.email : ''} —
                  temporary password: <strong>{done.tempPassword}</strong> (give it to the patient once).
                </p>
              )}
            </SuccessNote>
          )}

          <button type="submit" disabled={pending} className={primaryButton}>
            {pending && <LoaderCircle size={16} className="animate-spin" aria-hidden />}
            {pending ? 'Confirming…' : 'Confirm walk-in'}
          </button>
        </form>
      </motion.section>
    </DashboardShell>
  );
}

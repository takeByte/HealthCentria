import { createFileRoute, redirect } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState, type FormEvent } from 'react';
import { CalendarCheck, LoaderCircle, ShieldCheck, TriangleAlert, Users } from 'lucide-react';
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
import { sessionCan } from '../../lib/permissions';

export const Route = createFileRoute('/staff/walk-in')({
  beforeLoad: () => {
    const session = getSession();
    if (!sessionCan(session, 'walkin.manage')) throw redirect({ to: '/staff/dashboard' });
  },
  component: WalkIn,
});

function todayYMD(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

type Mode = 'existing' | 'new';

interface Candidate {
  id: string;
  name: string;
  email: string;
}

// Common mistyped email domains -> the likely intended one.
const DOMAIN_TYPOS: Record<string, string> = {
  'gmial.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gmal.com': 'gmail.com',
  'gamil.com': 'gmail.com',
  'gnail.com': 'gmail.com',
  'gmail.con': 'gmail.com',
  'yaho.com': 'yahoo.com',
  'yahooo.com': 'yahoo.com',
  'yahoo.con': 'yahoo.com',
  'hotmial.com': 'hotmail.com',
  'hotmail.con': 'hotmail.com',
  'outlok.com': 'outlook.com',
};

function emailTypoSuggestion(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  const fixed = DOMAIN_TYPOS[email.slice(at + 1).toLowerCase()];
  return fixed ? email.slice(0, at + 1) + fixed : null;
}

const hasRealEmail = (email: string) => !/\.invalid$/i.test(email);

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
    sex: '' | 'Female' | 'Male' | 'Other' | 'Prefer not to say';
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
    sex: '',
    address: '',
    householdNumber: '',
    contactNumber: '',
    philHealthNumber: '',
    emergencyName: '',
    emergencyNumber: '',
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    appt: StaffAppointment;
    passwordSetup?: 'emailed' | 'none';
    emailSent?: boolean;
    email?: string;
  } | null>(null);
  const [candidates, setCandidates] = useState<{ code: string; list: Candidate[] } | null>(null);
  const [typoCheckedFor, setTypoCheckedFor] = useState<string | null>(null);

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

  function useExisting(c: Candidate) {
    setMode('existing');
    setEmail(c.email);
    setFound(c);
    setLookupMsg(null);
    setCandidates(null);
    setError(null);
  }

  async function submit(allowDuplicate = false) {
    setError(null);
    setDone(null);
    setCandidates(null);
    if (!serviceId) {
      setError('Select a service.');
      return;
    }
    if (mode === 'new') {
      if (!np.fullName.trim()) {
        setError('Enter the patient\'s full name.');
        return;
      }
      // A likely typo in the email gets one confirmation before it is saved.
      const typedEmail = np.email.trim().toLowerCase();
      const suggestion = typedEmail ? emailTypoSuggestion(typedEmail) : null;
      if (suggestion && typoCheckedFor !== typedEmail) {
        setTypoCheckedFor(typedEmail);
        setError(
          'Did you mean ' + suggestion + '? Fix the email, or press the button again to keep it exactly as typed.',
        );
        return;
      }
    }
    setPending(true);
    try {
      const newPatient = {
        fullName: np.fullName.trim(),
        email: np.email.trim().toLowerCase(),
        birthdate: np.birthdate,
        ...(np.sex ? { sex: np.sex } : {}),
        address: np.address.trim(),
        householdNumber: np.householdNumber.trim(),
        contactNumber: np.contactNumber.trim(),
        philHealthNumber: np.philHealthNumber.trim(),
        emergencyName: np.emergencyName.trim(),
        emergencyNumber: np.emergencyNumber.trim(),
      };
      const r = await walkInAppointment({
        serviceId,
        notes: notes.trim(),
        ...(mode === 'existing'
          ? { patientEmail: (found?.email ?? email).trim().toLowerCase() }
          : { newPatient, ...(allowDuplicate ? { allowDuplicate: true } : {}) }),
      });
      setDone({
        appt: r.appointment,
        passwordSetup: r.passwordSetup,
        emailSent: r.emailSent,
        email: mode === 'new' ? np.email.trim().toLowerCase() : undefined,
      });
    } catch (err) {
      const list = (err instanceof ApiError && (err.data?.candidates as Candidate[] | undefined)) || [];
      if (err instanceof ApiError && (err.code === 'PATIENT_EXISTS' || err.code === 'POSSIBLE_DUPLICATE')) {
        setCandidates({ code: err.code, list });
        setError(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : 'Walk-in booking failed.');
      }
    } finally {
      setPending(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void submit(false);
  }

  return (
    <DashboardShell
      title="Emergency walk-in"
      subtitle="Register an emergency patient at the desk right now"
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
        className="grid gap-3.5 sm:grid-cols-3"
      >
        <StatTile
          icon={CalendarCheck}
          label="Today"
          value={day}
          hint="Recorded for today automatically"
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
          hint="Any service, any day"
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
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-deep)]/10 text-[var(--brand-deep)]">
            <CalendarCheck size={18} aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-[15px] font-semibold tracking-[-0.01em] text-slate-900">
              Emergency walk-in — auto-confirmed
            </h2>
            <p className="mt-1 text-[13px] leading-5 text-slate-500">
              No date needed and no service-day restriction. The visit is recorded for today ({day}) and
              confirmed immediately, because the patient is present.
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
                <p role="status" className="mt-1.5 text-[12.5px] font-semibold text-[var(--brand-deep)]">
                  Found: {found.name} ({found.email})
                </p>
              )}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] leading-5 text-slate-600 sm:col-span-2">
                Only the full name is needed to start care. With an email, the patient is emailed steps to set their
                own password (nobody at the desk sees it). Without one, the record has no login and the rest can be
                completed later.
              </p>
              {(
                [
                  ['fullName', 'Full name *', 'text'],
                  ['email', 'Email (optional)', 'email'],
                  ['birthdate', 'Birthdate (optional)', 'date'],
                  ['address', 'Address (optional)', 'text'],
                  ['householdNumber', 'Household number (optional)', 'text'],
                  ['contactNumber', 'Contact number (optional)', 'tel'],
                  ['philHealthNumber', 'PhilHealth (optional)', 'text'],
                  ['emergencyName', 'Emergency contact name (optional)', 'text'],
                  ['emergencyNumber', 'Emergency contact number (optional)', 'tel'],
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
                <label htmlFor="wi-sex" className={fieldLabel}>Sex (optional)</label>
                <select
                  id="wi-sex"
                  value={np.sex}
                  onChange={(e) => setNp((p) => ({ ...p, sex: e.target.value as typeof p.sex }))}
                  className={selectClass}
                >
                  <option value="">Not specified</option>
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
              placeholder="Nature of the emergency…"
              className={textareaClass}
            />
          </div>

          {error && <InlineNotice>{error}</InlineNotice>}
          {candidates && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="flex items-center gap-1.5 text-[13px] font-semibold text-amber-900">
                <TriangleAlert size={15} aria-hidden />
                {candidates.code === 'PATIENT_EXISTS' ? 'This patient already has an account' : 'Possible duplicate'}
              </p>
              <ul className="mt-2 grid gap-1.5">
                {candidates.list.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-slate-700">
                    <span>
                      {c.name} <span className="text-slate-500">({hasRealEmail(c.email) ? c.email : 'no email on file'})</span>
                    </span>
                    <button type="button" onClick={() => useExisting(c)} className={secondaryButton}>
                      Use this patient
                    </button>
                  </li>
                ))}
              </ul>
              {candidates.code === 'POSSIBLE_DUPLICATE' && (
                <button
                  type="button"
                  onClick={() => void submit(true)}
                  className="mt-2 text-[12.5px] font-semibold text-amber-900 underline"
                >
                  It is a different person. Create a new record anyway.
                </button>
              )}
            </div>
          )}
          {done && (
            <SuccessNote>
              <p className="font-semibold">Emergency walk-in confirmed for {done.appt.day}.</p>
              {done.passwordSetup === 'emailed' && (
                <p className="mt-1">
                  {done.emailSent
                    ? 'An email with steps to set their own password was sent to ' + done.email + '.'
                    : 'The patient record was created, but the setup email could not be sent. Check the address and email settings.'}
                </p>
              )}
              {done.passwordSetup === 'none' && (
                <p className="mt-1">
                  Patient record created without an email, so there is no login yet. Add an email and complete the
                  profile later.
                </p>
              )}
            </SuccessNote>
          )}

          <button type="submit" disabled={pending} className={primaryButton}>
            {pending && <LoaderCircle size={16} className="animate-spin" aria-hidden />}
            {pending ? 'Confirming…' : 'Confirm emergency walk-in'}
          </button>
        </form>
      </motion.section>
    </DashboardShell>
  );
}

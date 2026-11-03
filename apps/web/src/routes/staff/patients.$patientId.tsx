import { createFileRoute, Link } from '@tanstack/react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, CalendarCheck, ClipboardList, FileText, LoaderCircle, Pencil, Pill } from 'lucide-react';
import { DashboardShell } from '../../components/dashboard-shell';
import { opsNav } from '../../components/ops-nav';
import {
  CardHeading,
  EmptyNote,
  InlineNotice,
  StatTile,
  StatusChip,
  StatusPill,
  fieldLabel,
  inputClass,
  panel,
  primaryButton,
  secondaryButton,
  selectClass,
} from '../../components/app-ui';
import { RecordMeta } from '../../components/record-meta';
import { Toast, type ToastMessage } from '../../components/toast';
import { getSession } from '../../lib/auth';
import {
  ApiError,
  getPatient,
  updatePatientRecord,
  type PatientDetail,
  type PatientVisit,
} from '../../lib/api';
import { getTodayService } from '../../lib/schedule';
import { cn } from '../../lib/utils';

export const Route = createFileRoute('/staff/patients/$patientId')({
  component: PatientDetailPage,
});

const SEX_OPTIONS = ['Female', 'Male', 'Other', 'Prefer not to say'] as const;
type Sex = (typeof SEX_OPTIONS)[number] | '';
const PROFILE_PHONE_REGEX = /^(?:09\d{9}|\+639\d{9})$/;

type RecordForm = {
  fullName: string;
  birthdate: string;
  sex: Sex;
  address: string;
  barangay: string;
  householdNumber: string;
  contactNumber: string;
  philHealthNumber: string;
  emergencyName: string;
  emergencyNumber: string;
};

type RecordErrors = Partial<Record<keyof RecordForm, string>>;

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

function todayYMD(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

function isValidPastBirthdate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return false;
  if (
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() + 1 !== Number(match[2]) ||
    date.getDate() !== Number(match[3])
  ) {
    return false;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date < today;
}

function normalizePhone(value: string): string {
  return value.replace(/[\s-]/g, '');
}

function emptyForm(): RecordForm {
  return {
    fullName: '',
    birthdate: '',
    sex: '',
    address: '',
    barangay: '',
    householdNumber: '',
    contactNumber: '',
    philHealthNumber: '',
    emergencyName: '',
    emergencyNumber: '',
  };
}

function formFromPatient(patient: PatientDetail): RecordForm {
  const sex = (SEX_OPTIONS as readonly string[]).includes(patient.sex) ? (patient.sex as Sex) : '';
  return {
    fullName: patient.name ?? '',
    birthdate: patient.birthdate ? patient.birthdate.slice(0, 10) : '',
    sex,
    address: patient.address ?? '',
    barangay: patient.barangay ?? '',
    householdNumber: patient.householdNumber ?? '',
    contactNumber: patient.contactNumber ?? '',
    philHealthNumber: patient.philHealthNumber ?? '',
    emergencyName: patient.emergencyName ?? '',
    emergencyNumber: patient.emergencyNumber ?? '',
  };
}

function validate(form: RecordForm): RecordErrors {
  const errors: RecordErrors = {};
  if (!form.fullName.trim()) errors.fullName = 'Full name is required.';
  if (!form.birthdate) errors.birthdate = 'Birthdate is required.';
  else if (!isValidPastBirthdate(form.birthdate)) errors.birthdate = 'Enter a valid past birthdate.';
  if (!form.sex) errors.sex = 'Select a sex.';
  if (!form.address.trim()) errors.address = 'Address is required.';
  if (!form.barangay.trim()) errors.barangay = 'Barangay is required.';
  if (!PROFILE_PHONE_REGEX.test(normalizePhone(form.contactNumber))) {
    errors.contactNumber = 'Use 09XXXXXXXXX or +639XXXXXXXXX.';
  }
  return errors;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 text-sm text-destructive">
      {message}
    </p>
  );
}

function PatientDetailPage() {
  const reduceMotion = useReducedMotion();
  const session = getSession();
  const today = getTodayService();
  const { patientId } = Route.useParams();
  const [patient, setPatient] = useState<PatientDetail | null>(null);
  const [visits, setVisits] = useState<PatientVisit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<RecordForm>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<RecordErrors>({});
  const [pending, setPending] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setPatient(null);
    setVisits(null);
    setEditing(false);
    setFieldErrors({});
    getPatient(patientId)
      .then((r) => {
        if (!cancelled) {
          setPatient(r.patient);
          setVisits(r.visits);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message =
            err instanceof ApiError && err.status === 401
              ? 'Your session expired. Log in again to view this patient.'
              : err instanceof Error
                ? err.message
                : 'Could not load patient.';
          setError(message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [patientId, reloadKey]);

  function set<K extends keyof RecordForm>(key: K, value: RecordForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  }

  function startEdit() {
    if (!patient) return;
    setForm(formFromPatient(patient));
    setFieldErrors({});
    setEditing(true);
  }

  function cancelEdit() {
    if (patient) setForm(formFromPatient(patient));
    setFieldErrors({});
    setEditing(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!patient) return;
    const nextErrors = validate(form);
    setFieldErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) {
      setToast({ tone: 'error', message: 'Please fix the highlighted fields and try again.' });
      return;
    }

    setPending(true);
    try {
      const result = await updatePatientRecord(patient.id, {
        fullName: form.fullName.trim(),
        birthdate: form.birthdate,
        sex: form.sex,
        address: form.address.trim(),
        barangay: form.barangay.trim(),
        householdNumber: form.householdNumber.trim(),
        contactNumber: normalizePhone(form.contactNumber),
        philHealthNumber: form.philHealthNumber.trim(),
        emergencyName: form.emergencyName.trim(),
        emergencyNumber: form.emergencyNumber.trim(),
      });
      setPatient(result.patient);
      setForm(formFromPatient(result.patient));
      setEditing(false);
      setFieldErrors({});
      setToast({ tone: 'success', message: 'Patient record updated.' });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.errors) {
          const serverErrors: RecordErrors = {};
          for (const key of Object.keys(emptyForm()) as Array<keyof RecordForm>) {
            const message = err.errors[key]?.[0];
            if (message) serverErrors[key] = message;
          }
          setFieldErrors(serverErrors);
        }
        setToast({ tone: 'error', message: err.message || 'Could not update the patient record.' });
      } else {
        setToast({ tone: 'error', message: 'Could not update the patient record. Try again.' });
      }
    } finally {
      setPending(false);
    }
  }

  const completed = (visits ?? []).filter((v) => v.status === 'completed');

  const facts: Array<[string, string]> = patient
    ? [
        ['Contact', patient.contactNumber || '—'],
        ['Address', patient.address || '—'],
        ['Barangay', patient.barangay || '—'],
        ['Household', patient.householdNumber || '—'],
        ['Birthdate', `${patient.birthdate || '—'}${patient.sex ? ` · ${patient.sex}` : ''}`],
        ['PhilHealth', patient.philHealthNumber || '—'],
        ['Emergency', [patient.emergencyName, patient.emergencyNumber].filter(Boolean).join(' · ') || '—'],
      ]
    : [];

  const rise = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const riseTransition = { type: 'spring', bounce: 0, duration: 0.35 } as const;

  return (
    <>
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

        {error && (
          <div className="space-y-2">
            <InlineNotice>{error}</InlineNotice>
            <button
              type="button"
              onClick={() => setReloadKey((key) => key + 1)}
              className={`${secondaryButton} h-9 px-3.5 text-[13px]`}
            >
              Try again
            </button>
          </div>
        )}
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
                className={`${panel} ${editing ? '' : 'lg:sticky lg:top-24'} lg:col-span-2`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
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
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <StatusPill tone={patient.profileCompleted ? 'teal' : 'amber'}>
                        {patient.profileCompleted ? 'Profile complete' : 'Profile incomplete'}
                      </StatusPill>
                      {patient.authProvider === 'google' && <StatusPill tone="sky">Google</StatusPill>}
                      {!patient.active && <StatusPill tone="slate">Inactive</StatusPill>}
                    </div>
                    {!editing && (
                      <button
                        type="button"
                        onClick={startEdit}
                        className={`${secondaryButton} h-9 px-3 text-[13px]`}
                      >
                        <Pencil size={14} aria-hidden /> Edit
                      </button>
                    )}
                  </div>
                </div>

                <RecordMeta
                  createdAt={patient.createdAt}
                  updatedAt={patient.updatedAt}
                  updatedByName={patient.updatedByName}
                  className="mt-3 border-t border-slate-200/70 pt-2.5"
                />

                {!patient.profileCompleted && !editing && (
                  <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-[11.5px] leading-5 text-amber-900 ring-1 ring-inset ring-amber-600/15">
                    This patient still needs the required profile fields before booking. Use Edit to complete the
                    chart.
                  </p>
                )}

                {editing ? (
                  <form
                    onSubmit={handleSubmit}
                    noValidate
                    className="mt-4 grid gap-4 border-t border-slate-200/70 pt-4 sm:grid-cols-2"
                    aria-label="Edit patient record"
                  >
                    <div className="sm:col-span-2">
                      <label htmlFor="record-name" className={fieldLabel}>
                        Full name
                      </label>
                      <input
                        id="record-name"
                        autoComplete="name"
                        value={form.fullName}
                        onChange={(event) => set('fullName', event.target.value)}
                        aria-invalid={Boolean(fieldErrors.fullName)}
                        aria-describedby={fieldErrors.fullName ? 'record-name-error' : undefined}
                        className={cn(inputClass, 'aria-[invalid=true]:border-destructive')}
                      />
                      <FieldError id="record-name-error" message={fieldErrors.fullName} />
                    </div>

                    <div>
                      <label htmlFor="record-birthdate" className={fieldLabel}>
                        Birthdate
                      </label>
                      <input
                        id="record-birthdate"
                        type="date"
                        max={todayYMD()}
                        value={form.birthdate}
                        onChange={(event) => set('birthdate', event.target.value)}
                        aria-invalid={Boolean(fieldErrors.birthdate)}
                        aria-describedby={fieldErrors.birthdate ? 'record-birthdate-error' : undefined}
                        className={cn(inputClass, 'aria-[invalid=true]:border-destructive')}
                      />
                      <FieldError id="record-birthdate-error" message={fieldErrors.birthdate} />
                    </div>

                    <div>
                      <label htmlFor="record-sex" className={fieldLabel}>
                        Sex
                      </label>
                      <select
                        id="record-sex"
                        value={form.sex}
                        onChange={(event) => set('sex', event.target.value as Sex)}
                        aria-invalid={Boolean(fieldErrors.sex)}
                        aria-describedby={fieldErrors.sex ? 'record-sex-error' : undefined}
                        className={cn(selectClass, 'aria-[invalid=true]:border-destructive')}
                      >
                        <option value="">Select sex</option>
                        {SEX_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                      <FieldError id="record-sex-error" message={fieldErrors.sex} />
                    </div>

                    <div className="sm:col-span-2">
                      <label htmlFor="record-contact" className={fieldLabel}>
                        Contact number
                      </label>
                      <input
                        id="record-contact"
                        type="tel"
                        inputMode="tel"
                        placeholder="09XXXXXXXXX or +639XXXXXXXXX"
                        value={form.contactNumber}
                        onChange={(event) => set('contactNumber', event.target.value)}
                        aria-invalid={Boolean(fieldErrors.contactNumber)}
                        aria-describedby={fieldErrors.contactNumber ? 'record-contact-error' : undefined}
                        className={cn(inputClass, 'aria-[invalid=true]:border-destructive')}
                      />
                      <FieldError id="record-contact-error" message={fieldErrors.contactNumber} />
                    </div>

                    <div className="sm:col-span-2">
                      <label htmlFor="record-address" className={fieldLabel}>
                        Address
                      </label>
                      <input
                        id="record-address"
                        autoComplete="street-address"
                        value={form.address}
                        onChange={(event) => set('address', event.target.value)}
                        aria-invalid={Boolean(fieldErrors.address)}
                        aria-describedby={fieldErrors.address ? 'record-address-error' : undefined}
                        className={cn(inputClass, 'aria-[invalid=true]:border-destructive')}
                      />
                      <FieldError id="record-address-error" message={fieldErrors.address} />
                    </div>

                    <div className="sm:col-span-2">
                      <label htmlFor="record-barangay" className={fieldLabel}>
                        Barangay
                      </label>
                      <input
                        id="record-barangay"
                        autoComplete="address-level3"
                        value={form.barangay}
                        onChange={(event) => set('barangay', event.target.value)}
                        aria-invalid={Boolean(fieldErrors.barangay)}
                        aria-describedby={fieldErrors.barangay ? 'record-barangay-error' : undefined}
                        className={cn(inputClass, 'aria-[invalid=true]:border-destructive')}
                      />
                      <FieldError id="record-barangay-error" message={fieldErrors.barangay} />
                    </div>

                    <div>
                      <label htmlFor="record-household" className={fieldLabel}>
                        Household number
                      </label>
                      <input
                        id="record-household"
                        value={form.householdNumber}
                        onChange={(event) => set('householdNumber', event.target.value)}
                        className={inputClass}
                      />
                    </div>

                    <div>
                      <label htmlFor="record-philhealth" className={fieldLabel}>
                        PhilHealth number
                      </label>
                      <input
                        id="record-philhealth"
                        value={form.philHealthNumber}
                        onChange={(event) => set('philHealthNumber', event.target.value)}
                        className={inputClass}
                      />
                    </div>

                    <div>
                      <label htmlFor="record-emergency-name" className={fieldLabel}>
                        Emergency contact name
                      </label>
                      <input
                        id="record-emergency-name"
                        value={form.emergencyName}
                        onChange={(event) => set('emergencyName', event.target.value)}
                        className={inputClass}
                      />
                    </div>

                    <div>
                      <label htmlFor="record-emergency-number" className={fieldLabel}>
                        Emergency contact number
                      </label>
                      <input
                        id="record-emergency-number"
                        type="tel"
                        inputMode="tel"
                        value={form.emergencyNumber}
                        onChange={(event) => set('emergencyNumber', event.target.value)}
                        className={inputClass}
                      />
                    </div>

                    <div className="flex flex-col gap-2.5 sm:col-span-2 sm:flex-row sm:justify-end">
                      <button type="button" onClick={cancelEdit} className={secondaryButton} disabled={pending}>
                        Cancel
                      </button>
                      <button type="submit" disabled={pending} className={primaryButton}>
                        {pending && <LoaderCircle size={16} className="animate-spin" aria-hidden />}
                        {pending ? 'Saving…' : 'Save changes'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <dl className="mt-5 grid gap-x-6 gap-y-3 border-t border-slate-200/70 pt-4 text-[13px] sm:grid-cols-2 lg:grid-cols-1">
                    {facts.map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-slate-500">
                          {label}
                        </dt>
                        <dd className="mt-0.5 leading-5 text-slate-800">{value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
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
                          <RecordMeta
                            createdAt={v.createdAt}
                            updatedAt={v.updatedAt}
                            updatedByName={v.updatedByName}
                            className="mt-1"
                          />
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

      <AnimatePresence>
        {toast && <Toast key={`${toast.tone}-${toast.message}`} toast={toast} onDone={() => setToast(null)} />}
      </AnimatePresence>
    </>
  );
}

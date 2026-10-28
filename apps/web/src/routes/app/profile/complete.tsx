import { createFileRoute, redirect, Link, useNavigate } from '@tanstack/react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState, type FormEvent } from 'react';
import { LoaderCircle, UserRound } from 'lucide-react';
import { DashboardShell } from '../../../components/dashboard-shell';
import { patientNav } from '../../../components/patient-nav';
import { cardPadding, fieldLabel, inputClass, primaryButton, secondaryButton } from '../../../components/app-ui';
import { Toast, type ToastMessage } from '../../../components/toast';
import { getSession, setSession } from '../../../lib/auth';
import { ApiError, completePatientProfile } from '../../../lib/api';
import { getTodayService } from '../../../lib/schedule';
import { cn } from '../../../lib/utils';

export const Route = createFileRoute('/app/profile/complete')({
  beforeLoad: () => {
    const session = getSession();
    if (!session) throw redirect({ to: '/login' });
    if (session.role !== 'patient') {
      throw redirect({ to: session.role === 'admin' ? '/admin/dashboard' : '/staff/dashboard' });
    }
    if (session.profileCompleted === true) throw redirect({ to: '/app/dashboard' });
  },
  component: CompleteProfile,
});

type FormState = {
  fullName: string;
  birthdate: string;
  address: string;
  barangay: string;
  contactNumber: string;
};

type Errors = Partial<Record<keyof FormState, string>>;

const PROFILE_FIELDS: Array<keyof FormState> = [
  'fullName',
  'birthdate',
  'address',
  'barangay',
  'contactNumber',
];
const PROFILE_PHONE_REGEX = /^(?:09\d{9}|\+639\d{9})$/;

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

function validate(form: FormState): Errors {
  const errors: Errors = {};
  if (!form.fullName.trim()) errors.fullName = 'Enter your full name.';
  if (!form.birthdate) errors.birthdate = 'Enter your birthdate.';
  else if (!isValidPastBirthdate(form.birthdate)) errors.birthdate = 'Enter a valid past birthdate.';
  if (!form.address.trim()) errors.address = 'Enter your address.';
  if (!form.barangay.trim()) errors.barangay = 'Enter your barangay.';
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

function CompleteProfile() {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const session = getSession();
  const today = getTodayService();
  const [form, setForm] = useState<FormState>(() => ({
    fullName: session?.name ?? '',
    birthdate: '',
    address: '',
    barangay: '',
    contactNumber: '',
  }));
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validate(form);
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) {
      setToast({ tone: 'error', message: 'Please fix the highlighted fields and try again.' });
      return;
    }

    setPending(true);
    try {
      const result = await completePatientProfile({
        fullName: form.fullName.trim(),
        birthdate: form.birthdate,
        address: form.address.trim(),
        barangay: form.barangay.trim(),
        contactNumber: normalizePhone(form.contactNumber),
      });
      const current = getSession();
      if (current) {
        setSession({
          ...current,
          name: result.user.name,
          authProvider: result.user.authProvider,
          profileCompleted: true,
          avatarUrl: result.user.avatarUrl,
        });
      }
      setToast({ tone: 'success', message: 'Profile completed. You can book appointments now.' });
      window.setTimeout(() => {
        void navigate({ to: '/app/dashboard' });
      }, 700);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.errors) {
          const serverErrors: Errors = {};
          for (const key of PROFILE_FIELDS) {
            const message = err.errors[key]?.[0];
            if (message) serverErrors[key] = message;
          }
          setErrors(serverErrors);
        }
        setToast({ tone: 'error', message: err.message || 'Could not save your profile. Try again.' });
      } else {
        setToast({ tone: 'error', message: 'Could not save your profile. Check your connection and try again.' });
      }
      setPending(false);
    }
  }

  const rise = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

  return (
    <>
      <DashboardShell
        title="Complete your profile"
        subtitle="One quick step before booking"
        roleLabel="Patient"
        userName={session?.name}
        userEmail={session?.email ?? ''}
        todayService={`${today.name} — ${today.detail}`}
        nav={patientNav}
        notificationsTo="/app/notifications"
        mainClassName="max-w-2xl"
      >
        <motion.section
          {...rise}
          transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
          className={`app-card ${cardPadding}`}
          aria-labelledby="complete-profile-heading"
        >
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-teal-600/10 text-teal-700">
              <UserRound size={19} aria-hidden />
            </span>
            <div className="min-w-0">
              <h2
                id="complete-profile-heading"
                className="font-display text-[19px] font-semibold leading-tight tracking-[-0.02em] text-slate-900"
              >
                Complete your profile
              </h2>
              <p className="mt-1 text-[13px] leading-5 text-slate-600">
                Google shared your name and email. Add the rest so the health center can prepare for your visit.
              </p>
            </div>
          </div>

          <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-[13px] leading-5 text-amber-900 ring-1 ring-inset ring-amber-600/15">
            You can browse services now, but booking is available after this form is complete.
          </p>

          <form onSubmit={handleSubmit} noValidate className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="profile-name" className={fieldLabel}>
                Full name
              </label>
              <input
                id="profile-name"
                autoComplete="name"
                value={form.fullName}
                onChange={(event) => set('fullName', event.target.value)}
                aria-invalid={Boolean(errors.fullName)}
                aria-describedby={errors.fullName ? 'profile-name-error' : undefined}
                className={cn(inputClass, 'aria-[invalid=true]:border-destructive')}
              />
              <FieldError id="profile-name-error" message={errors.fullName} />
            </div>

            <div>
              <label htmlFor="profile-birthdate" className={fieldLabel}>
                Birthdate
              </label>
              <input
                id="profile-birthdate"
                type="date"
                autoComplete="bday"
                max={todayYMD()}
                value={form.birthdate}
                onChange={(event) => set('birthdate', event.target.value)}
                aria-invalid={Boolean(errors.birthdate)}
                aria-describedby={errors.birthdate ? 'profile-birthdate-error' : undefined}
                className={cn(inputClass, 'aria-[invalid=true]:border-destructive')}
              />
              <FieldError id="profile-birthdate-error" message={errors.birthdate} />
            </div>

            <div>
              <label htmlFor="profile-contact" className={fieldLabel}>
                Contact number
              </label>
              <input
                id="profile-contact"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                placeholder="09XXXXXXXXX or +639XXXXXXXXX"
                value={form.contactNumber}
                onChange={(event) => set('contactNumber', event.target.value)}
                aria-invalid={Boolean(errors.contactNumber)}
                aria-describedby={errors.contactNumber ? 'profile-contact-error' : undefined}
                className={cn(inputClass, 'aria-[invalid=true]:border-destructive')}
              />
              <FieldError id="profile-contact-error" message={errors.contactNumber} />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="profile-address" className={fieldLabel}>
                Address
              </label>
              <input
                id="profile-address"
                autoComplete="street-address"
                placeholder="House number, street, purok"
                value={form.address}
                onChange={(event) => set('address', event.target.value)}
                aria-invalid={Boolean(errors.address)}
                aria-describedby={errors.address ? 'profile-address-error' : undefined}
                className={cn(inputClass, 'aria-[invalid=true]:border-destructive')}
              />
              <FieldError id="profile-address-error" message={errors.address} />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="profile-barangay" className={fieldLabel}>
                Barangay
              </label>
              <input
                id="profile-barangay"
                autoComplete="address-level3"
                placeholder="Barangay 11"
                value={form.barangay}
                onChange={(event) => set('barangay', event.target.value)}
                aria-invalid={Boolean(errors.barangay)}
                aria-describedby={errors.barangay ? 'profile-barangay-error' : undefined}
                className={cn(inputClass, 'aria-[invalid=true]:border-destructive')}
              />
              <FieldError id="profile-barangay-error" message={errors.barangay} />
            </div>

            <div className="mt-1 flex flex-col gap-2.5 sm:col-span-2 sm:flex-row sm:justify-end">
              <Link to="/app/dashboard" className={secondaryButton}>
                Not now
              </Link>
              <button type="submit" disabled={pending} className={primaryButton}>
                {pending && <LoaderCircle size={16} className="animate-spin" aria-hidden />}
                {pending ? 'Saving…' : 'Save and continue'}
              </button>
            </div>
          </form>
        </motion.section>
      </DashboardShell>

      <AnimatePresence>
        {toast && <Toast key={`${toast.tone}-${toast.message}`} toast={toast} onDone={() => setToast(null)} />}
      </AnimatePresence>
    </>
  );
}

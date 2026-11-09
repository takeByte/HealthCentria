import { createFileRoute, redirect, Link } from '@tanstack/react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Camera, KeyRound, LoaderCircle, Pencil, Trash2, UserRound } from 'lucide-react';
import { DashboardShell } from '../../../components/dashboard-shell';
import { patientNav } from '../../../components/patient-nav';
import {
  EmptyNote,
  InlineNotice,
  StatusPill,
  cardPadding,
  fieldLabel,
  inputClass,
  panel,
  primaryButton,
  secondaryButton,
} from '../../../components/app-ui';
import { Toast, type ToastMessage } from '../../../components/toast';
import { getSession, isValidPassword, PASSWORD_ERROR_MESSAGE, setSession } from '../../../lib/auth';
import { fileToAvatarDataUrl } from '../../../lib/image';
import {
  ApiError,
  changeMyPassword,
  completePatientProfile,
  getMyPatientProfile,
  type PatientDetail,
} from '../../../lib/api';
import { getTodayService } from '../../../lib/schedule';
import { cn } from '../../../lib/utils';

export const Route = createFileRoute('/app/profile/')({
  beforeLoad: () => {
    const session = getSession();
    if (!session) throw redirect({ to: '/login' });
    if (session.role !== 'patient') {
      throw redirect({ to: session.role === 'admin' ? '/admin/dashboard' : '/staff/dashboard' });
    }
    if (session.profileCompleted === false) throw redirect({ to: '/app/profile/complete' });
  },
  component: MyProfilePage,
});

type FormState = {
  fullName: string;
  birthdate: string;
  address: string;
  barangay: string;
  contactNumber: string;
  householdNumber: string;
  emergencyName: string;
  emergencyNumber: string;
};

type Errors = Partial<Record<keyof FormState, string>>;

const PROFILE_FIELDS: Array<keyof FormState> = [
  'fullName',
  'birthdate',
  'address',
  'barangay',
  'contactNumber',
  'householdNumber',
  'emergencyName',
  'emergencyNumber',
];
const PROFILE_PHONE_REGEX = /^(?:09\d{9}|\+639\d{9})$/;
const EMPTY_FORM: FormState = {
  fullName: '',
  birthdate: '',
  address: '',
  barangay: '',
  contactNumber: '',
  householdNumber: '',
  emergencyName: '',
  emergencyNumber: '',
};

type PasswordForm = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

type PasswordErrors = Partial<Record<keyof PasswordForm, string>>;

const EMPTY_PASSWORD_FORM: PasswordForm = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
};

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

function formFromPatient(patient: PatientDetail): FormState {
  return {
    fullName: patient.name ?? '',
    birthdate: patient.birthdate ? patient.birthdate.slice(0, 10) : '',
    address: patient.address ?? '',
    barangay: patient.barangay ?? '',
    contactNumber: patient.contactNumber ?? '',
    householdNumber: patient.householdNumber ?? '',
    emergencyName: patient.emergencyName ?? '',
    emergencyNumber: patient.emergencyNumber ?? '',
  };
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 text-sm text-destructive">
      {message}
    </p>
  );
}

function MyProfilePage() {
  const reduceMotion = useReducedMotion();
  const session = getSession();
  const today = getTodayService();
  const [patient, setPatient] = useState<PatientDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [avatarUrl, setAvatarUrl] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  const [password, setPassword] = useState<PasswordForm>(EMPTY_PASSWORD_FORM);
  const [passwordErrors, setPasswordErrors] = useState<PasswordErrors>({});
  const [passwordOpen, setPasswordOpen] = useState(false);
  const passwordEntered = passwordOpen;

  useEffect(() => {
    let cancelled = false;
    setError(null);
    getMyPatientProfile()
      .then((result) => {
        if (!cancelled) {
          setPatient(result.patient);
          setForm(formFromPatient(result.patient));
          setAvatarUrl(result.patient.avatarUrl ?? '');
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load your profile.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  }

  function setPasswordField(field: keyof PasswordForm, value: string) {
    setPassword((current) => ({ ...current, [field]: value }));
    setPasswordErrors((current) => ({ ...current, [field]: undefined }));
  }

  function togglePassword(next: boolean) {
    setPasswordOpen(next);
    if (!next) {
      setPassword(EMPTY_PASSWORD_FORM);
      setPasswordErrors({});
    }
  }

  function validatePassword(form: PasswordForm): PasswordErrors {
    if (!passwordOpen) return {};
    const errors: PasswordErrors = {};
    if (!form.currentPassword) errors.currentPassword = 'Enter your current password.';
    if (!form.newPassword) errors.newPassword = 'Enter a new password.';
    else if (!isValidPassword(form.newPassword)) errors.newPassword = PASSWORD_ERROR_MESSAGE;
    if (form.confirmPassword !== form.newPassword) errors.confirmPassword = 'Passwords do not match.';
    return errors;
  }

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    setPhotoBusy(true);
    try {
      setAvatarUrl(await fileToAvatarDataUrl(file));
    } catch (err) {
      setToast({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Could not read that image.',
      });
    } finally {
      setPhotoBusy(false);
      if (photoInput.current) photoInput.current.value = '';
    }
  }

  function startEdit() {
    if (!patient) return;
    setForm(formFromPatient(patient));
    setAvatarUrl(patient.avatarUrl ?? '');
    setPassword(EMPTY_PASSWORD_FORM);
    setPasswordErrors({});
    setPasswordOpen(false);
    setFieldErrors({});
    setEditing(true);
  }

  function cancelEdit() {
    if (patient) {
      setForm(formFromPatient(patient));
      setAvatarUrl(patient.avatarUrl ?? '');
    }
    setPassword(EMPTY_PASSWORD_FORM);
    setPasswordErrors({});
    setPasswordOpen(false);
    setFieldErrors({});
    setEditing(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validate(form);
    setFieldErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) {
      setToast({ tone: 'error', message: 'Please fix the highlighted fields and try again.' });
      return;
    }

    const nextPasswordErrors = validatePassword(password);
    setPasswordErrors(nextPasswordErrors);
    if (Object.values(nextPasswordErrors).some(Boolean)) {
      setToast({ tone: 'error', message: 'Please fix the highlighted password fields and try again.' });
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
        householdNumber: form.householdNumber.trim(),
        emergencyName: form.emergencyName.trim(),
        emergencyNumber: form.emergencyNumber.trim(),
        avatarUrl,
      });
      if (passwordEntered) {
        await changeMyPassword({
          currentPassword: password.currentPassword,
          newPassword: password.newPassword,
        });
      }

      const normalized: FormState = {
        fullName: form.fullName.trim(),
        birthdate: form.birthdate,
        address: form.address.trim(),
        barangay: form.barangay.trim(),
        contactNumber: normalizePhone(form.contactNumber),
        householdNumber: form.householdNumber.trim(),
        emergencyName: form.emergencyName.trim(),
        emergencyNumber: form.emergencyNumber.trim(),
      };
      setForm(normalized);
      setPatient((current) =>
        current
          ? {
              ...current,
              name: normalized.fullName,
              birthdate: normalized.birthdate,
              address: normalized.address,
              barangay: normalized.barangay,
              contactNumber: normalized.contactNumber,
              householdNumber: normalized.householdNumber,
              emergencyName: normalized.emergencyName,
              emergencyNumber: normalized.emergencyNumber,
              avatarUrl: result.user.avatarUrl,
              profileCompleted: true,
            }
          : current,
      );

      const currentSession = getSession();
      if (currentSession) {
        setSession({
          ...currentSession,
          name: result.user.name,
          authProvider: result.user.authProvider,
          profileCompleted: true,
          avatarUrl: result.user.avatarUrl,
        });
      }
      setPassword(EMPTY_PASSWORD_FORM);
      setPasswordErrors({});
      setPasswordOpen(false);
      setEditing(false);
      setFieldErrors({});
      setToast({
        tone: 'success',
        message: passwordEntered ? 'Profile and password updated.' : 'Profile updated.',
      });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.errors) {
          const serverErrors: Errors = {};
          for (const key of PROFILE_FIELDS) {
            const message = err.errors[key]?.[0];
            if (message) serverErrors[key] = message;
          }
          setFieldErrors(serverErrors);
          if (err.errors.currentPassword || err.errors.newPassword) {
            setPasswordErrors({
              currentPassword: err.errors.currentPassword?.[0],
              newPassword: err.errors.newPassword?.[0],
            });
          }
        }
        setToast({ tone: 'error', message: err.message || 'Could not save your profile. Try again.' });
      } else {
        setToast({ tone: 'error', message: 'Could not save your profile. Check your connection and try again.' });
      }
    } finally {
      setPending(false);
    }
  }

  const rise = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const riseTransition = { type: 'spring', bounce: 0, duration: 0.35 } as const;

  const details: Array<[string, string]> = patient
    ? [
        ['Contact number', patient.contactNumber || '—'],
        ['Birthdate', patient.birthdate || '—'],
        ['Sex', patient.sex || '—'],
        ['Address', patient.address || '—'],
        ['Barangay', patient.barangay || '—'],
        ['Household number', patient.householdNumber || '—'],
        ['PhilHealth number', patient.philHealthNumber || '—'],
        [
          'Emergency contact',
          [patient.emergencyName, patient.emergencyNumber].filter(Boolean).join(' · ') || '—',
        ],
      ]
    : [];

  return (
    <>
      <DashboardShell
        title="My Profile"
        subtitle="Your personal and contact details"
        roleLabel="Patient"
        userName={session?.name}
        userEmail={session?.email ?? ''}
        todayService={`${today.name} — ${today.detail}`}
        nav={patientNav}
        notificationsTo="/app/notifications"
        mainClassName="max-w-4xl"
      >
        {error && (
          <div className="space-y-2">
            <InlineNotice>{error}</InlineNotice>
            <Link to="/login" className={`${secondaryButton} h-9 px-3.5 text-[13px]`}>
              Back to login
            </Link>
          </div>
        )}
        {patient === null && !error && <EmptyNote>Loading your profile…</EmptyNote>}

        {patient && (
          <motion.div {...rise} transition={riseTransition} className="space-y-5">
            <section className={`${panel} overflow-hidden`}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3.5">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="size-14 shrink-0 rounded-full object-cover ring-2 ring-white shadow-[0_2px_8px_rgba(15,60,90,0.18)]"
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="flex size-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-600 to-blue-600 text-[18px] font-bold text-white shadow-[0_2px_8px_rgba(15,60,90,0.18)]"
                    >
                      {initials(patient.name) || <UserRound size={20} />}
                    </span>
                  )}
                  <div className="min-w-0">
                    <h2 className="truncate font-display text-[20px] font-semibold tracking-[-0.02em] text-slate-900">
                      {patient.name}
                    </h2>
                    <p className="mt-0.5 truncate text-[13px] text-slate-600">{patient.email}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <StatusPill tone={patient.profileCompleted ? 'teal' : 'amber'}>
                        {patient.profileCompleted ? 'Profile complete' : 'Profile incomplete'}
                      </StatusPill>
                      {patient.authProvider === 'google' && <StatusPill tone="sky">Google account</StatusPill>}
                    </div>
                  </div>
                </div>
                {!editing && (
                  <button type="button" onClick={startEdit} className={`${secondaryButton} h-9 px-3.5 text-[13px]`}>
                    <Pencil size={14} aria-hidden /> Edit profile
                  </button>
                )}
              </div>
            </section>

            <div className="grid items-start gap-5 lg:grid-cols-3">
              {editing ? (
                <motion.form
                  {...rise}
                  transition={{ ...riseTransition, delay: 0.04 }}
                  onSubmit={handleSubmit}
                  noValidate
                  className={`${panel} lg:col-span-2`}
                  aria-labelledby="edit-profile-heading"
                >
                  <div className="flex items-center gap-2">
                    <Pencil size={17} aria-hidden className="text-teal-700" />
                    <h3
                      id="edit-profile-heading"
                      className="font-display text-[16px] font-semibold tracking-[-0.01em] text-slate-900"
                    >
                      Edit profile
                    </h3>
                  </div>
                  <p className="mt-1 text-[12.5px] leading-5 text-slate-500">
                    Keep your contact details current so the health center can reach you.
                  </p>

                  <div className="mt-4 flex flex-wrap items-center gap-4">
                    <span
                      aria-hidden
                      className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-teal-600 to-blue-600 text-[20px] font-bold text-white shadow-[0_2px_8px_rgba(15,60,90,0.18)]"
                    >
                      {avatarUrl ? (
                        <img
                          src={avatarUrl}
                          alt=""
                          referrerPolicy="no-referrer"
                          className="size-full object-cover"
                        />
                      ) : (
                        initials(form.fullName) || <UserRound size={22} />
                      )}
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        ref={photoInput}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="sr-only"
                        onChange={(event) => void pickPhoto(event.target.files?.[0])}
                      />
                      <button
                        type="button"
                        onClick={() => photoInput.current?.click()}
                        disabled={photoBusy}
                        className={`${secondaryButton} h-9 px-3.5 text-[13px]`}
                      >
                        {photoBusy ? (
                          <LoaderCircle size={15} className="animate-spin" aria-hidden />
                        ) : (
                          <Camera size={15} aria-hidden />
                        )}
                        {photoBusy ? 'Preparing…' : avatarUrl ? 'Change photo' : 'Add photo'}
                      </button>
                      {avatarUrl && (
                        <button
                          type="button"
                          onClick={() => setAvatarUrl('')}
                          className={`${secondaryButton} h-9 px-3.5 text-[13px]`}
                        >
                          <Trash2 size={15} aria-hidden /> Remove
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label htmlFor="my-profile-name" className={fieldLabel}>
                        Full name
                      </label>
                      <input
                        id="my-profile-name"
                        autoComplete="name"
                        value={form.fullName}
                        onChange={(event) => set('fullName', event.target.value)}
                        aria-invalid={Boolean(fieldErrors.fullName)}
                        aria-describedby={fieldErrors.fullName ? 'my-profile-name-error' : undefined}
                        className={cn(inputClass, 'aria-[invalid=true]:border-destructive')}
                      />
                      <FieldError id="my-profile-name-error" message={fieldErrors.fullName} />
                    </div>

                    <div>
                      <label htmlFor="my-profile-birthdate" className={fieldLabel}>
                        Birthdate
                      </label>
                      <input
                        id="my-profile-birthdate"
                        type="date"
                        autoComplete="bday"
                        max={todayYMD()}
                        value={form.birthdate}
                        onChange={(event) => set('birthdate', event.target.value)}
                        aria-invalid={Boolean(fieldErrors.birthdate)}
                        aria-describedby={fieldErrors.birthdate ? 'my-profile-birthdate-error' : undefined}
                        className={cn(inputClass, 'aria-[invalid=true]:border-destructive')}
                      />
                      <FieldError id="my-profile-birthdate-error" message={fieldErrors.birthdate} />
                    </div>

                    <div>
                      <label htmlFor="my-profile-contact" className={fieldLabel}>
                        Contact number
                      </label>
                      <input
                        id="my-profile-contact"
                        type="tel"
                        autoComplete="tel"
                        inputMode="tel"
                        placeholder="09XXXXXXXXX or +639XXXXXXXXX"
                        value={form.contactNumber}
                        onChange={(event) => set('contactNumber', event.target.value)}
                        aria-invalid={Boolean(fieldErrors.contactNumber)}
                        aria-describedby={fieldErrors.contactNumber ? 'my-profile-contact-error' : undefined}
                        className={cn(inputClass, 'aria-[invalid=true]:border-destructive')}
                      />
                      <FieldError id="my-profile-contact-error" message={fieldErrors.contactNumber} />
                    </div>

                    <div className="sm:col-span-2">
                      <label htmlFor="my-profile-address" className={fieldLabel}>
                        Address
                      </label>
                      <input
                        id="my-profile-address"
                        autoComplete="street-address"
                        placeholder="House number, street, purok"
                        value={form.address}
                        onChange={(event) => set('address', event.target.value)}
                        aria-invalid={Boolean(fieldErrors.address)}
                        aria-describedby={fieldErrors.address ? 'my-profile-address-error' : undefined}
                        className={cn(inputClass, 'aria-[invalid=true]:border-destructive')}
                      />
                      <FieldError id="my-profile-address-error" message={fieldErrors.address} />
                    </div>

                    <div className="sm:col-span-2">
                      <label htmlFor="my-profile-barangay" className={fieldLabel}>
                        Barangay
                      </label>
                      <input
                        id="my-profile-barangay"
                        autoComplete="address-level3"
                        placeholder="Barangay 11"
                        value={form.barangay}
                        onChange={(event) => set('barangay', event.target.value)}
                        aria-invalid={Boolean(fieldErrors.barangay)}
                        aria-describedby={fieldErrors.barangay ? 'my-profile-barangay-error' : undefined}
                        className={cn(inputClass, 'aria-[invalid=true]:border-destructive')}
                      />
                      <FieldError id="my-profile-barangay-error" message={fieldErrors.barangay} />
                    </div>

                    <div className="sm:col-span-2">
                      <label htmlFor="my-profile-emergency-name" className={fieldLabel}>
                        Emergency contact name
                      </label>
                      <input
                        id="my-profile-emergency-name"
                        autoComplete="name"
                        placeholder="Optional"
                        value={form.emergencyName}
                        onChange={(event) => set('emergencyName', event.target.value)}
                        aria-invalid={Boolean(fieldErrors.emergencyName)}
                        aria-describedby={
                          fieldErrors.emergencyName ? 'my-profile-emergency-name-error' : undefined
                        }
                        className={cn(inputClass, 'aria-[invalid=true]:border-destructive')}
                      />
                      <FieldError id="my-profile-emergency-name-error" message={fieldErrors.emergencyName} />
                    </div>

                    <div>
                      <label htmlFor="my-profile-household" className={fieldLabel}>
                        Household number
                      </label>
                      <input
                        id="my-profile-household"
                        placeholder="Optional"
                        value={form.householdNumber}
                        onChange={(event) => set('householdNumber', event.target.value)}
                        aria-invalid={Boolean(fieldErrors.householdNumber)}
                        aria-describedby={fieldErrors.householdNumber ? 'my-profile-household-error' : undefined}
                        className={cn(inputClass, 'aria-[invalid=true]:border-destructive')}
                      />
                      <FieldError id="my-profile-household-error" message={fieldErrors.householdNumber} />
                    </div>

                    <div>
                      <label htmlFor="my-profile-emergency-number" className={fieldLabel}>
                        Emergency contact number
                      </label>
                      <input
                        id="my-profile-emergency-number"
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        placeholder="Optional"
                        value={form.emergencyNumber}
                        onChange={(event) => set('emergencyNumber', event.target.value)}
                        aria-invalid={Boolean(fieldErrors.emergencyNumber)}
                        aria-describedby={
                          fieldErrors.emergencyNumber ? 'my-profile-emergency-number-error' : undefined
                        }
                        className={cn(inputClass, 'aria-[invalid=true]:border-destructive')}
                      />
                      <FieldError id="my-profile-emergency-number-error" message={fieldErrors.emergencyNumber} />
                    </div>
                  </div>

                  <div className="mt-5 border-t border-slate-200/80 pt-4">
                    {patient.authProvider === 'google' ? (
                      <p className="rounded-lg bg-slate-50 px-3 py-2 text-[12px] leading-5 text-slate-500">
                        You sign in with Google, so this account has no password to change here.
                      </p>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => togglePassword(!passwordOpen)}
                          aria-expanded={passwordOpen}
                          className={`${secondaryButton} h-9 px-3.5 text-[13px]`}
                        >
                          <KeyRound size={15} aria-hidden />
                          {passwordOpen ? 'Cancel password change' : 'Change password'}
                        </button>
                        {passwordOpen && (
                          <div className="mt-3 grid gap-3.5 sm:grid-cols-3">
                            <div>
                              <label htmlFor="my-profile-current" className={fieldLabel}>
                                Current password
                              </label>
                              <input
                                id="my-profile-current"
                                type="password"
                                autoComplete="current-password"
                                value={password.currentPassword}
                                onChange={(event) => setPasswordField('currentPassword', event.target.value)}
                                aria-invalid={Boolean(passwordErrors.currentPassword)}
                                className={cn(inputClass, 'aria-[invalid=true]:border-destructive')}
                              />
                              {passwordErrors.currentPassword && (
                                <p className="mt-1 text-[11.5px] text-red-700">{passwordErrors.currentPassword}</p>
                              )}
                            </div>
                            <div>
                              <label htmlFor="my-profile-new" className={fieldLabel}>
                                New password
                              </label>
                              <input
                                id="my-profile-new"
                                type="password"
                                autoComplete="new-password"
                                value={password.newPassword}
                                onChange={(event) => setPasswordField('newPassword', event.target.value)}
                                aria-invalid={Boolean(passwordErrors.newPassword)}
                                className={cn(inputClass, 'aria-[invalid=true]:border-destructive')}
                              />
                              {passwordErrors.newPassword && (
                                <p className="mt-1 text-[11.5px] text-red-700">{passwordErrors.newPassword}</p>
                              )}
                            </div>
                            <div>
                              <label htmlFor="my-profile-confirm" className={fieldLabel}>
                                Confirm new password
                              </label>
                              <input
                                id="my-profile-confirm"
                                type="password"
                                autoComplete="new-password"
                                value={password.confirmPassword}
                                onChange={(event) => setPasswordField('confirmPassword', event.target.value)}
                                aria-invalid={Boolean(passwordErrors.confirmPassword)}
                                className={cn(inputClass, 'aria-[invalid=true]:border-destructive')}
                              />
                              {passwordErrors.confirmPassword && (
                                <p className="mt-1 text-[11.5px] text-red-700">{passwordErrors.confirmPassword}</p>
                              )}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  <div className="mt-5 flex flex-col gap-2.5 sm:flex-row sm:justify-end">
                    <button type="button" onClick={cancelEdit} className={secondaryButton} disabled={pending}>
                      Cancel
                    </button>
                    <button type="submit" disabled={pending || photoBusy} className={primaryButton}>
                      {pending && <LoaderCircle size={16} className="animate-spin" aria-hidden />}
                      {pending ? 'Saving…' : 'Save changes'}
                    </button>
                  </div>
                </motion.form>
              ) : (
                <motion.section
                  {...rise}
                  transition={{ ...riseTransition, delay: 0.04 }}
                  className={`${cardPadding} app-card lg:col-span-2`}
                  aria-labelledby="profile-details-heading"
                >
                  <h3
                    id="profile-details-heading"
                    className="font-display text-[16px] font-semibold tracking-[-0.01em] text-slate-900"
                  >
                    Personal details
                  </h3>
                  <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">
                    {details.map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-slate-500">
                          {label}
                        </dt>
                        <dd className="mt-0.5 leading-5 text-slate-800">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </motion.section>
              )}

              <motion.section
                {...rise}
                transition={{ ...riseTransition, delay: 0.08 }}
                className={panel}
                aria-labelledby="profile-account-heading"
              >
                <h3
                  id="profile-account-heading"
                  className="font-display text-[16px] font-semibold tracking-[-0.01em] text-slate-900"
                >
                  Account
                </h3>
                <dl className="mt-4 space-y-3 text-[13px]">
                  <div>
                    <dt className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-slate-500">Email</dt>
                    <dd className="mt-0.5 break-all text-slate-800">{patient.email}</dd>
                  </div>
                  <div>
                    <dt className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-slate-500">
                      Sign-in method
                    </dt>
                    <dd className="mt-0.5 text-slate-800">
                      {patient.authProvider === 'google' ? 'Google' : 'Email and password'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-slate-500">Role</dt>
                    <dd className="mt-0.5 text-slate-800">Patient</dd>
                  </div>
                </dl>
                <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-[11.5px] leading-5 text-slate-500">
                  Your email is read-only. Contact the health center if it needs to be updated.
                </p>
              </motion.section>
            </div>
          </motion.div>
        )}
      </DashboardShell>

      <AnimatePresence>
        {toast && <Toast key={`${toast.tone}-${toast.message}`} toast={toast} onDone={() => setToast(null)} />}
      </AnimatePresence>
    </>
  );
}

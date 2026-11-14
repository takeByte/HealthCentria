import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CircleCheck, Eye, EyeOff, LoaderCircle, MailCheck } from 'lucide-react';
import ReCAPTCHA from 'react-google-recaptcha';
import { PublicHeader } from '../components/public-header';
import { Button } from '../components/ui/button';
import {
  AuthError,
  clearSession,
  confirmEmailVerification,
  DuplicateEmailError,
  isValidEmail,
  isValidPassword,
  PASSWORD_ERROR_MESSAGE,
  registerPatient,
  requestEmailVerification,
  type RegisterData,
} from '../lib/auth';
import { cn } from '../lib/utils';
import { getPublicSettings } from '../lib/api';
import appLogo from '../assets/E-Kalinga_Logo.png';
import loginImage1 from '../assets/login-image1.jpg';
import loginImage2 from '../assets/login-image2.jpg';

export const Route = createFileRoute('/register')({
  component: RegisterComponent,
});

// Matches the login form so the two public auth screens stay visually identical.
const inputClass =
  'h-10 w-full rounded-xl border border-input bg-background px-3 text-base outline-none transition-colors placeholder:text-muted-foreground focus:border-[#1695de] focus:ring-2 focus:ring-[#1695de]/25 aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-destructive/20';

const labelClass = 'mb-1 block text-sm font-medium text-slate-800';

// Public by design. Hidden when apps/web/.env has no site key; the server then
// skips verification in development and fails closed in production.
// Fallback only: the active site key comes from the API, so a key an admin
// saves in Settings takes effect without rebuilding the web app.
const BUILD_SITE_KEY = (import.meta.env.VITE_RECAPTCHA_SITE_KEY as string | undefined) ?? '';

const SEX_OPTIONS = ['Female', 'Male', 'Other', 'Prefer not to say'] as const;

// The card keeps the same height on both steps so moving between them does
// not make the layout jump.
const stepClass = 'flex min-h-[31rem] flex-col gap-3';

interface FormState {
  firstName: string;
  lastName: string;
  birthdate: string;
  sex: string;
  address: string;
  contactNumber: string;
  email: string;
  password: string;
  confirmPassword: string;
  consent: boolean;
}

type Errors = Partial<Record<keyof FormState, string>>;

// Step 3 is the email check that runs right after the account is created.
type Step = 1 | 2 | 3;

// Step 1 owns everything except the account credentials and consent.
const STEP_ONE_FIELDS = [
  'firstName',
  'lastName',
  'birthdate',
  'sex',
  'address',
  'contactNumber',
] as const satisfies ReadonlyArray<keyof FormState>;

const emptyForm: FormState = {
  firstName: '',
  lastName: '',
  birthdate: '',
  sex: '',
  address: '',
  contactNumber: '',
  email: '',
  password: '',
  confirmPassword: '',
  consent: false,
};

function phoneOk(v: string): boolean {
  return /^[\d+][\d\s\-()]{6,}$/.test(v.trim());
}

function validate(f: FormState): Errors {
  const e: Errors = {};
  if (!f.firstName.trim()) e.firstName = 'Enter your first name.';
  if (!f.lastName.trim()) e.lastName = 'Enter your last name.';
  if (!f.birthdate) {
    e.birthdate = 'Enter your birthdate.';
  } else {
    const d = new Date(`${f.birthdate}T00:00:00`);
    if (Number.isNaN(d.getTime())) e.birthdate = 'Enter a valid date.';
    else if (d.getTime() > Date.now()) e.birthdate = 'Birthdate cannot be in the future.';
  }
  if (!f.sex) e.sex = 'Select an option.';
  if (!f.address.trim()) e.address = 'Enter your address.';
  if (!phoneOk(f.contactNumber)) e.contactNumber = 'Enter a valid contact number.';
  if (!isValidEmail(f.email)) e.email = 'Enter a valid email address.';
  if (!isValidPassword(f.password)) e.password = PASSWORD_ERROR_MESSAGE;
  if (!f.confirmPassword || f.confirmPassword !== f.password) e.confirmPassword = 'Passwords do not match.';
  if (!f.consent) e.consent = 'Consent is required to register.';
  return e;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 text-sm text-destructive">
      {message}
    </p>
  );
}

function RegisterComponent() {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<Errors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [recaptchaEnabled, setRecaptchaEnabled] = useState(true);
  const [siteKey, setSiteKey] = useState(BUILD_SITE_KEY);
  // Step 3: the code was already emailed during registration, so the user only
  // has to type it here (or resend if it never arrived).
  const [code, setCode] = useState('');
  const [verifyPending, setVerifyPending] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifyNotice, setVerifyNotice] = useState('');
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const recaptchaRef = useRef<ReCAPTCHA>(null);
  const headingRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setTimeout(() => setResendCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

  useEffect(() => {
    let cancelled = false;
    getPublicSettings()
      .then((settings) => {
        if (!cancelled) {
          setRecaptchaEnabled(settings.recaptchaEnabled);
          setSiteKey(settings.recaptchaSiteKey || BUILD_SITE_KEY);
        }
      })
      .catch(() => {
        // Keep the default-on behavior if the public settings endpoint is unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Move focus to the step title so keyboard and screen-reader users land at
  // the start of the new step instead of on a removed form.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  function goToStep(next: Step, dir: 1 | -1) {
    // Step 2's captcha widget unmounts when going back; drop the token so a
    // stale one can never be submitted from a fresh step 2.
    if (next === 1) setCaptchaToken(null);
    setDirection(dir);
    setStep(next);
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    if (key === 'password' && typeof value === 'string') {
      setErrors((prev) => ({
        ...prev,
        password: isValidPassword(value) ? undefined : PASSWORD_ERROR_MESSAGE,
      }));
    } else {
      setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
    }
    if (key === 'email') {
      setDuplicate(false);
      setSubmitError(null);
    }
  }

  // Step 1's Next button: only the personal details are checked here.
  function handleNext(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const all = validate(form);
    const stepOneErrors: Errors = {};
    for (const key of STEP_ONE_FIELDS) {
      if (all[key]) stepOneErrors[key] = all[key];
    }
    setErrors(stepOneErrors);
    if (Object.values(stepOneErrors).some(Boolean)) return;
    setSubmitError(null);
    goToStep(2, 1);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const errs = validate(form);
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) {
      // Defensive: if personal details somehow changed, send the user back.
      if (STEP_ONE_FIELDS.some((key) => errs[key])) goToStep(1, -1);
      return;
    }
    if (siteKey && recaptchaEnabled && !captchaToken) {
      setSubmitError('Please complete the CAPTCHA.');
      return;
    }
    setPending(true);
    setSubmitError(null);
    setDuplicate(false);

    // The API stores one display name, so the two inputs are joined here.
    const payload: RegisterData = {
      fullName: `${form.firstName.trim()} ${form.lastName.trim()}`.trim(),
      birthdate: form.birthdate,
      sex: form.sex,
      address: form.address.trim(),
      contactNumber: form.contactNumber.trim(),
      householdNumber: '',
      philHealthNumber: '',
      emergencyName: '',
      emergencyNumber: '',
      email: form.email.trim(),
      password: form.password,
      confirmPassword: form.confirmPassword,
      consent: form.consent,
      captchaToken: captchaToken ?? '',
    };

    try {
      const session = await registerPatient(payload);
      if (!session.token) {
        // No token means the API never answered, so no real account was created
        // and no verification email could be sent. Don't pretend it worked.
        clearSession();
        throw new AuthError(
          'We could not reach the server, so your account was not created. Check that the server is running, then try again.',
        );
      }
      // The account exists now; show the verification step before the
      // dashboard instead of sending the user straight there.
      setVerifyError(null);
      setVerifyNotice('');
      setResendCooldown(0);
      setCode('');
      setDirection(1);
      setStep(3);
    } catch (err) {
      if (err instanceof DuplicateEmailError) {
        setDuplicate(true);
      } else if (err instanceof AuthError) {
        setSubmitError(err.message);
      } else {
        setSubmitError('Registration failed. Check your connection and try again.');
      }
      // The token was consumed by the attempt; require a fresh challenge.
      recaptchaRef.current?.reset();
      setCaptchaToken(null);
    } finally {
      setPending(false);
    }
  }

  async function handleVerify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (verifyPending) return;
    const trimmed = code.trim();
    if (!/^\d{6}$/.test(trimmed)) {
      setVerifyError('Enter the 6-digit code from your email.');
      return;
    }
    setVerifyPending(true);
    setVerifyError(null);
    setVerifyNotice('');
    try {
      await confirmEmailVerification(trimmed);
      await navigate({ to: '/app/dashboard' });
    } catch (err) {
      setVerifyError(err instanceof AuthError ? err.message : 'That code is not valid. Try again.');
    } finally {
      setVerifyPending(false);
    }
  }

  async function handleResend() {
    if (resending || resendCooldown > 0) return;
    setResending(true);
    setVerifyError(null);
    setVerifyNotice('');
    try {
      const result = await requestEmailVerification();
      setVerifyNotice(result.message);
      setResendCooldown(result.resendAfter);
    } catch (err) {
      setVerifyError(err instanceof AuthError ? err.message : 'Could not send the code. Try again.');
    } finally {
      setResending(false);
    }
  }

  // Reduced motion: fade only, and quickly. Otherwise slide with the direction
  // of travel (left when advancing, right when going back).
  const stepInitial = reduceMotion ? { opacity: 0 } : { opacity: 0, x: direction * 16 };
  const stepExit = reduceMotion ? { opacity: 0 } : { opacity: 0, x: direction * -16 };
  const stepTransition = { duration: reduceMotion ? 0.12 : 0.18, ease: 'easeOut' as const };

  return (
    <div className="relative flex min-h-dvh flex-col bg-[#f3f8fd]">
      <PublicHeader />

      <main className="flex flex-1 flex-col p-2.5 sm:p-4">
        <div className="relative isolate flex flex-1 items-center justify-center overflow-hidden rounded-[26px] px-4 py-5 sm:px-6">
          {/* Same community photos, softening and tint as the login page. */}
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="grid h-full grid-cols-1 sm:grid-cols-2">
              <img src={loginImage2} alt="" className="h-full w-full object-cover opacity-45" />
              <img src={loginImage1} alt="" className="hidden h-full w-full object-cover opacity-45 sm:block" />
            </div>
            <div className="absolute inset-0 bg-[linear-gradient(100deg,rgba(197,232,255,0.75)_0%,rgba(240,250,255,0.9)_38%,rgba(255,255,255,0.92)_50%,rgba(240,250,255,0.9)_62%,rgba(198,236,224,0.75)_100%)]" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_52%_58%_at_50%_50%,rgba(255,255,255,0.88)_0%,rgba(255,255,255,0.4)_62%,rgba(255,255,255,0)_100%)]" />
          </div>

          <motion.section
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
            transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
            aria-labelledby="register-heading"
            className="relative z-10 my-2 w-full max-w-[470px] rounded-2xl border border-white/70 bg-white/95 p-5 shadow-[0_24px_70px_-28px_rgba(15,60,90,0.45)] backdrop-blur-md sm:p-6"
          >
            {/* Branding — identical to the login card. */}
            <div className="flex flex-col items-center text-center">
              <img
                src={appLogo}
                alt="HealthCentria logo"
                className="size-12 rounded-full border border-slate-200 bg-white object-cover"
              />
              <p className="mt-2 text-lg font-bold tracking-tight text-slate-900">HealthCentria</p>
              <p className="mt-0.5 text-xs font-medium text-slate-500">Brgy. 11 Health Center</p>
            </div>

            <div className="mt-4 text-center">
              <div ref={headingRef} tabIndex={-1} className="outline-none">
                <h1 id="register-heading" className="text-2xl font-bold tracking-tight text-slate-900">
                  {step === 3 ? 'Check your email' : 'Create an account'}
                </h1>
                <p className="mt-1.5 text-xs font-medium text-slate-500">
                  {step === 3 ? 'Last step' : `Step ${step} of 2`}
                </p>
              </div>
              <p className="mt-1 text-sm leading-5 text-slate-600">
                {step === 3
                  ? 'Enter the code we emailed you to finish setting up your account.'
                  : 'For patients only. Staff accounts are created by an admin.'}
              </p>
            </div>

            <div className="mt-4">
              <AnimatePresence mode="wait" initial={false}>
                {step === 1 ? (
                  <motion.form
                    key="step-1"
                    initial={stepInitial}
                    animate={{ opacity: 1, x: 0 }}
                    exit={stepExit}
                    transition={stepTransition}
                    onSubmit={handleNext}
                    noValidate
                    className={stepClass}
                  >
                    <div className="grid grid-cols-2 gap-3 max-[359px]:grid-cols-1">
                      <div>
                        <label htmlFor="reg-first-name" className={labelClass}>
                          First name
                        </label>
                        <input
                          id="reg-first-name"
                          autoComplete="given-name"
                          placeholder="Juan"
                          value={form.firstName}
                          onChange={(e) => set('firstName', e.target.value)}
                          aria-invalid={Boolean(errors.firstName)}
                          aria-describedby={errors.firstName ? 'reg-first-name-error' : undefined}
                          className={inputClass}
                        />
                        <FieldError id="reg-first-name-error" message={errors.firstName} />
                      </div>
                      <div>
                        <label htmlFor="reg-last-name" className={labelClass}>
                          Last name
                        </label>
                        <input
                          id="reg-last-name"
                          autoComplete="family-name"
                          placeholder="Dela Cruz"
                          value={form.lastName}
                          onChange={(e) => set('lastName', e.target.value)}
                          aria-invalid={Boolean(errors.lastName)}
                          aria-describedby={errors.lastName ? 'reg-last-name-error' : undefined}
                          className={inputClass}
                        />
                        <FieldError id="reg-last-name-error" message={errors.lastName} />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="reg-birthdate" className={labelClass}>
                        Birthdate
                      </label>
                      <input
                        id="reg-birthdate"
                        type="date"
                        autoComplete="bday"
                        max={new Date().toISOString().slice(0, 10)}
                        value={form.birthdate}
                        onChange={(e) => set('birthdate', e.target.value)}
                        aria-invalid={Boolean(errors.birthdate)}
                        aria-describedby={errors.birthdate ? 'reg-birthdate-error' : undefined}
                        className={inputClass}
                      />
                      <FieldError id="reg-birthdate-error" message={errors.birthdate} />
                    </div>

                    <fieldset>
                      <legend className={labelClass}>Sex</legend>
                      <div role="radiogroup" aria-label="Sex" className="grid grid-cols-2 gap-2">
                        {SEX_OPTIONS.map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            role="radio"
                            aria-checked={form.sex === opt}
                            onClick={() => set('sex', opt)}
                            className={cn(
                              'h-9 rounded-xl border px-2 text-sm font-medium transition-colors active:scale-[0.97]',
                              form.sex === opt
                                ? 'border-[#1695de] bg-[#eff6fd] text-[#1a448a]'
                                : 'border-input bg-background text-slate-700 hover:border-slate-300',
                            )}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                      <FieldError id="reg-sex-error" message={errors.sex} />
                    </fieldset>

                    <div>
                      <label htmlFor="reg-address" className={labelClass}>
                        Address
                      </label>
                      <input
                        id="reg-address"
                        autoComplete="street-address"
                        placeholder="Purok, Barangay, Municipality"
                        value={form.address}
                        onChange={(e) => set('address', e.target.value)}
                        aria-invalid={Boolean(errors.address)}
                        aria-describedby={errors.address ? 'reg-address-error' : undefined}
                        className={inputClass}
                      />
                      <FieldError id="reg-address-error" message={errors.address} />
                    </div>

                    <div>
                      <label htmlFor="reg-contact" className={labelClass}>
                        Contact number
                      </label>
                      <input
                        id="reg-contact"
                        type="tel"
                        autoComplete="tel"
                        placeholder="09xx xxx xxxx"
                        value={form.contactNumber}
                        onChange={(e) => set('contactNumber', e.target.value)}
                        aria-invalid={Boolean(errors.contactNumber)}
                        aria-describedby={errors.contactNumber ? 'reg-contact-error' : undefined}
                        className={inputClass}
                      />
                      <FieldError id="reg-contact-error" message={errors.contactNumber} />
                    </div>

                    <Button
                      type="submit"
                      className="h-10 w-full bg-gradient-to-r from-[#1695de] to-blue-600 text-base active:scale-[0.97]"
                    >
                      Next
                    </Button>

                    <div className="space-y-1.5 pt-1 text-center text-sm">
                      <p className="text-slate-600">
                        Already registered?{' '}
                        <Link to="/login" className="font-medium text-[#1f55a8] underline-offset-4 hover:underline">
                          Log in
                        </Link>
                      </p>
                      <p>
                        <Link to="/" className="text-slate-500 underline-offset-4 hover:underline">
                          ← Back to home
                        </Link>
                      </p>
                    </div>
                  </motion.form>
                ) : step === 2 ? (
                  <motion.form
                    key="step-2"
                    initial={stepInitial}
                    animate={{ opacity: 1, x: 0 }}
                    exit={stepExit}
                    transition={stepTransition}
                    onSubmit={handleSubmit}
                    noValidate
                    className={cn(stepClass, 'justify-center')}
                  >
                    <div>
                      <label htmlFor="reg-email" className={labelClass}>
                        Email
                      </label>
                      <input
                        id="reg-email"
                        type="email"
                        autoComplete="email"
                        placeholder="you@example.com"
                        value={form.email}
                        onChange={(e) => set('email', e.target.value)}
                        aria-invalid={Boolean(errors.email) || duplicate}
                        aria-describedby={errors.email ? 'reg-email-error' : undefined}
                        className={inputClass}
                      />
                      <FieldError id="reg-email-error" message={errors.email} />
                      {duplicate && (
                        <p role="alert" className="mt-1.5 text-sm text-destructive">
                          Email already registered.{' '}
                          <Link to="/login" className="font-medium underline underline-offset-4">
                            Log in?
                          </Link>
                        </p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="reg-password" className={labelClass}>
                        Password
                      </label>
                      <div className="relative">
                        <input
                          id="reg-password"
                          type={showPassword ? 'text' : 'password'}
                          autoComplete="new-password"
                          value={form.password}
                          onChange={(e) => set('password', e.target.value)}
                          aria-invalid={Boolean(errors.password)}
                          aria-describedby={errors.password ? 'reg-password-error' : undefined}
                          className={cn(inputClass, 'pr-11')}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                          aria-pressed={showPassword}
                          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-slate-500 transition-colors hover:text-slate-800"
                        >
                          {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                      <FieldError id="reg-password-error" message={errors.password} />
                    </div>

                    <div>
                      <label htmlFor="reg-confirm" className={labelClass}>
                        Confirm password
                      </label>
                      <input
                        id="reg-confirm"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        value={form.confirmPassword}
                        onChange={(e) => set('confirmPassword', e.target.value)}
                        aria-invalid={Boolean(errors.confirmPassword)}
                        aria-describedby={errors.confirmPassword ? 'reg-confirm-error' : undefined}
                        className={inputClass}
                      />
                      <FieldError id="reg-confirm-error" message={errors.confirmPassword} />
                    </div>

                    <div>
                      <label
                        htmlFor="reg-consent"
                        className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 p-3"
                      >
                        <input
                          id="reg-consent"
                          type="checkbox"
                          checked={form.consent}
                          onChange={(e) => set('consent', e.target.checked)}
                          aria-invalid={Boolean(errors.consent)}
                          aria-describedby={errors.consent ? 'reg-consent-error' : undefined}
                          className="mt-0.5 size-4 shrink-0 accent-[#1f55a8]"
                        />
                        <span className="text-xs leading-5 text-slate-700">
                          I agree to the collection and use of my personal and health information for this health
                          center's services.
                        </span>
                      </label>
                      <FieldError id="reg-consent-error" message={errors.consent} />
                    </div>

                    {siteKey && recaptchaEnabled && (
                      <div className="auth-captcha flex w-full justify-center">
                        <ReCAPTCHA
                          ref={recaptchaRef}
                          key={siteKey}
                          sitekey={siteKey}
                          onChange={(token) => setCaptchaToken(token)}
                          onExpired={() => setCaptchaToken(null)}
                          onErrored={() => setCaptchaToken(null)}
                        />
                      </div>
                    )}

                    {submitError && (
                      <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        {submitError}
                      </p>
                    )}

                    <div className="flex items-center gap-3 pt-1">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={pending}
                        onClick={() => goToStep(1, -1)}
                        className="h-10 shrink-0 rounded-xl border-slate-300 bg-white px-5 text-sm font-medium text-slate-700 hover:bg-slate-50 active:scale-[0.97]"
                      >
                        Back
                      </Button>
                      <Button
                        type="submit"
                        disabled={
                          pending ||
                          !form.consent ||
                          (Boolean(siteKey) && recaptchaEnabled && !captchaToken)
                        }
                        className="h-10 flex-1 bg-gradient-to-r from-[#1695de] to-blue-600 text-base active:scale-[0.97]"
                      >
                        {pending && <LoaderCircle size={18} className="animate-spin" aria-hidden />}
                        {pending ? 'Creating account…' : 'Create account'}
                      </Button>
                    </div>

                    <div className="space-y-1.5 pt-1 text-center text-sm">
                      <p className="text-slate-600">
                        Already registered?{' '}
                        <Link to="/login" className="font-medium text-[#1f55a8] underline-offset-4 hover:underline">
                          Log in
                        </Link>
                      </p>
                    </div>
                  </motion.form>
                ) : (
                  <motion.form
                    key="step-3"
                    initial={stepInitial}
                    animate={{ opacity: 1, x: 0 }}
                    exit={stepExit}
                    transition={stepTransition}
                    onSubmit={handleVerify}
                    noValidate
                    className={cn(stepClass, 'justify-center')}
                  >
                    <div className="flex items-start gap-2.5 rounded-xl border border-[#1695de]/20 bg-[#eff6fd]/80 px-3.5 py-3">
                      <MailCheck size={18} className="mt-0.5 shrink-0 text-[#1f55a8]" aria-hidden />
                      <p className="text-sm leading-6 text-[#0b2c4f]">
                        We sent a 6-digit code to{' '}
                        <span className="font-semibold break-all">{form.email.trim()}</span>. Enter it below to
                        verify your email. Check your spam folder if it has not arrived.
                      </p>
                    </div>

                    <div>
                      <label htmlFor="reg-code" className={labelClass}>
                        Verification code
                      </label>
                      <input
                        id="reg-code"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        value={code}
                        onChange={(e) => {
                          setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                          setVerifyError(null);
                        }}
                        placeholder="123456"
                        aria-invalid={Boolean(verifyError)}
                        aria-describedby={verifyError ? 'reg-code-error' : undefined}
                        className={cn(inputClass, 'text-center font-mono text-lg tracking-[0.35em]')}
                      />
                      {verifyError && (
                        <p id="reg-code-error" role="alert" className="mt-1.5 text-sm text-destructive">
                          {verifyError}
                        </p>
                      )}
                    </div>

                    {verifyNotice && !verifyError && (
                      <p
                        role="status"
                        aria-live="polite"
                        className="flex items-start gap-2 rounded-xl bg-[#eff6fd] px-3 py-2 text-sm text-[#0d47a1] ring-1 ring-inset ring-[#2196f3]/20"
                      >
                        <CircleCheck size={16} className="mt-0.5 shrink-0 text-[#0d47a1]" aria-hidden />
                        <span>{verifyNotice}</span>
                      </p>
                    )}

                    <Button
                      type="submit"
                      disabled={verifyPending || code.length !== 6}
                      className="h-10 w-full bg-gradient-to-r from-[#1695de] to-blue-600 text-base active:scale-[0.97]"
                    >
                      {verifyPending && <LoaderCircle size={18} className="animate-spin" aria-hidden />}
                      {verifyPending ? 'Verifying…' : 'Verify and continue'}
                    </Button>

                    <div className="flex items-center justify-between gap-3 text-sm">
                      <button
                        type="button"
                        onClick={handleResend}
                        disabled={resending || resendCooldown > 0}
                        className="font-medium text-[#1f55a8] underline-offset-4 hover:underline disabled:text-slate-400 disabled:no-underline"
                      >
                        {resending
                          ? 'Sending…'
                          : resendCooldown > 0
                            ? `${verifyNotice ? 'Code sent · ' : ''}Resend in ${resendCooldown}s`
                            : 'Resend code'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void navigate({ to: '/app/dashboard' })}
                        className="text-slate-500 underline-offset-4 hover:text-slate-700 hover:underline"
                      >
                        Skip for now
                      </button>
                    </div>

                    <p className="text-center text-xs leading-5 text-slate-500">
                      You can also verify later from the reminder on your dashboard.
                    </p>
                  </motion.form>
                )}
              </AnimatePresence>
            </div>
          </motion.section>
        </div>
      </main>
    </div>
  );
}

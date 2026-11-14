import { createFileRoute, Link } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowLeft, CheckCircle2, Eye, EyeOff, LoaderCircle, MailCheck } from 'lucide-react';
import ReCAPTCHA from 'react-google-recaptcha';
import { PublicHeader } from '../components/public-header';
import { Button } from '../components/ui/button';
import {
  AuthError,
  PASSWORD_ERROR_MESSAGE,
  isValidEmail,
  isValidPassword,
  requestPasswordReset,
  resetPasswordWithCode,
} from '../lib/auth';
import { getPublicSettings } from '../lib/api';
import { cn } from '../lib/utils';
import appLogo from '../assets/E-Kalinga_Logo.png';
import loginImage1 from '../assets/login-image1.jpg';
import loginImage2 from '../assets/login-image2.jpg';

export const Route = createFileRoute('/forgot-password')({
  component: ForgotPasswordComponent,
});

const inputClass =
  'h-10 w-full rounded-xl border border-input bg-background px-3 text-base outline-none transition-colors placeholder:text-muted-foreground focus:border-[#1695de] focus:ring-2 focus:ring-[#1695de]/25 aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-destructive/20';

// Fallback only: the active site key comes from the API, so a key an admin
// saves in Settings takes effect without rebuilding the web app.
const BUILD_SITE_KEY = (import.meta.env.VITE_RECAPTCHA_SITE_KEY as string | undefined) ?? '';

type Step = 'email' | 'code' | 'done';

function ForgotPasswordComponent() {
  const reduceMotion = useReducedMotion();
  const recaptchaRef = useRef<ReCAPTCHA>(null);

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const [touched, setTouched] = useState({ email: false });

  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [recaptchaEnabled, setRecaptchaEnabled] = useState(true);
  const [siteKey, setSiteKey] = useState(BUILD_SITE_KEY);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const emailInvalid = touched.email && email.length > 0 && !isValidEmail(email);
  const passwordInvalid = password.length > 0 && !isValidPassword(password);
  const mismatch = confirmPassword.length > 0 && confirmPassword !== password;
  const captchaRequired = Boolean(siteKey) && recaptchaEnabled && !captchaToken;

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
        // API unreachable: keep the widget visible; the server decides.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Resend countdown so the button matches the server's 60-second cooldown.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  function resetCaptcha() {
    recaptchaRef.current?.reset();
    setCaptchaToken(null);
  }

  function backToEmail() {
    setStep('email');
    setCode('');
    setPassword('');
    setConfirmPassword('');
    setError(null);
    setNotice('');
    setTouched({ email: false });
    setCooldown(0);
    resetCaptcha();
  }

  async function sendCode(event?: FormEvent) {
    event?.preventDefault();
    setError(null);
    if (!isValidEmail(email)) {
      setError('Enter a valid email address.');
      return;
    }
    if (captchaRequired) {
      setError('Please complete the CAPTCHA.');
      return;
    }
    setPending(true);
    try {
      const result = await requestPasswordReset({
        email,
        captchaToken: captchaToken ?? undefined,
      });
      setNotice(result.message);
      setStep('code');
      setCooldown(result.resendAfter);
      resetCaptcha();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Could not send the code. Try again.');
      resetCaptcha();
    } finally {
      setPending(false);
    }
  }

  async function submitNewPassword(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!/^\d{6}$/.test(code.trim())) {
      setError('Enter the 6-digit code from your email.');
      return;
    }
    if (!isValidPassword(password)) {
      setError(PASSWORD_ERROR_MESSAGE);
      return;
    }
    if (password !== confirmPassword) {
      setError('The two passwords do not match.');
      return;
    }

    setPending(true);
    try {
      const message = await resetPasswordWithCode({ email, code, password });
      setNotice(message);
      setStep('done');
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Could not reset your password. Try again.');
    } finally {
      setPending(false);
    }
  }

  const heading =
    step === 'email' ? 'Forgot password?' : step === 'code' ? 'Choose a new password' : "You're all set";
  const subheading =
    step === 'email'
      ? 'Enter the email on your patient account and we will send a 6-digit code.'
      : step === 'code'
        ? `Enter the code sent to ${email}. It expires in 10 minutes.`
        : 'Your password has been changed and every other device was signed out.';

  return (
    <div className="relative flex min-h-dvh flex-col bg-[#f3f8fd]">
      <PublicHeader />

      <main className="flex flex-1 flex-col p-2.5 sm:p-4">
        <div className="relative isolate flex flex-1 items-center justify-center overflow-hidden rounded-[26px] px-4 py-5 sm:px-6">
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
            aria-labelledby="forgot-password-heading"
            className="relative z-10 my-2 w-full max-w-[470px] rounded-2xl border border-white/70 bg-white/95 p-5 shadow-[0_24px_70px_-28px_rgba(15,60,90,0.45)] backdrop-blur-md sm:p-6"
          >
            <div className="flex flex-col items-center text-center">
              <img
                src={appLogo}
                alt="HealthCentria logo"
                className="size-12 rounded-full border border-slate-200 bg-white object-cover"
              />
              <p className="mt-2 text-lg font-bold tracking-tight text-slate-900">HealthCentria</p>
              <p className="mt-0.5 text-xs font-medium text-slate-500">Brgy. 11 Health Center</p>
            </div>

            <div className="mt-4 pt-6 text-center">
              <h1 id="forgot-password-heading" className="text-2xl font-bold tracking-tight text-slate-900">
                {heading}
              </h1>
              <p className="mt-1 text-sm leading-5 text-slate-600">{subheading}</p>
            </div>

            <div className="mt-4 pt-6">
              {step === 'email' && (
                <form onSubmit={sendCode} noValidate className="flex flex-col gap-4">
                  <div>
                    <label htmlFor="reset-email" className="mb-1 block text-sm font-medium text-slate-800">
                      Email
                    </label>
                    <input
                      id="reset-email"
                      type="email"
                      autoComplete="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                      aria-invalid={emailInvalid}
                      aria-describedby={emailInvalid ? 'reset-email-error' : undefined}
                      className={inputClass}
                    />
                    {emailInvalid && (
                      <p id="reset-email-error" role="alert" className="mt-1.5 text-sm text-destructive">
                        Enter a valid email address.
                      </p>
                    )}
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

                  {error && (
                    <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {error}
                    </p>
                  )}

                  <Button
                    type="submit"
                    disabled={pending || captchaRequired}
                    className="h-10 w-full bg-gradient-to-r from-[#1695de] to-blue-600 text-base active:scale-[0.97]"
                  >
                    {pending && <LoaderCircle size={18} className="animate-spin" aria-hidden />}
                    {pending ? 'Sending code…' : 'Send code'}
                  </Button>

                  <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-[12.5px] leading-5 text-slate-600">
                    Staff and admin accounts are reset by an administrator. Ask the clinic admin if you
                    cannot sign in.
                  </p>
                </form>
              )}

              {step === 'code' && (
                <form onSubmit={submitNewPassword} noValidate className="flex flex-col gap-4">
                  {notice && (
                    <p role="status" className="flex items-start gap-2 rounded-xl bg-[#1695de]/10 px-3 py-2.5 text-sm leading-5 text-[#123c78]">
                      <MailCheck size={17} className="mt-0.5 shrink-0" aria-hidden />
                      {notice}
                    </p>
                  )}

                  <div>
                    <label htmlFor="reset-code" className="mb-1 block text-sm font-medium text-slate-800">
                      6-digit code
                    </label>
                    <input
                      id="reset-code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder="123456"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      className={cn(inputClass, 'text-center font-mono text-lg tracking-[0.4em]')}
                    />
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={backToEmail}
                        className="inline-flex items-center gap-1 text-sm text-slate-600 underline-offset-4 hover:underline"
                      >
                        <ArrowLeft size={14} aria-hidden /> Change email
                      </button>
                      <button
                        type="button"
                        onClick={() => void sendCode()}
                        disabled={pending || cooldown > 0 || captchaRequired}
                        className="text-sm font-medium text-[#1f55a8] underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
                      >
                        {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="reset-password" className="mb-1 block text-sm font-medium text-slate-800">
                      New password
                    </label>
                    <div className="relative">
                      <input
                        id="reset-password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyUp={(e: KeyboardEvent<HTMLInputElement>) => {
                          setCapsOn(e.getModifierState ? e.getModifierState('CapsLock') : false);
                        }}
                        aria-invalid={passwordInvalid}
                        className={cn(inputClass, 'pr-11')}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((value) => !value)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        aria-pressed={showPassword}
                        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-slate-500 transition-colors hover:text-slate-800"
                      >
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                    <p className="mt-1.5 text-[12.5px] leading-5 text-slate-500">
                      At least 8 characters, including two of: letters, numbers, special characters.
                    </p>
                    {capsOn && password.length > 0 && (
                      <p className="mt-1.5 text-sm text-amber-700">Caps Lock is on.</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="reset-confirm" className="mb-1 block text-sm font-medium text-slate-800">
                      Confirm new password
                    </label>
                    <input
                      id="reset-confirm"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      aria-invalid={mismatch}
                      className={inputClass}
                    />
                    {mismatch && (
                      <p role="alert" className="mt-1.5 text-sm text-destructive">
                        The two passwords do not match.
                      </p>
                    )}
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

                  {error && (
                    <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {error}
                    </p>
                  )}

                  <Button
                    type="submit"
                    disabled={pending}
                    className="h-10 w-full bg-gradient-to-r from-[#1695de] to-blue-600 text-base active:scale-[0.97]"
                  >
                    {pending && <LoaderCircle size={18} className="animate-spin" aria-hidden />}
                    {pending ? 'Resetting…' : 'Reset password'}
                  </Button>
                </form>
              )}

              {step === 'done' && (
                <div className="flex flex-col items-center gap-4 text-center">
                  <CheckCircle2 size={40} className="text-[#1695de]" aria-hidden />
                  <p role="status" className="text-[13.5px] leading-6 text-slate-600">
                    {notice || 'Your password has been reset.'}
                  </p>
                  <Link
                    to="/login"
                    className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-gradient-to-r from-[#1695de] to-blue-600 text-base font-medium text-white transition-opacity hover:opacity-95 active:scale-[0.97]"
                  >
                    Back to log in
                  </Link>
                </div>
              )}
            </div>

            {step !== 'done' && (
              <div className="mt-4 space-y-1.5 pt-1 text-center text-sm">
                <p className="text-slate-600">
                  Remembered it?{' '}
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
            )}
          </motion.section>
        </div>
      </main>
    </div>
  );
}

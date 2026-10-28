import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { PublicHeader } from '../components/public-header';
import { GoogleIcon } from '../components/google-icon';
import { Button } from '../components/ui/button';
import { getSession, isValidEmail, login, resolvePostAuthPath, startGoogleLogin } from '../lib/auth';
import { getGoogleAuthConfig, getPublicSettings } from '../lib/api';
import { cn } from '../lib/utils';
import appLogo from '../assets/E-Kalinga_Logo.png';
import loginImage1 from '../assets/login-image1.jpg';
import loginImage2 from '../assets/login-image2.jpg';

export const Route = createFileRoute('/login')({
  component: LoginComponent,
});

const inputClass =
  'h-10 w-full rounded-xl border border-input bg-background px-3 text-base outline-none transition-colors placeholder:text-muted-foreground focus:border-teal-600 focus:ring-2 focus:ring-teal-600/25 aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-destructive/20';

function LoginComponent() {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const [email, setEmail] = useState(() => getSession()?.email ?? '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const [touched, setTouched] = useState({ email: false, password: false });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Hidden until the server confirms Google sign-in is on, so a disabled
  // provider never shows a button that would bounce the user through Google.
  const [googleEnabled, setGoogleEnabled] = useState(false);

  const emailInvalid = touched.email && !isValidEmail(email);
  const passwordInvalid = touched.password && password.length === 0;

  useEffect(() => {
    let cancelled = false;
    Promise.all([getPublicSettings(), getGoogleAuthConfig()])
      .then(([settings, config]) => {
        if (cancelled) return;
        // The client ID comes from the API at runtime — never a build-time constant.
        setGoogleEnabled(settings.googleSignInEnabled && Boolean(config.clientId));
      })
      .catch(() => {
        // API unreachable: leave the button hidden rather than offer a dead end.
        if (cancelled) return;
        setGoogleEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched({ email: true, password: true });
    setError(null);
    if (!isValidEmail(email) || password.length === 0) return;
    setPending(true);
    try {
      const session = await login({ email, password });
      await navigate({ to: resolvePostAuthPath(session) });
    } catch {
      // Generic message on purpose — do not reveal whether the email exists.
      setError('Invalid email or password.');
    } finally {
      setPending(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    setPending(true);
    try {
      // Re-read at click time so an admin's credential change applies without
      // requiring a page reload.
      const config = await getGoogleAuthConfig();
      if (!config.clientId) throw new Error('GOOGLE_NOT_CONFIGURED');
      // Full-page redirect: the API starts the Google consent flow and later
      // returns to /auth/callback with a session token.
      startGoogleLogin(config.clientId);
    } catch {
      setError('Google sign-in is not available right now. Log in with your email and password.');
      setPending(false);
    }
  }

  return (
    <div className="relative flex min-h-dvh flex-col bg-[#f3f8fd]">
      <PublicHeader />

      <main className="flex flex-1 flex-col p-2.5 sm:p-4">
        <div className="relative isolate flex flex-1 items-center justify-center overflow-hidden rounded-[26px] px-4 py-5 sm:px-6">
          {/* Community photos carry the page. They are softened and tinted so
              the login form stays the clear focus. */}
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="grid h-full grid-cols-1 sm:grid-cols-2">
              <img
                src={loginImage2}
                alt=""
                className="h-full w-full object-cover opacity-45"
              />
              <img
                src={loginImage1}
                alt=""
                className="hidden h-full w-full object-cover opacity-45 sm:block"
              />
            </div>
            <div className="absolute inset-0 bg-[linear-gradient(100deg,rgba(197,232,255,0.75)_0%,rgba(240,250,255,0.9)_38%,rgba(255,255,255,0.92)_50%,rgba(240,250,255,0.9)_62%,rgba(198,236,224,0.75)_100%)]" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_52%_58%_at_50%_50%,rgba(255,255,255,0.88)_0%,rgba(255,255,255,0.4)_62%,rgba(255,255,255,0)_100%)]" />
          </div>

          <motion.section
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
            transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
            aria-labelledby="login-heading"
            className="relative z-10 w-full max-w-[400px] rounded-2xl border border-white/70 bg-white/95 p-5 shadow-[0_24px_70px_-28px_rgba(15,60,90,0.45)] backdrop-blur-md sm:p-6"
          >
            {/* Branding */}
            <div className="flex flex-col items-center text-center">
              <img
                src={appLogo}
                alt="E-Kalinga logo"
                className="size-12 rounded-full border border-slate-200 bg-white object-cover"
              />
              <p className="mt-2 text-lg font-bold tracking-tight text-slate-900">HealthCentria</p>
              <p className="mt-0.5 text-xs font-medium text-slate-500">Brgy. 11 Health Center</p>
            </div>

            {/* Heading */}
            <div className="mt-4 text-center">
              <h1 id="login-heading" className="text-2xl font-bold tracking-tight text-slate-900">
                Log in
              </h1>
              <p className="mt-1 text-sm leading-5 text-slate-600">
                Staff and patients use their email and password.
              </p>
            </div>

            <form onSubmit={handleSubmit} noValidate className="mt-4 space-y-3">
              <div>
                <label htmlFor="login-email" className="mb-1 block text-sm font-medium text-slate-800">
                  Email
                </label>
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                  aria-invalid={emailInvalid}
                  aria-describedby={emailInvalid ? 'login-email-error' : undefined}
                  className={inputClass}
                />
                {emailInvalid && (
                  <p id="login-email-error" role="alert" className="mt-1.5 text-sm text-destructive">
                    Enter a valid email address.
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="login-password" className="mb-1 block text-sm font-medium text-slate-800">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                    onKeyUp={(e: KeyboardEvent<HTMLInputElement>) => {
                      setCapsOn(e.getModifierState ? e.getModifierState('CapsLock') : false);
                    }}
                    aria-invalid={passwordInvalid}
                    aria-describedby={passwordInvalid ? 'login-password-error' : undefined}
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
                {capsOn && password.length > 0 && (
                  <p className="mt-1.5 text-sm text-amber-700">Caps Lock is on.</p>
                )}
                {passwordInvalid && (
                  <p id="login-password-error" role="alert" className="mt-1.5 text-sm text-destructive">
                    Enter your password.
                  </p>
                )}
              </div>

              {error && (
                <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                disabled={pending}
                className="h-10 w-full bg-gradient-to-r from-teal-600 to-blue-600 text-base active:scale-[0.97]"
              >
                {pending && <LoaderCircle size={18} className="animate-spin" aria-hidden />}
                {pending ? 'Logging in…' : 'Log in'}
              </Button>
            </form>

            {googleEnabled && (
              <>
                <div className="my-3.5 flex items-center gap-3 text-xs font-medium uppercase tracking-wide text-slate-400">
                  <span className="h-px flex-1 bg-slate-200" />
                  or
                  <span className="h-px flex-1 bg-slate-200" />
                </div>

                <button
                  type="button"
                  onClick={handleGoogle}
                  disabled={pending}
                  className="flex h-10 w-full items-center justify-center gap-2.5 rounded-xl border border-slate-300 bg-white text-base font-medium text-slate-700 transition-colors hover:bg-slate-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <GoogleIcon className="size-5" />
                  Continue with Google
                </button>
              </>
            )}

            <div className="mt-4 space-y-1.5 text-center text-sm">
              <p className="text-slate-600">
                New patient?{' '}
                <Link to="/register" className="font-medium text-teal-700 underline-offset-4 hover:underline">
                  Create an account
                </Link>
              </p>
              <p>
                <button
                  type="button"
                  disabled
                  title="Ask the front desk for a password reset — self-service reset is not in v1"
                  className="cursor-not-allowed text-slate-400"
                >
                  Forgot password?
                </button>
              </p>
              <p>
                <Link to="/" className="text-slate-500 underline-offset-4 hover:underline">
                  ← Back to home
                </Link>
              </p>
            </div>
          </motion.section>
        </div>
      </main>
    </div>
  );
}

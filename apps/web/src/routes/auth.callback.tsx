import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { PublicHeader } from '../components/public-header';
import { completeGoogleLogin, resolvePostAuthPath } from '../lib/auth';

export const Route = createFileRoute('/auth/callback')({
  component: GoogleCallback,
});

const ERROR_MESSAGES: Record<string, string> = {
  google_denied: 'Google sign-in was cancelled.',
  google_not_configured: 'Google sign-in is not available right now.',
  google_config_changed: 'Google sign-in settings changed. Please try again.',
  google_invalid_request: 'That sign-in link is invalid or expired. Please try again.',
  google_invalid_state: 'That sign-in link is invalid or expired. Please try again.',
  google_exchange_failed: 'We could not verify your Google account. Please try again.',
  google_email_unverified: 'Your Google email address is not verified.',
  google_account_mismatch: 'This Google account is already linked to a different sign-in. Contact the front desk.',
  google_disabled: 'Google sign-in is currently disabled. Log in with your email and password, or contact the health center.',
  account_disabled: 'This account has been disabled. Contact the front desk.',
  db_unavailable: 'The service is temporarily unavailable. Try again shortly.',
};

function GoogleCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get('error');
    const token = params.get('token');

    if (oauthError || !token) {
      setError(ERROR_MESSAGES[oauthError ?? ''] ?? 'Sign-in failed. Please try again.');
      return;
    }

    let cancelled = false;
    completeGoogleLogin(token)
      .then((session) => {
        if (cancelled) return;
        // Drop the token from the URL so a refresh can't replay it.
        window.history.replaceState({}, '', '/auth/callback');
        return navigate({ to: resolvePostAuthPath(session), replace: true });
      })
      .catch(() => {
        if (!cancelled) setError('Could not complete sign-in. Please try again.');
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <>
      <PublicHeader />
      <div className="relative flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-10">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(135deg,#f0fdfa_0%,#eff6ff_55%,#f0fdf4_100%)]"
        />
        <section className="w-full max-w-[420px] rounded-2xl border border-slate-200/70 bg-white p-6 text-center shadow-[0_8px_30px_rgba(15,60,90,0.08)] sm:p-8">
          <p className="text-sm font-medium text-teal-700">HealthCentria</p>
          {error ? (
            <>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Sign-in failed</h1>
              <p role="alert" className="mt-3 rounded-xl bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                {error}
              </p>
              <Link
                to="/login"
                className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-xl bg-gradient-to-r from-teal-600 to-blue-600 text-base font-medium text-white active:scale-[0.97]"
              >
                Back to log in
              </Link>
            </>
          ) : (
            <>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Signing you in…</h1>
              <p className="mt-2 flex items-center justify-center gap-2 text-sm text-slate-600">
                <LoaderCircle size={18} className="animate-spin" aria-hidden />
                Verifying your Google account
              </p>
            </>
          )}
        </section>
      </div>
    </>
  );
}

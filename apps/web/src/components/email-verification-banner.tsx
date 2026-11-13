import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { LoaderCircle, Mail, MailCheck, X } from 'lucide-react';
import {
  AuthError,
  confirmEmailVerification,
  getSession,
  requestEmailVerification,
} from '../lib/auth';
import { cn } from '../lib/utils';

const primaryButton =
  'inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#0f766e] px-4 text-sm font-semibold text-white shadow-[0_6px_18px_-8px_rgba(17,94,89,0.45)] transition-transform active:scale-[0.97] disabled:opacity-60';
const secondaryButton =
  'inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 active:scale-[0.97] disabled:opacity-60';

/**
 * Reminder shown to self-registered patients whose email is not confirmed yet.
 * Verification is not a gate — the banner can be dismissed and the account
 * keeps working — but the code is only ever sent to the address on the account.
 */
export function EmailVerificationBanner() {
  const reduceMotion = useReducedMotion();
  const session = getSession();
  const eligible = session?.role === 'patient' && session.emailVerified === false;

  const [visible, setVisible] = useState(eligible);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [cooldown, setCooldown] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, pending]);

  if (!eligible || !visible) return null;

  async function resend() {
    if (resending || cooldown > 0) return;
    setResending(true);
    setError(null);
    setNotice('');
    try {
      const result = await requestEmailVerification();
      setNotice(result.message);
      setCooldown(result.resendAfter);
      if (result.message.toLowerCase().includes('already verified')) {
        setVisible(false);
        setOpen(false);
      }
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Could not send the code. Try again.');
    } finally {
      setResending(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Enter the 6-digit code from your email.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await confirmEmailVerification(code.trim());
      setVisible(false);
      setOpen(false);
      setCode('');
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'That code is not valid. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
        role="status"
        className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-amber-600/25 bg-amber-50/90 px-4 py-3 shadow-[0_8px_24px_-18px_rgba(146,64,14,0.5)]"
      >
        <div className="flex min-w-0 items-start gap-2.5">
          <Mail size={17} className="mt-0.5 shrink-0 text-amber-700" aria-hidden />
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold text-amber-950">Verify your email</p>
            <p className="mt-0.5 text-[12.5px] leading-5 text-amber-900">
              We sent a 6-digit code to{' '}
              <span className="font-medium break-all">{session?.email}</span>. Confirming it helps the clinic
              reach you about appointments. You can keep using your account meanwhile.
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={() => setOpen(true)} className={primaryButton}>
            <MailCheck size={16} aria-hidden />
            Enter code
          </button>
          <button
            type="button"
            onClick={resend}
            disabled={resending || cooldown > 0}
            className={secondaryButton}
          >
            {resending && <LoaderCircle size={16} className="animate-spin" aria-hidden />}
            {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend'}
          </button>
          <button
            type="button"
            aria-label="Dismiss email verification reminder"
            onClick={() => setVisible(false)}
            className="inline-flex size-9 items-center justify-center rounded-lg text-amber-800/70 transition-colors hover:bg-amber-100 hover:text-amber-900"
          >
            <X size={16} aria-hidden />
          </button>
        </div>
      </motion.div>

      <AnimatePresence>
        {open && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !pending) setOpen(false);
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ type: 'spring', bounce: 0, duration: 0.25 }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="verify-email-title"
              className="w-full max-w-md rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_24px_70px_-28px_rgba(15,60,90,0.45)] sm:p-6"
            >
              <h2
                id="verify-email-title"
                className="font-display text-lg font-semibold tracking-[-0.02em] text-slate-900"
              >
                Verify your email
              </h2>
              <p className="mt-2 text-[13.5px] leading-6 text-slate-600">
                Enter the 6-digit code we sent to{' '}
                <span className="font-medium break-all text-slate-800">{session?.email}</span>. The code expires
                after 30 minutes.
              </p>

              <form onSubmit={submit} className="mt-4 space-y-3">
                <div>
                  <label
                    htmlFor="verify-email-code"
                    className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-slate-500"
                  >
                    Verification code
                  </label>
                  <input
                    ref={inputRef}
                    id="verify-email-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    className={cn(
                      'h-11 w-full rounded-xl border border-input bg-background px-3 text-center font-mono text-lg tracking-[0.35em] outline-none transition-colors placeholder:tracking-[0.2em] placeholder:text-muted-foreground focus:border-[#0f766e] focus:ring-2 focus:ring-[#0f766e]/25',
                      error && 'border-destructive ring-2 ring-destructive/20',
                    )}
                    aria-invalid={error ? true : undefined}
                  />
                </div>

                {error && (
                  <p className="rounded-xl bg-red-50 px-3 py-2 text-[12.5px] leading-5 text-red-800 ring-1 ring-inset ring-red-600/20">
                    {error}
                  </p>
                )}
                {notice && !error && (
                  <p className="rounded-xl bg-[#e9f7f4] px-3 py-2 text-[12.5px] leading-5 text-[#134e4a] ring-1 ring-inset ring-[#0f766e]/20">
                    {notice}
                  </p>
                )}

                <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={resend}
                    disabled={resending || cooldown > 0}
                    className={secondaryButton}
                  >
                    {resending && <LoaderCircle size={16} className="animate-spin" aria-hidden />}
                    {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                  </button>
                  <button type="submit" disabled={pending} className={primaryButton}>
                    {pending ? (
                      <LoaderCircle size={16} className="animate-spin" aria-hidden />
                    ) : (
                      <MailCheck size={16} aria-hidden />
                    )}
                    {pending ? 'Verifying…' : 'Verify'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

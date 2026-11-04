import { useEffect, useRef, useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, Eye, EyeOff, LoaderCircle, X } from 'lucide-react';
import {
  AuthError,
  PASSWORD_ERROR_MESSAGE,
  changePassword,
  isValidPassword,
} from '../lib/auth';
import { cn } from '../lib/utils';

interface ChangePasswordDialogProps {
  open: boolean;
  /** False for Google-created accounts, which have no password to confirm yet. */
  hasPassword: boolean;
  onClose: () => void;
}

const inputClass =
  'h-10 w-full rounded-xl border border-input bg-background px-3 text-base outline-none transition-colors placeholder:text-muted-foreground focus:border-teal-600 focus:ring-2 focus:ring-teal-600/25 aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-destructive/20';

export function ChangePasswordDialog({ open, hasPassword, onClose }: ChangePasswordDialogProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const firstFieldRef = useRef<HTMLInputElement>(null);

  // Fresh form every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowPasswords(false);
    setPending(false);
    setError(null);
    setDone(false);
    const timer = window.setTimeout(() => firstFieldRef.current?.focus(), 40);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, pending, onClose]);

  if (!open) return null;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (hasPassword && currentPassword.length === 0) {
      setError('Enter your current password.');
      return;
    }
    if (!isValidPassword(newPassword)) {
      setError(PASSWORD_ERROR_MESSAGE);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The two new passwords do not match.');
      return;
    }

    setPending(true);
    try {
      await changePassword({
        currentPassword: hasPassword ? currentPassword : undefined,
        newPassword,
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Could not update your password. Try again.');
    } finally {
      setPending(false);
    }
  }

  const passwordInputType = showPasswords ? 'text' : 'password';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', bounce: 0, duration: 0.25 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-password-title"
        className="w-full max-w-md rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_24px_70px_-28px_rgba(15,60,90,0.45)] sm:p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2
              id="change-password-title"
              className="font-display text-lg font-semibold tracking-[-0.02em] text-slate-900"
            >
              {done ? 'Password updated' : 'Change password'}
            </h2>
            {!done && (
              <p className="mt-1 text-[13px] leading-5 text-slate-600">
                {hasPassword
                  ? 'Enter your current password, then choose a new one.'
                  : 'Your account signs in with Google. Set a password to sign in with email too.'}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label="Close"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
          >
            <X size={17} aria-hidden />
          </button>
        </div>

        {done ? (
          <div className="mt-5 flex flex-col items-center gap-3 text-center">
            <CheckCircle2 size={36} className="text-teal-600" aria-hidden />
            <p role="status" className="text-[13.5px] leading-6 text-slate-600">
              Your password has been changed. Other devices have been signed out; this one stays signed
              in.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-1 h-10 w-full rounded-xl bg-gradient-to-r from-teal-600 to-blue-600 text-base font-medium text-white transition-opacity hover:opacity-95 active:scale-[0.97]"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="mt-4 flex flex-col gap-4">
            {hasPassword && (
              <div>
                <label htmlFor="current-password" className="mb-1 block text-sm font-medium text-slate-800">
                  Current password
                </label>
                <input
                  ref={firstFieldRef}
                  id="current-password"
                  type={passwordInputType}
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  className={inputClass}
                />
              </div>
            )}

            <div>
              <label htmlFor="new-password" className="mb-1 block text-sm font-medium text-slate-800">
                New password
              </label>
              <div className="relative">
                <input
                  id="new-password"
                  type={passwordInputType}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  className={cn(inputClass, 'pr-11')}
                />
                <button
                  type="button"
                  onClick={() => setShowPasswords((value) => !value)}
                  aria-label={showPasswords ? 'Hide passwords' : 'Show passwords'}
                  aria-pressed={showPasswords}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-slate-500 transition-colors hover:text-slate-800"
                >
                  {showPasswords ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <p className="mt-1.5 text-[12px] leading-5 text-slate-500">
                At least 8 characters, including two of: letters, numbers, special characters.
              </p>
            </div>

            <div>
              <label htmlFor="confirm-new-password" className="mb-1 block text-sm font-medium text-slate-800">
                Confirm new password
              </label>
              <input
                id="confirm-new-password"
                type={passwordInputType}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                aria-invalid={confirmPassword.length > 0 && confirmPassword !== newPassword}
                className={inputClass}
              />
            </div>

            {error && (
              <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-[12px] leading-5 text-slate-600">
              Changing your password signs out every other device. You stay signed in here.
            </p>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className="inline-flex h-9 items-center justify-center rounded-lg px-3 text-[13px] font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-teal-600 to-blue-600 px-3.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-95 active:scale-[0.98] disabled:opacity-60"
              >
                {pending && <LoaderCircle size={16} className="animate-spin" aria-hidden />}
                {pending ? 'Saving…' : 'Update password'}
              </button>
            </div>
          </form>
        )}
      </motion.div>
    </div>
  );
}

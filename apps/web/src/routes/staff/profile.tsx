import { createFileRoute, redirect } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { useState, type FormEvent } from 'react';
import { KeyRound, LoaderCircle, Pencil, ShieldCheck, UserRound, X } from 'lucide-react';
import { DashboardShell } from '../../components/dashboard-shell';
import { opsNav } from '../../components/ops-nav';
import {
  CardHeading,
  StatusPill,
  fieldLabel,
  inputClass,
  panel,
  primaryButton,
  secondaryButton,
} from '../../components/app-ui';
import { Toast, type ToastMessage } from '../../components/toast';
import {
  getSession,
  isValidPassword,
  PASSWORD_ERROR_MESSAGE,
  setSession,
} from '../../lib/auth';
import { ApiError, changeMyPassword, updateMyAccount } from '../../lib/api';
import { PERMISSION_OPTIONS } from '../../lib/permissions';
import { getTodayService } from '../../lib/schedule';
import { cn } from '../../lib/utils';

export const Route = createFileRoute('/staff/profile')({
  beforeLoad: () => {
    const session = getSession();
    if (!session) throw redirect({ to: '/login' });
    if (session.role === 'patient') throw redirect({ to: '/app/profile' });
  },
  component: MyProfilePage,
});

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

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

function MyProfilePage() {
  const reduceMotion = useReducedMotion();
  const session = getSession();
  const today = getTodayService();
  const isAdmin = session?.role === 'admin';

  const [name, setName] = useState(session?.name ?? '');
  const [editingName, setEditingName] = useState(false);
  const [nameError, setNameError] = useState('');
  const [savingName, setSavingName] = useState(false);

  const [password, setPassword] = useState<PasswordForm>(EMPTY_PASSWORD_FORM);
  const [passwordErrors, setPasswordErrors] = useState<PasswordErrors>({});
  const [savingPassword, setSavingPassword] = useState(false);

  const [toast, setToast] = useState<ToastMessage | null>(null);

  const displayName = session?.name?.trim() || name.trim() || session?.email || '';
  const granted = session?.permissions ?? [];

  async function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = name.trim();
    if (!next) {
      setNameError('Enter your full name.');
      return;
    }
    setNameError('');
    setSavingName(true);
    try {
      const result = await updateMyAccount({ fullName: next });
      const current = getSession();
      if (current) {
        setSession({ ...current, name: result.user.name, permissions: result.user.permissions });
      }
      setName(result.user.name);
      setEditingName(false);
      setToast({ tone: 'success', message: 'Profile updated.' });
    } catch (err) {
      setToast({
        tone: 'error',
        message: err instanceof ApiError ? err.message : 'Could not save your profile. Try again.',
      });
    } finally {
      setSavingName(false);
    }
  }

  function setPasswordField(field: keyof PasswordForm, value: string) {
    setPassword((current) => ({ ...current, [field]: value }));
    setPasswordErrors((current) => ({ ...current, [field]: undefined }));
  }

  function validatePassword(form: PasswordForm): PasswordErrors {
    const errors: PasswordErrors = {};
    if (!form.currentPassword) errors.currentPassword = 'Enter your current password.';
    if (!form.newPassword) errors.newPassword = 'Enter a new password.';
    else if (!isValidPassword(form.newPassword)) errors.newPassword = PASSWORD_ERROR_MESSAGE;
    if (form.confirmPassword !== form.newPassword) errors.confirmPassword = 'Passwords do not match.';
    return errors;
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors = validatePassword(password);
    setPasswordErrors(errors);
    if (Object.values(errors).some(Boolean)) {
      setToast({ tone: 'error', message: 'Please fix the highlighted fields and try again.' });
      return;
    }
    setSavingPassword(true);
    try {
      await changeMyPassword({
        currentPassword: password.currentPassword,
        newPassword: password.newPassword,
      });
      setPassword(EMPTY_PASSWORD_FORM);
      setToast({ tone: 'success', message: 'Password changed.' });
    } catch (err) {
      if (err instanceof ApiError) {
        const fieldErrors = err.errors ?? {};
        setPasswordErrors({
          currentPassword: fieldErrors.currentPassword?.[0],
          newPassword: fieldErrors.newPassword?.[0],
        });
        setToast({ tone: 'error', message: err.message || 'Could not change your password.' });
      } else {
        setToast({ tone: 'error', message: 'Could not change your password. Try again.' });
      }
    } finally {
      setSavingPassword(false);
    }
  }

  const rise = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const riseTransition = { type: 'spring', bounce: 0, duration: 0.35 } as const;

  return (
    <DashboardShell
      title="My Profile"
      subtitle={isAdmin ? 'Your admin account details' : 'Your staff account details'}
      roleLabel={isAdmin ? 'Admin' : 'Staff'}
      userName={session?.name}
      userEmail={session?.email ?? ''}
      todayService={`${today.name} — ${today.detail}`}
      nav={opsNav(session?.role, session?.permissions)}
      notificationsTo="/staff/notifications"
      mainClassName="max-w-4xl"
    >
      <motion.section {...rise} transition={riseTransition} className={`${panel} overflow-hidden`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <span
              aria-hidden
              className="flex size-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-600 to-blue-600 text-[18px] font-bold text-white shadow-[0_2px_8px_rgba(15,60,90,0.18)]"
            >
              {initials(displayName) || <UserRound size={20} />}
            </span>
            <div className="min-w-0">
              <h2 className="truncate font-display text-[20px] font-semibold tracking-[-0.02em] text-slate-900">
                {displayName}
              </h2>
              <p className="mt-0.5 truncate text-[13px] text-slate-600">{session?.email}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <StatusPill tone={isAdmin ? 'sky' : 'teal'}>{isAdmin ? 'Admin' : 'Staff'}</StatusPill>
                {session?.authProvider === 'google' && <StatusPill tone="slate">Google account</StatusPill>}
              </div>
            </div>
          </div>
          {!editingName && (
            <button
              type="button"
              onClick={() => {
                setName(session?.name ?? '');
                setNameError('');
                setEditingName(true);
              }}
              className={`${secondaryButton} h-9 px-3.5 text-[13px]`}
            >
              <Pencil size={14} aria-hidden /> Edit name
            </button>
          )}
        </div>
      </motion.section>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <motion.section {...rise} transition={{ ...riseTransition, delay: 0.04 }} className={panel}>
          <CardHeading
            title="Account details"
            description="Your name appears on every action you record in the activity log."
          />

          {editingName ? (
            <form onSubmit={saveName} className="mt-4" noValidate>
              <label htmlFor="my-profile-name" className={fieldLabel}>
                Full name
              </label>
              <input
                id="my-profile-name"
                autoComplete="name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setNameError('');
                }}
                aria-invalid={Boolean(nameError)}
                aria-describedby={nameError ? 'my-profile-name-error' : undefined}
                className={cn(inputClass, 'aria-[invalid=true]:border-destructive')}
              />
              {nameError && (
                <p id="my-profile-name-error" className="mt-1 text-[11.5px] text-red-700">
                  {nameError}
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="submit" disabled={savingName} className={`${primaryButton} h-9 px-3.5 text-[13px]`}>
                  {savingName ? <LoaderCircle size={15} className="animate-spin" aria-hidden /> : null}
                  Save name
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingName(false);
                    setNameError('');
                    setName(session?.name ?? '');
                  }}
                  className={`${secondaryButton} h-9 px-3.5 text-[13px]`}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <dl className="mt-4 space-y-3">
              <div>
                <dt className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-slate-500">Full name</dt>
                <dd className="mt-0.5 text-[13.5px] text-slate-800">{displayName}</dd>
              </div>
              <div>
                <dt className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-slate-500">Email</dt>
                <dd className="mt-0.5 text-[13.5px] text-slate-800">{session?.email}</dd>
              </div>
              <div>
                <dt className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-slate-500">Role</dt>
                <dd className="mt-0.5 text-[13.5px] capitalize text-slate-800">{session?.role}</dd>
              </div>
            </dl>
          )}

          <p className="mt-4 text-[12px] leading-5 text-slate-500">
            Email, role, status and permissions are managed by an admin in Staff Accounts.
          </p>
        </motion.section>

        <motion.section {...rise} transition={{ ...riseTransition, delay: 0.08 }} className={panel}>
          <CardHeading
            title="Change password"
            description="Use at least 8 characters with two of: letters, numbers, special characters."
          />
          <form onSubmit={savePassword} className="mt-4 space-y-3.5" noValidate>
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
            <button type="submit" disabled={savingPassword} className={`${primaryButton} h-9 px-3.5 text-[13px]`}>
              {savingPassword ? (
                <LoaderCircle size={15} className="animate-spin" aria-hidden />
              ) : (
                <KeyRound size={15} aria-hidden />
              )}
              Change password
            </button>
          </form>
        </motion.section>
      </div>

      <motion.section {...rise} transition={{ ...riseTransition, delay: 0.12 }} className={panel}>
        <CardHeading
          title="What this account can do"
          description={
            isAdmin
              ? 'Admin accounts always have full access.'
              : 'Set by an admin. Ask them if you need another action.'
          }
        />
        {isAdmin ? (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-sky-600/20 bg-sky-50/70 px-3.5 py-3">
            <ShieldCheck size={17} aria-hidden className="shrink-0 text-sky-700" />
            <p className="text-[12.5px] text-sky-900">Full access to every action and screen.</p>
          </div>
        ) : granted.length === 0 ? (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-600/20 bg-amber-50/70 px-3.5 py-3">
            <X size={17} aria-hidden className="shrink-0 text-amber-700" />
            <p className="text-[12.5px] text-amber-900">
              No actions assigned yet. An admin can grant access in Staff Accounts.
            </p>
          </div>
        ) : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {PERMISSION_OPTIONS.filter((option) => granted.includes(option.key)).map((option) => (
              <li key={option.key} className="rounded-xl border border-slate-200/80 px-3.5 py-2.5">
                <p className="text-[12.5px] font-semibold text-slate-800">{option.label}</p>
                <p className="mt-0.5 text-[11.5px] leading-4 text-slate-500">{option.description}</p>
              </li>
            ))}
          </ul>
        )}
        {!isAdmin && granted.length > 0 && (
          <p className="mt-3 text-[11.5px] text-slate-500">
            Permissions apply to the menu and API immediately; sign in again to refresh the sidebar.
          </p>
        )}
      </motion.section>

      {toast && <Toast key={`${toast.tone}-${toast.message}`} toast={toast} onDone={() => setToast(null)} />}
    </DashboardShell>
  );
}

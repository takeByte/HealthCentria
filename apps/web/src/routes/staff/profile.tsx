import { createFileRoute, redirect } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Camera, KeyRound, LoaderCircle, Pencil, ShieldCheck, Trash2, UserRound, X } from 'lucide-react';
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
import { ApiError, changeMyPassword, getMyAccount, updateMyAccount } from '../../lib/api';
import { fileToAvatarDataUrl } from '../../lib/image';
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

const CONTACT_REGEX = /^[\d+][\d\s\-()]{6,}$/;

function MyProfilePage() {
  const reduceMotion = useReducedMotion();
  const session = getSession();
  const today = getTodayService();
  const isAdmin = session?.role === 'admin';
  const photoInput = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(session?.name ?? '');
  const [contact, setContact] = useState('');
  const [avatarUrl, setAvatarUrl] = useState(session?.avatarUrl ?? '');
  const [authProvider, setAuthProvider] = useState(session?.authProvider);
  const [editing, setEditing] = useState(false);

  const [nameError, setNameError] = useState('');
  const [contactError, setContactError] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  const [password, setPassword] = useState<PasswordForm>(EMPTY_PASSWORD_FORM);
  const [passwordErrors, setPasswordErrors] = useState<PasswordErrors>({});
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  // Snapshot of the saved values so Cancel can undo edits without a refetch.
  const [saved, setSaved] = useState({
    name: session?.name ?? '',
    contact: '',
    avatarUrl: session?.avatarUrl ?? '',
  });
  const displayName = saved.name || session?.email || '';
  const granted = session?.permissions ?? [];
  const canChangePassword = authProvider !== 'google';
  const passwordEntered = passwordOpen;

  // Read the account from the server so the form reflects saved values even
  // after a sign-in on another device.
  useEffect(() => {
    let cancelled = false;
    getMyAccount()
      .then(({ user }) => {
        if (cancelled) return;
        const next = {
          name: user.name,
          contact: user.contactNumber ?? '',
          avatarUrl: user.avatarUrl ?? '',
        };
        setName(next.name);
        setContact(next.contact);
        setAvatarUrl(next.avatarUrl);
        setAuthProvider(user.authProvider);
        setSaved(next);
      })
      .catch(() => {
        // Keep the session values as the fallback.
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = name.trim();
    const nextContact = contact.trim();
    if (!nextName) {
      setNameError('Enter your full name.');
      return;
    }
    if (nextContact && !CONTACT_REGEX.test(nextContact)) {
      setContactError('Enter a valid contact number.');
      return;
    }
    const passwordChecks = validatePassword(password);
    setPasswordErrors(passwordChecks);
    if (Object.values(passwordChecks).some(Boolean)) {
      setToast({ tone: 'error', message: 'Please fix the highlighted fields and try again.' });
      return;
    }

    setNameError('');
    setContactError('');
    setSaving(true);
    try {
      const result = await updateMyAccount({
        fullName: nextName,
        contactNumber: nextContact,
        avatarUrl,
      });
      if (passwordEntered) {
        await changeMyPassword({
          currentPassword: password.currentPassword,
          newPassword: password.newPassword,
        });
      }

      const next = {
        name: result.user.name,
        contact: result.user.contactNumber ?? '',
        avatarUrl: result.user.avatarUrl ?? '',
      };
      const current = getSession();
      if (current) {
        setSession({
          ...current,
          name: next.name,
          avatarUrl: next.avatarUrl,
          permissions: result.user.permissions,
        });
      }
      setName(next.name);
      setContact(next.contact);
      setAvatarUrl(next.avatarUrl);
      setSaved(next);
      setPassword(EMPTY_PASSWORD_FORM);
      setPasswordErrors({});
      setPasswordOpen(false);
      setEditing(false);
      setToast({
        tone: 'success',
        message: passwordEntered ? 'Profile and password updated.' : 'Profile updated.',
      });
    } catch (err) {
      if (err instanceof ApiError) {
        const errors = err.errors ?? {};
        if (errors.currentPassword || errors.newPassword) {
          setPasswordErrors({
            currentPassword: errors.currentPassword?.[0],
            newPassword: errors.newPassword?.[0],
          });
        }
        setToast({ tone: 'error', message: err.message || 'Could not save your profile. Try again.' });
      } else {
        setToast({ tone: 'error', message: 'Could not save your profile. Try again.' });
      }
    } finally {
      setSaving(false);
    }
  }

  function cancelEdit() {
    setName(saved.name);
    setContact(saved.contact);
    setAvatarUrl(saved.avatarUrl);
    setNameError('');
    setContactError('');
    setPassword(EMPTY_PASSWORD_FORM);
    setPasswordErrors({});
    setPasswordOpen(false);
    setEditing(false);
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
      userName={displayName}
      userEmail={session?.email ?? ''}
      todayService={`${today.name} — ${today.detail}`}
      nav={opsNav(session?.role, session?.permissions)}
      notificationsTo="/staff/notifications"
    >
      <motion.section {...rise} transition={riseTransition} className={`${panel} overflow-hidden`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <span
              aria-hidden
              className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-[#14b8a6] to-[#134e4a] text-[18px] font-bold text-white shadow-[0_2px_8px_rgba(15,60,90,0.18)]"
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="" referrerPolicy="no-referrer" className="size-full object-cover" />
              ) : (
                initials(displayName) || <UserRound size={20} />
              )}
            </span>
            <div className="min-w-0">
              <h2 className="truncate font-display text-[20px] font-semibold tracking-[-0.02em] text-slate-900">
                {displayName}
              </h2>
              <p className="mt-0.5 truncate text-[13px] text-slate-600">{session?.email}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <StatusPill tone={isAdmin ? 'sky' : 'teal'}>{isAdmin ? 'Admin' : 'Staff'}</StatusPill>
                {authProvider === 'google' && <StatusPill tone="slate">Google account</StatusPill>}
              </div>
            </div>
          </div>
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className={`${secondaryButton} h-9 px-3.5 text-[13px]`}
            >
              <Pencil size={14} aria-hidden /> Edit profile
            </button>
          )}
        </div>
      </motion.section>

      <motion.section {...rise} transition={{ ...riseTransition, delay: 0.04 }} className={panel}>
        <CardHeading
          title="Profile details"
          description="Your name appears on every action you record in the activity log."
        />

        {editing ? (
          <form onSubmit={saveProfile} className="mt-4 space-y-5" noValidate>
            <div className="flex flex-wrap items-center gap-4">
              <span
                aria-hidden
                className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-[#14b8a6] to-[#134e4a] text-[20px] font-bold text-white shadow-[0_2px_8px_rgba(15,60,90,0.18)]"
              >
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" referrerPolicy="no-referrer" className="size-full object-cover" />
                ) : (
                  initials(name) || <UserRound size={22} />
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

            <div className="grid gap-3.5 sm:grid-cols-2">
              <div className="sm:col-span-2">
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
                  placeholder="09XXXXXXXXX"
                  value={contact}
                  onChange={(event) => {
                    setContact(event.target.value);
                    setContactError('');
                  }}
                  aria-invalid={Boolean(contactError)}
                  aria-describedby={contactError ? 'my-profile-contact-error' : undefined}
                  className={cn(inputClass, 'aria-[invalid=true]:border-destructive')}
                />
                {contactError && (
                  <p id="my-profile-contact-error" className="mt-1 text-[11.5px] text-red-700">
                    {contactError}
                  </p>
                )}
              </div>
              <div>
                <span className={fieldLabel}>Email</span>
                <p className="mt-1 truncate rounded-lg bg-slate-50 px-3 py-2 text-[13px] text-slate-500">
                  {session?.email}
                </p>
              </div>
            </div>

            <div className="border-t border-slate-200/80 pt-4">
              {canChangePassword ? (
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
              ) : (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-[12px] leading-5 text-slate-500">
                  You sign in with Google, so this account has no password to change here.
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={saving || photoBusy} className={`${primaryButton} h-9 px-3.5 text-[13px]`}>
                {saving ? <LoaderCircle size={15} className="animate-spin" aria-hidden /> : null}
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                disabled={saving}
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
              <dt className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                Contact number
              </dt>
              <dd className="mt-0.5 text-[13.5px] text-slate-800">{saved.contact || '—'}</dd>
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

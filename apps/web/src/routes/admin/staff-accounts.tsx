import { createFileRoute } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Eye, EyeOff, LoaderCircle, Plus, Search, ShieldCheck, UserCheck, UserX, X } from 'lucide-react';
import { DashboardShell } from '../../components/dashboard-shell';
import { adminNav } from '../../components/ops-nav';
import {
  CardHeading,
  EmptyNote,
  InlineNotice,
  StatTile,
  StatusPill,
  dangerChipButton,
  fieldLabel,
  inputClass,
  panel,
  primaryButton,
  secondaryButton,
  selectClass,
} from '../../components/app-ui';
import { RecordMeta } from '../../components/record-meta';
import { getSession, isValidPassword, PASSWORD_ERROR_MESSAGE } from '../../lib/auth';
import {
  DEFAULT_STAFF_PERMISSIONS,
  PERMISSION_KEYS,
  PERMISSION_OPTIONS,
} from '../../lib/permissions';
import {
  ApiError,
  createStaffAccount,
  listStaffAccounts,
  updateStaffAccount,
  type StaffAccount,
} from '../../lib/api';
import { getTodayService } from '../../lib/schedule';
import { cn } from '../../lib/utils';

export const Route = createFileRoute('/admin/staff-accounts')({
  component: StaffAccounts,
});

function PermissionPicker({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  function toggle(key: string) {
    onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);
  }

  return (
    <fieldset
      aria-describedby={`${idPrefix}-hint`}
      className="rounded-xl border border-slate-200/80 p-3.5"
    >
      <legend className="px-1 text-[12.5px] font-semibold text-slate-700">Allowed actions</legend>
      <p id={`${idPrefix}-hint`} className="text-[11.5px] leading-4 text-slate-500">
        Set staff account permissions.
      </p>
      <div className="mt-1.5 flex gap-3">
        <button
          type="button"
          onClick={() => onChange([...PERMISSION_KEYS])}
          className="text-[11.5px] font-semibold text-teal-700 hover:underline"
        >
          Select all
        </button>
        <button
          type="button"
          onClick={() => onChange([])}
          className="text-[11.5px] font-semibold text-slate-500 hover:underline"
        >
          Clear
        </button>
      </div>
      <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
        {PERMISSION_OPTIONS.map((p) => {
          const checked = value.includes(p.key);
          return (
            <label
              key={p.key}
              className={cn(
                'flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition-colors',
                checked ? 'border-teal-600/30 bg-teal-600/5' : 'border-slate-200 bg-white',
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(p.key)}
                className="mt-0.5 size-4 shrink-0 accent-teal-600"
              />
              <span className="min-w-0">
                <span className="block text-[12.5px] font-semibold text-slate-800">{p.label}</span>
                <span className="block text-[11.5px] leading-4 text-slate-500">{p.description}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function StaffAccounts() {
  const reduceMotion = useReducedMotion();
  const session = getSession();
  const today = getTodayService();
  const [list, setList] = useState<StaffAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [cName, setCName] = useState('');
  const [cEmail, setCEmail] = useState('');
  const [cPassword, setCPassword] = useState('');
  const [cRole, setCRole] = useState<'staff' | 'admin'>('staff');
  const [cPermissions, setCPermissions] = useState<string[]>(DEFAULT_STAFF_PERMISSIONS);
  const [cShow, setCShow] = useState(false);
  const [cBusy, setCBusy] = useState(false);
  const [cError, setCError] = useState<string | null>(null);
  const [cPasswordError, setCPasswordError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [eName, setEName] = useState('');
  const [eRole, setERole] = useState<'staff' | 'admin'>('staff');
  const [ePermissions, setEPermissions] = useState<string[]>([]);
  const [ePassword, setEPassword] = useState('');
  const [eBusy, setEBusy] = useState(false);
  const [eError, setEError] = useState<string | null>(null);
  const [ePasswordError, setEPasswordError] = useState<string | null>(null);

  async function reload() {
    try {
      const r = await listStaffAccounts();
      setList(r.accounts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load accounts.');
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCError(null);
    if (!isValidPassword(cPassword)) {
      setCPasswordError(PASSWORD_ERROR_MESSAGE);
      return;
    }
    setCPasswordError(null);
    setCBusy(true);
    try {
      await createStaffAccount({
        fullName: cName.trim(),
        email: cEmail.trim().toLowerCase(),
        password: cPassword,
        role: cRole,
        permissions: cRole === 'admin' ? PERMISSION_KEYS : cPermissions,
      });
      setCName('');
      setCEmail('');
      setCPassword('');
      setCRole('staff');
      setCPermissions(DEFAULT_STAFF_PERMISSIONS);
      setShowCreate(false);
      await reload();
    } catch (err) {
      setCError(err instanceof ApiError ? err.message : 'Could not create account.');
    } finally {
      setCBusy(false);
    }
  }

  function startEdit(a: StaffAccount) {
    setEditingId(a.id);
    setEName(a.name);
    setERole(a.role);
    setEPermissions(a.permissions);
    setEPassword('');
    setEError(null);
    setEPasswordError(null);
  }

  async function handleUpdate(e: FormEvent, id: string) {
    e.preventDefault();
    setEError(null);
    if (ePassword && !isValidPassword(ePassword)) {
      setEPasswordError(PASSWORD_ERROR_MESSAGE);
      return;
    }
    setEPasswordError(null);
    setEBusy(true);
    try {
      await updateStaffAccount(id, {
        fullName: eName.trim(),
        role: eRole,
        permissions: eRole === 'admin' ? PERMISSION_KEYS : ePermissions,
        ...(ePassword ? { password: ePassword } : {}),
      });
      setEditingId(null);
      await reload();
    } catch (err) {
      setEError(err instanceof ApiError ? err.message : 'Could not update account.');
    } finally {
      setEBusy(false);
    }
  }

  async function toggleActive(a: StaffAccount) {
    setEError(null);
    try {
      await updateStaffAccount(a.id, { active: !a.active });
      await reload();
    } catch (err) {
      setEError(err instanceof ApiError ? err.message : 'Could not update account.');
    }
  }

  const filtered = useMemo(() => {
    if (!list) return null;
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((a) => a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q));
  }, [list, search]);

  const summary = useMemo(() => {
    const all = list ?? [];
    return {
      total: all.length,
      active: all.filter((a) => a.active).length,
      admins: all.filter((a) => a.role === 'admin').length,
    };
  }, [list]);

  const rise = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const riseTransition = { type: 'spring', bounce: 0, duration: 0.35 } as const;

  return (
    <DashboardShell
      title="Staff Accounts"
      subtitle="Who can sign in to the center's workspace"
      roleLabel="Admin"
      userName={session?.name}
      userEmail={session?.email ?? ''}
      todayService={`${today.name} — ${today.detail}`}
      nav={adminNav}
      notificationsTo="/staff/notifications"
      mainClassName="max-w-4xl"
    >
      <motion.div {...rise} transition={riseTransition} className="grid gap-3.5 sm:grid-cols-3">
        <StatTile icon={ShieldCheck} label="Accounts" value={list === null ? '—' : summary.total} hint="Staff + admins" />
        <StatTile
          icon={UserCheck}
          label="Active"
          value={list === null ? '—' : summary.active}
          hint="Can sign in now"
          tone="sky"
        />
        <StatTile
          icon={UserX}
          label="Admins"
          value={list === null ? '—' : summary.admins}
          hint="Full workspace access"
          tone="slate"
        />
      </motion.div>

      <motion.div
        {...rise}
        transition={{ ...riseTransition, delay: 0.04 }}
        className={`${panel} py-4`}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search
              size={16}
              aria-hidden
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or email…"
              aria-label="Search staff accounts"
              className={`${inputClass} pl-10`}
            />
          </div>
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className={showCreate ? `${secondaryButton} shrink-0` : `${primaryButton} shrink-0`}
          >
            {showCreate ? <X size={16} aria-hidden /> : <Plus size={16} aria-hidden />}
            {showCreate ? 'Close' : 'New account'}
          </button>
        </div>
      </motion.div>

      {error && <InlineNotice>{error}</InlineNotice>}

      {showCreate && (
        <motion.form
          {...rise}
          transition={riseTransition}
          onSubmit={handleCreate}
          className={`${panel} grid gap-4 sm:grid-cols-2`}
        >
          <div className="sm:col-span-2">
            <CardHeading
              title="New staff account"
              description="Choose what this account can do. Admins always have full access."
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="sa-name" className={fieldLabel}>Full name *</label>
            <input id="sa-name" value={cName} onChange={(e) => setCName(e.target.value)} placeholder="Nurse Joy" className={inputClass} />
          </div>
          <div>
            <label htmlFor="sa-email" className={fieldLabel}>Email *</label>
            <input id="sa-email" type="email" value={cEmail} onChange={(e) => setCEmail(e.target.value)} placeholder="staff@example.com" className={inputClass} />
          </div>
          <div>
            <label htmlFor="sa-role" className={fieldLabel}>Role *</label>
            <select id="sa-role" value={cRole} onChange={(e) => setCRole(e.target.value as 'staff' | 'admin')} className={selectClass}>
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          {cRole === 'staff' && (
            <div className="sm:col-span-2">
              <PermissionPicker
                idPrefix="sa-permissions"
                value={cPermissions}
                onChange={setCPermissions}
              />
            </div>
          )}
          <div className="sm:col-span-2">
            <label htmlFor="sa-password" className={fieldLabel}>Temporary password *</label>
            <div className="relative">
              <input
                id="sa-password"
                type={cShow ? 'text' : 'password'}
                autoComplete="new-password"
                value={cPassword}
                onChange={(e) => {
                  const value = e.target.value;
                  setCPassword(value);
                  if (cPasswordError) setCPasswordError(isValidPassword(value) ? null : PASSWORD_ERROR_MESSAGE);
                }}
                aria-invalid={Boolean(cPasswordError)}
                aria-describedby={cPasswordError ? 'sa-password-error' : undefined}
                className={cn(inputClass, 'pr-11')}
              />
              <button
                type="button"
                onClick={() => setCShow((v) => !v)}
                aria-label={cShow ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-slate-500 hover:text-slate-800"
              >
                {cShow ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {cPasswordError && <p id="sa-password-error" role="alert" className="mt-1.5 text-sm text-destructive">{cPasswordError}</p>}
            <p className="mt-1.5 text-xs text-slate-500">At least 8 characters and at least two of: letters, numbers, special characters.</p>
          </div>
          {cError && <InlineNotice className="sm:col-span-2">{cError}</InlineNotice>}
          <button type="submit" disabled={cBusy} className={`${primaryButton} sm:col-span-2`}>
            {cBusy && <LoaderCircle size={16} className="animate-spin" aria-hidden />}
            {cBusy ? 'Creating…' : 'Create account'}
          </button>
        </motion.form>
      )}

      {eError && <InlineNotice>{eError}</InlineNotice>}

      {list !== null && list.length === 0 && <EmptyNote>No staff accounts yet.</EmptyNote>}
      {filtered !== null && filtered.length === 0 && list !== null && list.length > 0 && (
        <EmptyNote>No account matches “{search.trim()}”.</EmptyNote>
      )}

      <motion.div {...rise} transition={{ ...riseTransition, delay: 0.08 }} className="grid gap-3.5">
        {(filtered ?? []).map((a) => (
          <article key={a.id} className={panel}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-display text-[14.5px] font-semibold tracking-[-0.01em] text-slate-900">
                  {a.name}
                </h3>
                <p className="mt-0.5 truncate text-[12.5px] text-slate-600">{a.email}</p>
                <RecordMeta createdAt={a.createdAt} updatedAt={a.updatedAt} className="mt-1" />
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <StatusPill tone={a.role === 'admin' ? 'sky' : 'teal'}>{a.role}</StatusPill>
                <StatusPill tone={a.active ? 'teal' : 'slate'}>{a.active ? 'Active' : 'Inactive'}</StatusPill>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {a.role === 'admin' ? (
                <span className="text-[11.5px] text-slate-500">Full access to every action.</span>
              ) : a.permissions.length === 0 ? (
                <span className="text-[11.5px] text-slate-500">No actions assigned yet.</span>
              ) : (
                PERMISSION_OPTIONS.filter((p) => a.permissions.includes(p.key)).map((p) => (
                  <StatusPill key={p.key} tone="slate">
                    {p.label}
                  </StatusPill>
                ))
              )}
            </div>
            {editingId === a.id ? (
              <form onSubmit={(e) => handleUpdate(e, a.id)} className="mt-4 grid gap-4 border-t border-slate-200/70 pt-4 sm:grid-cols-2">
                <div>
                  <label htmlFor={`edit-name-${a.id}`} className={fieldLabel}>Full name *</label>
                  <input id={`edit-name-${a.id}`} value={eName} onChange={(e) => setEName(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label htmlFor={`edit-role-${a.id}`} className={fieldLabel}>Role *</label>
                  <select id={`edit-role-${a.id}`} value={eRole} onChange={(e) => setERole(e.target.value as 'staff' | 'admin')} className={selectClass}>
                    <option value="staff">Staff</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                {eRole === 'staff' && (
                  <div className="sm:col-span-2">
                    <PermissionPicker
                      idPrefix={`edit-permissions-${a.id}`}
                      value={ePermissions}
                      onChange={setEPermissions}
                    />
                  </div>
                )}
                <div className="sm:col-span-2">
                  <label htmlFor={`edit-pw-${a.id}`} className={fieldLabel}>Reset password (leave blank to keep)</label>
                  <input
                    id={`edit-pw-${a.id}`}
                    type="password"
                    autoComplete="new-password"
                    value={ePassword}
                    onChange={(e) => {
                      const value = e.target.value;
                      setEPassword(value);
                      if (ePasswordError) setEPasswordError(value && !isValidPassword(value) ? PASSWORD_ERROR_MESSAGE : null);
                    }}
                    aria-invalid={Boolean(ePasswordError)}
                    aria-describedby={ePasswordError ? `edit-pw-error-${a.id}` : undefined}
                    placeholder="Leave blank to keep current password"
                    className={inputClass}
                  />
                  {ePasswordError && <p id={`edit-pw-error-${a.id}`} role="alert" className="mt-1.5 text-sm text-destructive">{ePasswordError}</p>}
                  <p className="mt-1.5 text-xs text-slate-500">If setting a password: at least 8 characters and at least two of letters, numbers, special characters.</p>
                </div>
                {eError && <InlineNotice className="sm:col-span-2">{eError}</InlineNotice>}
                <div className="flex gap-2 sm:col-span-2">
                  <button type="submit" disabled={eBusy} className={`${primaryButton} h-9 flex-1 px-3 text-[13px]`}>
                    {eBusy && <LoaderCircle size={14} className="animate-spin" aria-hidden />}
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className={`${secondaryButton} h-9 flex-1 px-3 text-[13px]`}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className="mt-3.5 flex gap-2">
                <button type="button" onClick={() => startEdit(a)} className={`${secondaryButton} h-9 px-3.5 text-[13px]`}>
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => toggleActive(a)}
                  className={cn(
                    a.active ? dangerChipButton : secondaryButton,
                    'h-9 px-3.5 text-[13px]',
                  )}
                >
                  {a.active ? 'Deactivate' : 'Reactivate'}
                </button>
              </div>
            )}
          </article>
        ))}
      </motion.div>
    </DashboardShell>
  );
}

import { createFileRoute, Link } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Search, UserCheck, UserX, Users } from 'lucide-react';
import { DashboardShell } from '../../components/dashboard-shell';
import { opsNav } from '../../components/ops-nav';
import {
  EmptyNote,
  InlineNotice,
  StatTile,
  StatusPill,
  inputClass,
  panel,
  primaryButton,
} from '../../components/app-ui';
import { getSession } from '../../lib/auth';
import { listPatients, type PatientSummary } from '../../lib/api';
import { getTodayService } from '../../lib/schedule';

export const Route = createFileRoute('/staff/patients')({
  component: PatientsList,
});

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

function PatientsList() {
  const reduceMotion = useReducedMotion();
  const session = getSession();
  const today = getTodayService();
  const [search, setSearch] = useState('');
  const [list, setList] = useState<PatientSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    const t = setTimeout(() => {
      listPatients(search)
        .then((r) => {
          if (!cancelled) setList(r.patients);
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setList([]);
            setError(err instanceof Error ? err.message : 'Could not load patients.');
          }
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [search]);

  const summary = useMemo(() => {
    const all = list ?? [];
    return {
      total: all.length,
      active: all.filter((p) => p.active).length,
      inactive: all.filter((p) => !p.active).length,
      contactable: all.filter((p) => p.contactNumber).length,
    };
  }, [list]);

  const rise = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const riseTransition = { type: 'spring', bounce: 0, duration: 0.35 } as const;

  return (
    <DashboardShell
      title="Patients"
      subtitle="Search the center's patient register"
      roleLabel={session?.role === 'admin' ? 'Admin' : 'Staff'}
      userName={session?.name}
      userEmail={session?.email ?? ''}
      todayService={`${today.name} — ${today.detail}`}
      nav={opsNav(session?.role)}
      notificationsTo="/staff/notifications"
    >
      <motion.div {...rise} transition={riseTransition} className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] leading-5 text-slate-600">
          {list === null
            ? 'Loading the register…'
            : `${summary.total} patient${summary.total === 1 ? '' : 's'} in this view · ${summary.active} active`}
        </p>
        <Link to="/staff/walk-in" className={`${primaryButton} h-10 px-4 text-[13px]`}>
          Register a walk-in
        </Link>
      </motion.div>

      <motion.div
        {...rise}
        transition={{ ...riseTransition, delay: 0.04 }}
        className="grid gap-3.5 sm:grid-cols-3"
      >
        <StatTile icon={Users} label="Patients" value={list === null ? '—' : summary.total} hint="In this view" />
        <StatTile
          icon={UserCheck}
          label="Active"
          value={list === null ? '—' : summary.active}
          hint="Can book and sign in"
          tone="sky"
        />
        <StatTile
          icon={UserX}
          label="Inactive"
          value={list === null ? '—' : summary.inactive}
          hint="Sign-in blocked"
          tone="slate"
        />
      </motion.div>

      <motion.div
        {...rise}
        transition={{ ...riseTransition, delay: 0.08 }}
        className={`${panel} py-4`}
      >
        <label htmlFor="patient-search" className="mb-1.5 block text-[12.5px] font-semibold text-slate-700">
          Search by name, email, contact, or household number
        </label>
        <div className="relative">
          <Search
            size={17}
            aria-hidden
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            id="patient-search"
            type="search"
            placeholder="e.g. Maria Bautista"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${inputClass} pl-10`}
          />
        </div>
      </motion.div>

      {error && <InlineNotice>{error}</InlineNotice>}
      {list === null && !error && <EmptyNote>Loading patients…</EmptyNote>}
      {list !== null && list.length === 0 && !error && (
        <EmptyNote>
          {search.trim() ? `No patient matches “${search.trim()}”.` : 'No patients registered yet.'}
        </EmptyNote>
      )}

      <motion.div
        {...rise}
        transition={{ ...riseTransition, delay: 0.12 }}
        className="grid gap-3.5 md:grid-cols-2"
      >
        {(list ?? []).map((p) => (
          <Link
            key={p.id}
            to="/staff/patients/$patientId"
            params={{ patientId: p.id }}
            className="app-card flex items-center gap-3.5 p-4 transition-colors hover:border-teal-600/30 hover:bg-white active:scale-[0.995]"
          >
            <span
              aria-hidden
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-900/[0.06] text-[13px] font-bold text-slate-700"
            >
              {initials(p.name) || <Users size={16} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate font-display text-[14.5px] font-semibold tracking-[-0.01em] text-slate-900">
                  {p.name}
                </span>
                {!p.active && <StatusPill tone="slate">Inactive</StatusPill>}
              </span>
              <span className="mt-0.5 block truncate text-[12.5px] text-slate-600">{p.email}</span>
              {(p.contactNumber || p.householdNumber) && (
                <span className="mt-0.5 block truncate text-[11.5px] text-slate-400">
                  {[p.contactNumber, p.householdNumber].filter(Boolean).join(' · ')}
                </span>
              )}
            </span>
            <ChevronRight size={17} aria-hidden className="shrink-0 text-slate-400" />
          </Link>
        ))}
      </motion.div>
    </DashboardShell>
  );
}

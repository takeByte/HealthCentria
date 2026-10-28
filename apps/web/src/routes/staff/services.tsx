import { createFileRoute } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CalendarDays, EyeOff, Layers, LoaderCircle, Plus, X } from 'lucide-react';
import { DashboardShell } from '../../components/dashboard-shell';
import { opsNav } from '../../components/ops-nav';
import {
  CardHeading,
  EmptyNote,
  InlineNotice,
  Segmented,
  StatTile,
  StatusPill,
  fieldLabel,
  inputClass,
  panel,
  primaryButton,
  secondaryButton,
  selectClass,
  textareaClass,
} from '../../components/app-ui';
import { getSession } from '../../lib/auth';
import {
  ApiError,
  createService,
  listServices,
  updateService,
  type Service,
  type ServiceSchedule,
} from '../../lib/api';
import { getTodayService } from '../../lib/schedule';
import { cn } from '../../lib/utils';

export const Route = createFileRoute('/staff/services')({
  component: ServicesManage,
});

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MODES = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'nth-weekday', label: 'Nth weekday of month' },
  { value: 'as-needed', label: 'As needed (staff confirms date)' },
] as const;

type Mode = (typeof MODES)[number]['value'];

function emptySchedule(): ServiceSchedule {
  return { mode: 'weekly', weekdays: [1] };
}

function ScheduleFields({
  schedule,
  set,
  prefix,
}: {
  schedule: ServiceSchedule;
  set: (s: ServiceSchedule) => void;
  prefix: string;
}) {
  return (
    <div className="grid gap-4">
      <div>
        <label htmlFor={`${prefix}-mode`} className={fieldLabel}>Schedule *</label>
        <select
          id={`${prefix}-mode`}
          value={schedule.mode}
          onChange={(e) => {
            const mode = e.target.value as Mode;
            set(mode === 'weekly' ? { mode, weekdays: [1] } : mode === 'nth-weekday' ? { mode, weekdays: [], nthWeek: 2, weekday: 3 } : { mode, weekdays: [] });
          }}
          className={selectClass}
        >
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>
      {schedule.mode === 'weekly' && (
        <fieldset>
          <legend className={fieldLabel}>Weekdays * (Sundays never bookable)</legend>
          <div className="flex flex-wrap gap-2">
            {[0, 1, 2, 3, 4, 5, 6].map((d) => {
              const on = (schedule.weekdays ?? []).includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    const cur = schedule.weekdays ?? [];
                    set({ ...schedule, weekdays: on ? cur.filter((x) => x !== d) : [...cur, d].sort() });
                  }}
                  className={cn(
                    'h-9 min-w-12 rounded-lg border px-3 text-[12.5px] font-semibold transition-colors active:scale-[0.97]',
                    on
                      ? 'border-teal-600/40 bg-teal-600/10 text-teal-900'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                  )}
                >
                  {DAY_NAMES[d]}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}
      {schedule.mode === 'nth-weekday' && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor={`${prefix}-nth`} className={fieldLabel}>Which occurrence *</label>
            <select
              id={`${prefix}-nth`}
              value={schedule.nthWeek ?? 2}
              onChange={(e) => set({ ...schedule, nthWeek: Number(e.target.value) })}
              className={selectClass}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>{n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${prefix}-weekday`} className={fieldLabel}>Weekday *</label>
            <select
              id={`${prefix}-weekday`}
              value={schedule.weekday ?? 3}
              onChange={(e) => set({ ...schedule, weekday: Number(e.target.value) })}
              className={selectClass}
            >
              {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                <option key={d} value={d}>{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d]}</option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

function ServicesManage() {
  const reduceMotion = useReducedMotion();
  const session = getSession();
  const today = getTodayService();
  const [list, setList] = useState<Service[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const [cName, setCName] = useState('');
  const [cDesc, setCDesc] = useState('');
  const [cSched, setCSched] = useState<ServiceSchedule>(emptySchedule);
  const [cBusy, setCBusy] = useState(false);
  const [cError, setCError] = useState<string | null>(null);

  const [eName, setEName] = useState('');
  const [eDesc, setEDesc] = useState('');
  const [eSched, setESched] = useState<ServiceSchedule>(emptySchedule);
  const [eActive, setEActive] = useState(true);
  const [eBusy, setEBusy] = useState(false);
  const [eError, setEError] = useState<string | null>(null);

  async function reload() {
    try {
      const r = await listServices();
      setList(r.services);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load services.');
    }
  }

  useEffect(() => {
    reload();
  }, []);

  function startEdit(s: Service) {
    setEditingId(s.id);
    setEName(s.name);
    setEDesc(s.description);
    setESched(s.schedule);
    setEActive(s.active);
    setEError(null);
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCError(null);
    setCBusy(true);
    try {
      await createService({ name: cName.trim(), description: cDesc.trim(), schedule: cSched });
      setCName('');
      setCDesc('');
      setCSched(emptySchedule());
      setShowCreate(false);
      await reload();
    } catch (err) {
      setCError(err instanceof ApiError ? err.message : 'Could not create service.');
    } finally {
      setCBusy(false);
    }
  }

  async function handleUpdate(e: FormEvent, id: string) {
    e.preventDefault();
    setEError(null);
    setEBusy(true);
    try {
      await updateService(id, { name: eName.trim(), description: eDesc.trim(), schedule: eSched, active: eActive });
      setEditingId(null);
      await reload();
    } catch (err) {
      setEError(err instanceof ApiError ? err.message : 'Could not update service.');
    } finally {
      setEBusy(false);
    }
  }

  const filtered = useMemo(() => {
    if (!list) return null;
    if (filter === 'active') return list.filter((s) => s.active);
    if (filter === 'inactive') return list.filter((s) => !s.active);
    return list;
  }, [list, filter]);

  const summary = useMemo(() => {
    const all = list ?? [];
    return { total: all.length, active: all.filter((s) => s.active).length, inactive: all.filter((s) => !s.active).length };
  }, [list]);

  const rise = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const riseTransition = { type: 'spring', bounce: 0, duration: 0.35 } as const;

  return (
    <DashboardShell
      title="Services"
      subtitle="What the center offers, and when"
      roleLabel={session?.role === 'admin' ? 'Admin' : 'Staff'}
      userName={session?.name}
      userEmail={session?.email ?? ''}
      todayService={`${today.name} — ${today.detail}`}
      nav={opsNav(session?.role)}
      notificationsTo="/staff/notifications"
    >
      <motion.div {...rise} transition={riseTransition} className="grid gap-3.5 sm:grid-cols-3">
        <StatTile
          icon={Layers}
          label="Services"
          value={list === null ? '—' : summary.total}
          hint="In the catalog"
        />
        <StatTile
          icon={CalendarDays}
          label="Active"
          value={list === null ? '—' : summary.active}
          hint="Visible for booking"
          tone="sky"
        />
        <StatTile
          icon={EyeOff}
          label="Inactive"
          value={list === null ? '—' : summary.inactive}
          hint="Hidden from patients"
          tone="slate"
        />
      </motion.div>

      <motion.div
        {...rise}
        transition={{ ...riseTransition, delay: 0.04 }}
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <Segmented
          ariaLabel="Filter services"
          value={filter}
          onChange={setFilter}
          options={[
            { key: 'all', label: 'All' },
            { key: 'active', label: 'Active' },
            { key: 'inactive', label: 'Inactive' },
          ]}
        />
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className={showCreate ? secondaryButton : primaryButton}
        >
          {showCreate ? <X size={16} aria-hidden /> : <Plus size={16} aria-hidden />}
          {showCreate ? 'Close' : 'New service'}
        </button>
      </motion.div>

      {error && <InlineNotice>{error}</InlineNotice>}

      {showCreate && (
        <form onSubmit={handleCreate} className={`${panel} grid gap-4`}>
          <CardHeading title="New service" description="Patients can book it the moment it is active." />
          <div>
            <label htmlFor="svc-name" className={fieldLabel}>Name *</label>
            <input id="svc-name" value={cName} onChange={(e) => setCName(e.target.value)} placeholder="e.g. Consultation" className={inputClass} />
          </div>
          <div>
            <label htmlFor="svc-desc" className={fieldLabel}>Description</label>
            <textarea id="svc-desc" rows={2} value={cDesc} onChange={(e) => setCDesc(e.target.value)} className={textareaClass} />
          </div>
          <ScheduleFields schedule={cSched} set={setCSched} prefix="svc-new" />
          {cError && <InlineNotice>{cError}</InlineNotice>}
          <button type="submit" disabled={cBusy} className={primaryButton}>
            {cBusy && <LoaderCircle size={16} className="animate-spin" aria-hidden />}
            {cBusy ? 'Creating…' : 'Create service'}
          </button>
        </form>
      )}

      {filtered === null && !error && <EmptyNote>Loading services…</EmptyNote>}
      {filtered !== null && filtered.length === 0 && (
        <EmptyNote>No services match this filter.</EmptyNote>
      )}

      <motion.div
        {...rise}
        transition={{ ...riseTransition, delay: 0.08 }}
        className="grid gap-3.5"
      >
        {(filtered ?? []).map((s) => (
          <article key={s.id} className={panel}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-display text-[15px] font-semibold tracking-[-0.01em] text-slate-900">{s.name}</h3>
                <p className="mt-1 inline-flex items-center rounded-full bg-teal-600/10 px-2.5 py-0.5 text-[11.5px] font-semibold text-teal-800">
                  {s.scheduleText}
                </p>
                {s.description && <p className="mt-2 text-[12.5px] leading-5 text-slate-600">{s.description}</p>}
              </div>
              <StatusPill tone={s.active ? 'teal' : 'slate'} className="shrink-0">
                {s.active ? 'Active' : 'Inactive'}
              </StatusPill>
            </div>
            {editingId === s.id ? (
              <form onSubmit={(e) => handleUpdate(e, s.id)} className="mt-4 grid gap-4 border-t border-slate-200/70 pt-4">
                <div>
                  <label htmlFor={`edit-name-${s.id}`} className={fieldLabel}>Name *</label>
                  <input id={`edit-name-${s.id}`} value={eName} onChange={(e) => setEName(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label htmlFor={`edit-desc-${s.id}`} className={fieldLabel}>Description</label>
                  <textarea id={`edit-desc-${s.id}`} rows={2} value={eDesc} onChange={(e) => setEDesc(e.target.value)} className={textareaClass} />
                </div>
                <ScheduleFields schedule={eSched} set={setESched} prefix={`edit-${s.id}`} />
                <label htmlFor={`edit-active-${s.id}`} className="flex cursor-pointer items-center gap-3 text-[13px] font-medium text-slate-700">
                  <input id={`edit-active-${s.id}`} type="checkbox" checked={eActive} onChange={(e) => setEActive(e.target.checked)} className="size-5 accent-teal-700" />
                  Active (visible for booking)
                </label>
                {eError && <InlineNotice>{eError}</InlineNotice>}
                <div className="flex gap-2">
                  <button type="submit" disabled={eBusy} className={`${primaryButton} flex-1`}>
                    {eBusy && <LoaderCircle size={16} className="animate-spin" aria-hidden />}
                    Save
                  </button>
                  <button type="button" onClick={() => setEditingId(null)} className={`${secondaryButton} flex-1`}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button type="button" onClick={() => startEdit(s)} className={`${secondaryButton} mt-3.5 h-9 px-3.5 text-[13px]`}>
                Edit
              </button>
            )}
          </article>
        ))}
      </motion.div>
    </DashboardShell>
  );
}

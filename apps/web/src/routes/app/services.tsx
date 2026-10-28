import { createFileRoute, Link } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronDown, LayoutGrid, Search } from 'lucide-react';
import { DashboardShell } from '../../components/dashboard-shell';
import { patientNav } from '../../components/patient-nav';
import { EmptyNote, InlineNotice, secondaryButton, cardPadding } from '../../components/app-ui';
import { getSession } from '../../lib/auth';
import { listServices, validDates, type Service } from '../../lib/api';
import { getTodayService } from '../../lib/schedule';
import { cn } from '../../lib/utils';

export const Route = createFileRoute('/app/services')({
  component: PatientServices,
});

const WEEK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
// JS getDay(): Sun=0..Sat=6 → index into WEEK_DAYS (Mon-first).
const dayLabel = (jsDay: number) => WEEK_DAYS[(jsDay + 6) % 7];

function serviceWeekdays(s: Service): number[] {
  if (s.schedule.mode === 'weekly') return [...s.schedule.weekdays].sort();
  if (s.schedule.mode === 'nth-weekday' && s.schedule.weekday != null) return [s.schedule.weekday];
  return [];
}

function formatDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', weekday: 'short' });
}

function ServiceCard({ service }: { service: Service }) {
  const [open, setOpen] = useState(false);
  const [dates, setDates] = useState<string[] | null>(null);
  const [datesError, setDatesError] = useState(false);

  useEffect(() => {
    if (!open || dates !== null) return;
    let cancelled = false;
    validDates(service.id)
      .then((r) => {
        if (!cancelled) setDates(r.dates);
      })
      .catch(() => {
        if (!cancelled) setDatesError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, dates, service.id]);

  return (
    <article className={cn('app-card overflow-hidden', cardPadding)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-[15.5px] font-semibold leading-snug tracking-[-0.01em] text-slate-900">
            {service.name}
          </h3>
          <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-teal-600/10 px-2.5 py-1 text-[11.5px] font-semibold text-teal-800">
            <CalendarDays size={12} aria-hidden />
            {service.scheduleText}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="-mr-1 flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 active:scale-[0.97]"
          aria-label={open ? `Hide details for ${service.name}` : `Show details for ${service.name}`}
        >
          <ChevronDown size={18} className={cn('transition-transform duration-200', open && 'rotate-180')} />
        </button>
      </div>

      {service.description && (
        <p className="mt-2.5 text-[13px] leading-6 text-slate-600">{service.description}</p>
      )}

      {open && (
        <div className="mt-3.5 border-t border-slate-200/70 pt-3.5">
          {datesError ? (
            <p role="alert" className="text-[13px] text-destructive">
              Couldn't load bookable dates. Check your connection and try again.
            </p>
          ) : dates === null ? (
            <p className="text-[13px] text-slate-500">Loading bookable dates…</p>
          ) : dates.length === 0 ? (
            <p className="text-[13px] text-slate-600">No bookable dates in the next 30 days.</p>
          ) : (
            <p className="text-[13px] leading-6 text-slate-600">
              <span className="font-semibold text-slate-800">Next available: </span>
              {dates.slice(0, 3).map(formatDay).join(' · ')}
            </p>
          )}
          <Link
            to="/app/appointments/new"
            search={{ service: service.id }}
            className={`${secondaryButton} mt-3 h-9 px-3.5 text-[13px]`}
          >
            Book this service
          </Link>
        </div>
      )}
    </article>
  );
}

function PatientServices() {
  const reduceMotion = useReducedMotion();
  const session = getSession();
  const today = getTodayService();
  const [services, setServices] = useState<Service[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'cards' | 'week'>('cards');

  useEffect(() => {
    let cancelled = false;
    listServices()
      .then((r) => {
        if (!cancelled) setServices(r.services);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load services.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!services) return null;
    const q = query.trim().toLowerCase();
    if (!q) return services;
    return services.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
    );
  }, [services, query]);

  const weekRows = useMemo(() => {
    if (!filtered) return [];
    // Order: Mon(1)..Sat(6), then as-needed group.
    const rows: Array<{ day: string; items: Service[] }> = [1, 2, 3, 4, 5, 6].map((d) => ({
      day: dayLabel(d),
      items: filtered.filter((s) => serviceWeekdays(s).includes(d)),
    }));
    const asNeeded = filtered.filter((s) => s.schedule.mode === 'as-needed');
    if (asNeeded.length > 0) rows.push({ day: 'As needed', items: asNeeded });
    return rows;
  }, [filtered]);

  return (
    <DashboardShell
      title="Services & Schedules"
      subtitle="What the center offers, and which day to come"
      roleLabel="Patient"
      userName={session?.name}
      userEmail={session?.email ?? ''}
      todayService={`${today.name} — ${today.detail}`}
      nav={patientNav}
      notificationsTo="/app/notifications"
    >
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
        className="flex flex-col gap-3 sm:flex-row sm:items-center"
      >
        <div className="relative flex-1">
          <Search
            size={17}
            aria-hidden
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search services…"
            aria-label="Search services"
            className="h-11 w-full rounded-xl border border-slate-200/80 bg-white/80 pl-10 pr-3 text-[14px] outline-none placeholder:text-slate-400 focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/25"
          />
        </div>
        <div role="group" aria-label="View" className="flex rounded-xl bg-slate-100/80 p-1">
          {(
            [
              { key: 'cards', label: 'Cards', icon: LayoutGrid },
              { key: 'week', label: 'Week', icon: CalendarDays },
            ] as const
          ).map((v) => {
            const Icon = v.icon;
            return (
              <button
                key={v.key}
                type="button"
                onClick={() => setView(v.key)}
                aria-pressed={view === v.key}
                className={cn(
                  'flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold transition-all duration-150 active:scale-[0.97] sm:flex-none',
                  view === v.key
                    ? 'bg-white text-slate-900 shadow-[0_1px_3px_rgba(15,60,90,0.12)]'
                    : 'text-slate-500 hover:text-slate-800',
                )}
              >
                <Icon size={15} aria-hidden />
                {v.label}
              </button>
            );
          })}
        </div>
      </motion.div>

      {error && <InlineNotice>{error}</InlineNotice>}
      {filtered === null && !error && <EmptyNote>Loading services…</EmptyNote>}
      {filtered !== null && filtered.length === 0 && (
        <EmptyNote>
          {services?.length === 0
            ? 'No services are available right now. Please check back later or ask the front desk.'
            : `No services match “${query}”.`}
        </EmptyNote>
      )}

      {view === 'cards' && filtered !== null && (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((s) => (
            <ServiceCard key={s.id} service={s} />
          ))}
        </div>
      )}

      {view === 'week' && filtered !== null && (
        <div className="space-y-3">
          {weekRows.map((row) => (
            <section key={row.day} aria-label={row.day} className={`app-card ${cardPadding} py-4`}>
              <h3 className="font-display text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">
                {row.day}
              </h3>
              {row.items.length === 0 ? (
                <p className="mt-1.5 text-[13px] text-slate-400">No service this day.</p>
              ) : (
                <ul className="mt-2.5 space-y-2.5">
                  {row.items.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[13.5px] font-semibold text-slate-900">{s.name}</p>
                        <p className="mt-0.5 text-[12px] text-teal-700">{s.scheduleText}</p>
                      </div>
                      <Link
                        to="/app/appointments/new"
                        search={{ service: s.id }}
                        className="shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-teal-700 transition-colors hover:bg-teal-600/10 active:scale-[0.97]"
                      >
                        Book
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </DashboardShell>
  );
}

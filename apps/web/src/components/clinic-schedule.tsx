import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { CardHeading, EmptyNote, InlineNotice, StatusChip, chipButton, panel } from './app-ui';
import { getCalendarLink, queueAppointments, type StaffAppointment } from '../lib/api';
import { getTodayService } from '../lib/schedule';
import { cn } from '../lib/utils';

/**
 * Month calendar of the clinic's appointments, built from the app's own data
 * (pending requests included, which Google Calendar never sees). Shared by the
 * admin and staff dashboards. "Open in Google Calendar" appears only when the
 * mirror is configured and switched on.
 */

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const SHOWN: StaffAppointment['status'][] = ['pending', 'confirmed', 'completed'];
const TIME_ORDER: Record<StaffAppointment['timePreference'], number> = { morning: 0, afternoon: 1, any: 2 };
const TIME_LABEL: Record<StaffAppointment['timePreference'], string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  any: 'Any time',
};

/** Short tag for a fixed service day; null for "as-needed" days. */
const SERVICE_TAG: Record<string, string> = {
  Consultation: 'Consult',
  Prenatal: 'Prenatal',
  'Family Planning': 'FP',
  'Routine Immunization (Newborn)': 'Immun.',
};

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fromYMD(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function patientName(a: StaffAppointment): string {
  return typeof a.patient === 'object' ? a.patient.name : 'Patient';
}

function serviceName(a: StaffAppointment): string {
  return typeof a.service === 'object' ? a.service.name : 'Service';
}

interface DayCounts {
  booked: number; // confirmed + completed
  pending: number;
}

export function ClinicSchedule({ className }: { className?: string }) {
  const todayYMD = toYMD(new Date());
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selected, setSelected] = useState(todayYMD);
  const [appointments, setAppointments] = useState<StaffAppointment[] | null>(null);
  const [error, setError] = useState(false);
  const [googleUrl, setGoogleUrl] = useState('');

  useEffect(() => {
    let cancelled = false;
    getCalendarLink()
      .then((r) => {
        if (!cancelled && r.available) setGoogleUrl(r.url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setAppointments(null);
    setError(false);
    const from = toYMD(month);
    const to = toYMD(new Date(month.getFullYear(), month.getMonth() + 1, 0));
    queueAppointments({ from, to })
      .then((r) => {
        if (!cancelled) setAppointments(r.appointments.filter((a) => SHOWN.includes(a.status)));
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [month]);

  const byDay = useMemo(() => {
    const map = new Map<string, StaffAppointment[]>();
    for (const a of appointments ?? []) {
      const list = map.get(a.day);
      if (list) list.push(a);
      else map.set(a.day, [a]);
    }
    return map;
  }, [appointments]);

  const counts = (ymd: string): DayCounts => {
    const list = byDay.get(ymd) ?? [];
    let pending = 0;
    for (const a of list) if (a.status === 'pending') pending += 1;
    return { booked: list.length - pending, pending };
  };

  const cells = useMemo(() => {
    const lead = month.getDay();
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const out: (Date | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= days; d += 1) out.push(new Date(month.getFullYear(), month.getMonth(), d));
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [month]);

  const shiftMonth = (delta: number) => {
    const next = new Date(month.getFullYear(), month.getMonth() + delta, 1);
    setMonth(next);
    // Keep the day list in sync with the visible month: today if it's there, else the 1st.
    const now = new Date();
    setSelected(
      next.getFullYear() === now.getFullYear() && next.getMonth() === now.getMonth() ? todayYMD : toYMD(next),
    );
  };

  const goToday = () => {
    const now = new Date();
    setMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelected(todayYMD);
  };

  const selectedDate = fromYMD(selected);
  const selectedService = getTodayService(selectedDate);
  const selectedIsServiceDay = selectedService.name in SERVICE_TAG;
  const dayList = [...(byDay.get(selected) ?? [])].sort(
    (a, b) =>
      TIME_ORDER[a.timePreference] - TIME_ORDER[b.timePreference] || patientName(a).localeCompare(patientName(b)),
  );
  const dayPending = dayList.filter((a) => a.status === 'pending').length;
  const monthLabel = month.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
  const isCurrentMonth = toYMD(month).slice(0, 7) === todayYMD.slice(0, 7);

  return (
    <section className={cn(panel, className)} aria-label="Clinic schedule">
      <CardHeading
        title="Clinic schedule"
        description="Confirmed visits and pending requests by day. Pick a date to see who is coming."
        action={
          googleUrl ? (
            <a href={googleUrl} target="_blank" rel="noreferrer" className={chipButton}>
              <span className="hidden sm:inline">Open in Google Calendar</span>
              <span className="sm:hidden">Google Calendar</span>
              <ExternalLink size={14} aria-hidden />
            </a>
          ) : undefined
        }
      />

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        {/* Month grid */}
        <div>
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                className="grid size-9 place-items-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100"
                aria-label="Previous month"
              >
                <ChevronLeft size={17} aria-hidden />
              </button>
              <p className="min-w-[9.5rem] text-center font-display text-[14.5px] font-semibold text-slate-900" aria-live="polite">
                {monthLabel}
              </p>
              <button
                type="button"
                onClick={() => shiftMonth(1)}
                className="grid size-9 place-items-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100"
                aria-label="Next month"
              >
                <ChevronRight size={17} aria-hidden />
              </button>
            </div>
            {(!isCurrentMonth || selected !== todayYMD) && (
              <button type="button" onClick={goToday} className={cn(chipButton, 'h-8 px-2.5 text-[12.5px]')}>
                Today
              </button>
            )}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((d) => (
              <div key={d} className="pb-1 text-center text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                {d}
              </div>
            ))}
            {cells.map((date, i) => {
              if (!date) return <div key={`blank-${i}`} aria-hidden />;
              const ymd = toYMD(date);
              const c = counts(ymd);
              const service = getTodayService(date);
              const tag = SERVICE_TAG[service.name];
              const isToday = ymd === todayYMD;
              const isSelected = ymd === selected;
              const total = c.booked + c.pending;
              const label = [
                date.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' }),
                tag ? `${service.name} day` : null,
                total === 0 ? 'no visits' : `${c.booked} confirmed, ${c.pending} pending`,
              ]
                .filter(Boolean)
                .join(', ');
              return (
                <button
                  key={ymd}
                  type="button"
                  onClick={() => setSelected(ymd)}
                  aria-pressed={isSelected}
                  aria-label={label}
                  title={tag ? service.name : undefined}
                  className={cn(
                    'flex h-14 flex-col items-stretch rounded-lg border px-1 py-1 text-left transition-colors sm:h-[4.25rem] sm:px-1.5',
                    isSelected
                      ? 'border-[var(--brand-deep)] bg-[var(--brand-tint)] ring-1 ring-[var(--brand-deep)]'
                      : tag
                        ? 'border-[var(--brand-deep)]/15 bg-[var(--brand-tint)]/40 hover:border-[var(--brand-deep)]/40'
                        : 'border-slate-200/70 bg-white/60 hover:border-slate-300',
                  )}
                >
                  <span className="flex items-center justify-between gap-1">
                    <span
                      className={cn(
                        'grid size-5 place-items-center rounded-full text-[12px] font-semibold tabular-nums',
                        isToday ? 'bg-[var(--brand-deep)] text-white' : 'text-slate-700',
                      )}
                    >
                      {date.getDate()}
                    </span>
                    {tag && (
                      <span className="hidden truncate text-[9.5px] font-semibold uppercase tracking-[0.04em] text-[var(--brand-deep)]/80 sm:inline">
                        {tag}
                      </span>
                    )}
                  </span>
                  <span className="mt-auto flex flex-wrap items-center gap-1">
                    {c.booked > 0 && (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/15 px-1.5 text-[10.5px] font-bold tabular-nums text-emerald-800">
                        {c.booked}
                      </span>
                    )}
                    {c.pending > 0 && (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/20 px-1.5 text-[10.5px] font-bold tabular-nums text-amber-800">
                        {c.pending}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-emerald-500/70" aria-hidden /> Confirmed / done
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-amber-500/80" aria-hidden /> Pending
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm border border-[var(--brand-deep)]/30 bg-[var(--brand-tint)]" aria-hidden /> Service day
            </span>
            <span className="w-full text-[11px] text-slate-400 sm:w-auto">
              Mon Consultation · Tue Prenatal · Thu Family Planning · 2nd Wed Immunization
            </span>
          </div>
        </div>

        {/* Selected day */}
        <div className="flex min-h-[16rem] flex-col rounded-xl border border-slate-200/70 bg-white/60 p-4">
          <div className="border-b border-slate-200/70 pb-3">
            <p className="font-display text-[14.5px] font-semibold text-slate-900">
              {selected === todayYMD ? 'Today · ' : ''}
              {selectedDate.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })}
            </p>
            <p className="mt-0.5 text-[12.5px] text-slate-500">
              {selectedIsServiceDay ? `${selectedService.name} day` : 'As-needed services only'}
            </p>
          </div>

          <div className="mt-3 flex-1">
            {error ? (
              <InlineNotice>Couldn't load the schedule right now.</InlineNotice>
            ) : appointments === null ? (
              <EmptyNote>Loading the schedule…</EmptyNote>
            ) : dayList.length === 0 ? (
              <EmptyNote>No visits booked for this day.</EmptyNote>
            ) : (
              <ul className="max-h-72 divide-y divide-slate-200/70 overflow-y-auto pr-1">
                {dayList.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-semibold text-slate-900">{patientName(a)}</p>
                      <p className="truncate text-[12px] text-slate-500">
                        {serviceName(a)} · {TIME_LABEL[a.timePreference]}
                      </p>
                    </div>
                    <StatusChip status={a.status} className="shrink-0" />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-3 border-t border-slate-200/70 pt-3">
            {dayList.length > 0 && (
              <p className="mb-2 text-[12px] text-slate-500">
                {dayList.length} visit{dayList.length === 1 ? '' : 's'}
                {dayPending > 0 ? ` · ${dayPending} pending` : ''}
              </p>
            )}
            <Link
              to="/staff/appointments"
              className="inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--brand-deep)] hover:underline hover:underline-offset-4"
            >
              {dayPending > 0 ? 'Review pending in Appointments' : 'Open Appointments'} <ArrowRight size={15} aria-hidden />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

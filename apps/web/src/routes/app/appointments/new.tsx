import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, Check, LoaderCircle } from 'lucide-react';
import { DashboardShell } from '../../../components/dashboard-shell';
import { patientNav } from '../../../components/patient-nav';
import { EmptyNote, InlineNotice, cardPadding, primaryButton, secondaryButton } from '../../../components/app-ui';
import { getSession, needsProfileCompletion, setSession } from '../../../lib/auth';
import { ApiError, bookAppointment, listServices, validDates, type Service } from '../../../lib/api';
import { getTodayService } from '../../../lib/schedule';
import { cn } from '../../../lib/utils';

export const Route = createFileRoute('/app/appointments/new')({
  validateSearch: (search: Record<string, unknown>) => ({
    service: typeof search.service === 'string' ? search.service : undefined,
  }),
  beforeLoad: () => {
    if (needsProfileCompletion(getSession())) {
      throw redirect({ to: '/app/profile/complete' });
    }
  },
  component: BookAppointment,
});

const STEPS = ['Service', 'Date & details', 'Review'] as const;

function toYMD(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function todayYMD(): string {
  const n = new Date();
  return toYMD(n.getFullYear(), n.getMonth() + 1, n.getDate());
}

function maxYMD(): string {
  const n = new Date();
  n.setDate(n.getDate() + 30);
  return toYMD(n.getFullYear(), n.getMonth() + 1, n.getDate());
}

function formatLong(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-PH', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function BookAppointment() {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const session = getSession();
  const today = getTodayService();
  const preselect = Route.useSearch().service;

  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [services, setServices] = useState<Service[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [serviceId, setServiceId] = useState<string | undefined>(preselect);
  const [dates, setDates] = useState<Set<string> | null>(null);
  const [datesError, setDatesError] = useState(false);
  const [monthCursor, setMonthCursor] = useState(() => {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() + 1 };
  });
  const [day, setDay] = useState<string | undefined>(undefined);
  const [timePreference, setTimePreference] = useState('any');
  const [notes, setNotes] = useState('');
  const [stepError, setStepError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<{ serviceName: string; day: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    listServices()
      .then((r) => {
        if (cancelled) return;
        setServices(r.services);
        if (preselect && !r.services.some((s) => s.id === preselect)) setServiceId(undefined);
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load services. Check your connection and try again.');
      });
    return () => {
      cancelled = true;
    };
  }, [preselect]);

  const service = useMemo(() => services?.find((s) => s.id === serviceId), [services, serviceId]);

  useEffect(() => {
    setDates(null);
    setDatesError(false);
    setDay(undefined);
    if (!serviceId) return;
    let cancelled = false;
    validDates(serviceId)
      .then((r) => {
        if (!cancelled) setDates(new Set(r.dates));
      })
      .catch(() => {
        if (!cancelled) setDatesError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [serviceId]);

  const maxDay = maxYMD();
  const minMonth = useMemo(() => {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() + 1 };
  }, []);
  const maxMonth = useMemo(() => {
    const [y, m] = maxDay.split('-').map(Number);
    return { y, m };
  }, [maxDay]);

  const cells = useMemo(() => {
    const { y, m } = monthCursor;
    const first = new Date(y, m - 1, 1);
    const lead = (first.getDay() + 6) % 7; // Mon-first offset
    const count = new Date(y, m, 0).getDate();
    const out: Array<{ ymd: string; label: number } | null> = [];
    for (let i = 0; i < lead; i += 1) out.push(null);
    for (let d = 1; d <= count; d += 1) out.push({ ymd: toYMD(y, m, d), label: d });
    return out;
  }, [monthCursor]);

  const canPrev = monthCursor.y > minMonth.y || (monthCursor.y === minMonth.y && monthCursor.m > minMonth.m);
  const canNext = monthCursor.y < maxMonth.y || (monthCursor.y === maxMonth.y && monthCursor.m < maxMonth.m);

  function moveMonth(delta: -1 | 1) {
    setMonthCursor((c) => {
      let { y, m } = c;
      m += delta;
      if (m < 1) {
        m = 12;
        y -= 1;
      }
      if (m > 12) {
        m = 1;
        y += 1;
      }
      return { y, m };
    });
  }

  function next() {
    setStepError(null);
    if (step === 0 && !service) {
      setStepError('Choose a service to continue.');
      return;
    }
    if (step === 1 && !day) {
      setStepError('Pick a highlighted date to continue.');
      return;
    }
    setDirection(1);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function back() {
    setStepError(null);
    setDirection(-1);
    setStep((s) => Math.max(s - 1, 0));
  }

  async function submit() {
    if (!service || !day) return;
    setPending(true);
    setStepError(null);
    try {
      await bookAppointment({ serviceId: service.id, day, timePreference, notes: notes.trim() });
      setDone({ serviceName: service.name, day });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PROFILE_INCOMPLETE') {
        const current = getSession();
        if (current) setSession({ ...current, profileCompleted: false });
        await navigate({ to: '/app/profile/complete' });
        return;
      }
      setStepError(err instanceof ApiError ? err.message : 'Booking failed. Try again.');
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <DashboardShell
        title="Book Appointment"
        subtitle="Request received"
        roleLabel="Patient"
        userName={session?.name}
        userEmail={session?.email ?? ''}
        todayService={`${today.name} — ${today.detail}`}
        nav={patientNav}
        notificationsTo="/app/notifications"
      >
        <section
          aria-labelledby="booked-heading"
          className={`app-card mx-auto max-w-xl px-6 py-10 text-center`}
        >
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-teal-600/10 text-teal-700">
            <Check size={24} aria-hidden />
          </span>
          <h2
            id="booked-heading"
            className="mt-4 font-display text-[20px] font-semibold leading-tight tracking-[-0.02em] text-slate-900"
          >
            Request sent — pending confirmation
          </h2>
          <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-6 text-slate-600">
            {done.serviceName} on {formatLong(done.day)}. The center will confirm or decline it, and you'll be
            notified by bell and email.
          </p>
          <div className="mt-6 flex flex-col justify-center gap-2.5 sm:flex-row">
            <Link to="/app/appointments" className={primaryButton}>
              View my appointments
            </Link>
            <Link to="/app/dashboard" className={secondaryButton}>
              Back to dashboard
            </Link>
          </div>
        </section>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      title="Book Appointment"
      subtitle="Three quick steps — the center confirms after"
      roleLabel="Patient"
      userName={session?.name}
      userEmail={session?.email ?? ''}
      todayService={`${today.name} — ${today.detail}`}
      nav={patientNav}
      notificationsTo="/app/notifications"
      mainClassName="max-w-2xl"
    >
      <ol aria-label="Booking progress" className="flex items-center gap-2">
        {STEPS.map((label, i) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              aria-current={i === step ? 'step' : undefined}
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-colors',
                i < step && 'bg-teal-700 text-white',
                i === step && 'bg-slate-900 text-white',
                i > step && 'bg-slate-200/80 text-slate-500',
              )}
            >
              {i < step ? <Check size={13} aria-hidden /> : i + 1}
            </span>
            <span
              className={cn(
                'hidden text-[12.5px] sm:block',
                i === step ? 'font-semibold text-slate-900' : 'font-medium text-slate-500',
              )}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && <span aria-hidden className="h-px flex-1 bg-slate-300/60" />}
          </li>
        ))}
      </ol>

      {loadError && <InlineNotice>{loadError}</InlineNotice>}

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 20 * direction }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, x: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -20 * direction }}
          transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
          className={`app-card ${cardPadding}`}
        >
          {step === 0 && (
            <div role="radiogroup" aria-label="Choose a service" className="grid gap-2.5 sm:grid-cols-2">
              {services === null && !loadError && <EmptyNote>Loading services…</EmptyNote>}
              {services?.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={serviceId === s.id}
                  onClick={() => {
                    setServiceId(s.id);
                    setStepError(null);
                  }}
                  className={cn(
                    'rounded-xl border p-3.5 text-left transition-all active:scale-[0.99]',
                    serviceId === s.id
                      ? 'border-teal-600/50 bg-teal-600/[0.06] ring-1 ring-teal-600/25'
                      : 'border-slate-200/80 bg-white/60 hover:border-slate-300 hover:bg-white',
                  )}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="text-[14px] font-semibold text-slate-900">{s.name}</span>
                    {serviceId === s.id && <Check size={16} className="shrink-0 text-teal-700" aria-hidden />}
                  </span>
                  <span className="mt-0.5 block text-[12.5px] font-medium text-teal-700">{s.scheduleText}</span>
                  {s.description && (
                    <span className="mt-1 block text-[12.5px] leading-5 text-slate-600">{s.description}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {step === 1 && service && (
            <div>
              <p className="text-[13px] leading-5 text-slate-600">
                <span className="font-semibold text-slate-900">{service.name}</span> — {service.scheduleText}.
                Only highlighted dates can be booked.
              </p>
              {datesError ? (
                <p role="alert" className="mt-3 text-[13px] text-destructive">
                  Couldn't load bookable dates. Check your connection and try again.
                </p>
              ) : dates === null ? (
                <EmptyNote className="mt-3">Loading calendar…</EmptyNote>
              ) : (
                <>
                  <div className="mt-4 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => moveMonth(-1)}
                      disabled={!canPrev}
                      aria-label="Previous month"
                      className="flex size-9 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-30 active:scale-[0.97]"
                    >
                      <ArrowLeft size={17} />
                    </button>
                    <h3 className="font-display text-[13.5px] font-semibold text-slate-900" aria-live="polite">
                      {new Date(monthCursor.y, monthCursor.m - 1, 1).toLocaleDateString('en-PH', {
                        month: 'long',
                        year: 'numeric',
                      })}
                    </h3>
                    <button
                      type="button"
                      onClick={() => moveMonth(1)}
                      disabled={!canNext}
                      aria-label="Next month"
                      className="flex size-9 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-30 active:scale-[0.97]"
                    >
                      <ArrowRight size={17} />
                    </button>
                  </div>
                  <div role="grid" aria-label="Pick a date" className="mt-3 grid grid-cols-7 gap-1">
                    {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                      <span
                        key={i}
                        className="pb-1 text-center text-[10.5px] font-bold uppercase tracking-[0.06em] text-slate-400"
                      >
                        {d}
                      </span>
                    ))}
                    {cells.map((cell, i) => {
                      if (!cell) return <span key={`e${i}`} />;
                      const enabled = dates.has(cell.ymd) && cell.ymd >= todayYMD() && cell.ymd <= maxDay;
                      const selected = day === cell.ymd;
                      return (
                        <button
                          key={cell.ymd}
                          type="button"
                          role="gridcell"
                          disabled={!enabled}
                          aria-pressed={selected}
                          aria-label={formatLong(cell.ymd)}
                          onClick={() => {
                            setDay(cell.ymd);
                            setStepError(null);
                          }}
                          className={cn(
                            'flex aspect-square items-center justify-center rounded-lg text-[13px] transition-all',
                            selected
                              ? 'bg-teal-700 font-bold text-white shadow-[0_2px_8px_rgba(13,148,136,0.35)]'
                              : enabled
                                ? 'bg-teal-600/[0.07] font-semibold text-teal-900 hover:bg-teal-600/15 active:scale-95'
                                : 'cursor-not-allowed text-slate-300',
                          )}
                        >
                          {cell.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="book-time" className="mb-1.5 block text-[12.5px] font-semibold text-slate-700">
                        Time preference
                      </label>
                      <select
                        id="book-time"
                        value={timePreference}
                        onChange={(e) => setTimePreference(e.target.value)}
                        className="h-11 w-full rounded-xl border border-slate-200/80 bg-white px-3 text-[13.5px] outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/25"
                      >
                        <option value="any">No preference</option>
                        <option value="morning">Morning</option>
                        <option value="afternoon">Afternoon</option>
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label htmlFor="book-notes" className="mb-1.5 block text-[12.5px] font-semibold text-slate-700">
                        Notes <span className="font-normal text-slate-500">(optional — symptoms or reason)</span>
                      </label>
                      <textarea
                        id="book-notes"
                        rows={3}
                        maxLength={500}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Briefly describe your concern…"
                        className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 text-[13.5px] outline-none placeholder:text-slate-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-600/25"
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {step === 2 && service && (
            <dl className="space-y-3 text-[13.5px]">
              <div className="flex justify-between gap-4 border-b border-slate-200/70 pb-3">
                <dt className="text-slate-500">Service</dt>
                <dd className="text-right font-semibold text-slate-900">{service.name}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-slate-200/70 pb-3">
                <dt className="text-slate-500">Date</dt>
                <dd className="text-right font-semibold text-slate-900">{day ? formatLong(day) : '—'}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-slate-200/70 pb-3">
                <dt className="text-slate-500">Time</dt>
                <dd className="text-right font-semibold text-slate-900">
                  {timePreference === 'any' ? 'No preference' : timePreference === 'morning' ? 'Morning' : 'Afternoon'}
                </dd>
              </div>
              {notes.trim() && (
                <div>
                  <dt className="text-slate-500">Notes</dt>
                  <dd className="mt-1 rounded-lg bg-slate-50 px-3 py-2.5 leading-6 text-slate-800">{notes.trim()}</dd>
                </div>
              )}
              <p className="rounded-lg bg-amber-50 px-3 py-2.5 leading-5 text-amber-900">
                This sends a <strong>pending</strong> request. The center confirms or declines it — you'll be notified.
              </p>
            </dl>
          )}
        </motion.div>
      </AnimatePresence>

      {stepError && <InlineNotice>{stepError}</InlineNotice>}

      <div className="sticky bottom-3 flex gap-2.5 rounded-2xl border border-white/70 bg-white/85 p-2 shadow-[0_8px_30px_-12px_rgba(15,60,90,0.25)] backdrop-blur-xl sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none sm:backdrop-blur-none">
        {step > 0 && (
          <button type="button" onClick={back} className={`${secondaryButton} flex-1`}>
            <ArrowLeft size={16} aria-hidden /> Back
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <button type="button" onClick={next} className={`${primaryButton} flex-1`}>
            Continue <ArrowRight size={16} aria-hidden />
          </button>
        ) : (
          <button type="button" onClick={submit} disabled={pending} className={`${primaryButton} flex-1`}>
            {pending && <LoaderCircle size={16} className="animate-spin" aria-hidden />}
            {pending ? 'Sending…' : 'Submit request'}
          </button>
        )}
      </div>

      <p className="flex items-center gap-1.5 text-[12.5px] text-slate-500">
        <CalendarDays size={14} aria-hidden />
        <Link to="/app/services" className="underline-offset-4 hover:underline">
          Browse all services
        </Link>
      </p>
    </DashboardShell>
  );
}

import { createFileRoute, Link } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  CalendarCheck,
  CalendarDays,
  CalendarPlus,
  Clock3,
  Megaphone,
  Plus,
  Stethoscope,
} from 'lucide-react';
import { DashboardShell } from '../../components/dashboard-shell';
import { patientNav } from '../../components/patient-nav';
import {
  CardHeading,
  EmptyNote,
  InlineNotice,
  StatTile,
  StatusChip,
  cardPadding,
  chipButton,
  primaryButton,
} from '../../components/app-ui';
import { getSession } from '../../lib/auth';
import { CATEGORY_LABELS, listAnnouncements, myAppointments, type Announcement, type Appointment } from '../../lib/api';
import { googleCalendarAddUrl } from '../../lib/calendar-link';
import { getTodayService } from '../../lib/schedule';
import { cn } from '../../lib/utils';

export const Route = createFileRoute('/app/dashboard')({
  component: PatientDashboard,
});

function todayYMD(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

function serviceName(a: Appointment): string {
  return typeof a.service === 'object' ? a.service.name : 'Service';
}

function formatDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' });
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

function longToday(): string {
  return new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' });
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

const TIME_LABEL: Record<Appointment['timePreference'], string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  any: 'No time preference',
};

function fromYMD(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function relativeDay(day: string, today: string): string {
  const diff = Math.round((fromYMD(day).getTime() - fromYMD(today).getTime()) / 86_400_000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return `In ${diff} days`;
}

/** Short tag for the clinic's fixed service days; as-needed days get none. */
const SERVICE_TAG: Record<string, string> = {
  Consultation: 'Consult',
  Prenatal: 'Prenatal',
  'Family Planning': 'FP',
  'Routine Immunization (Newborn)': 'Immun.',
};

/** Mon–Sun week around the visit: the visit day is filled, today is outlined. */
function WeekStrip({ day, today }: { day: string; today: string }) {
  const visit = fromYMD(day);
  const monday = new Date(visit.getFullYear(), visit.getMonth(), visit.getDate() - ((visit.getDay() + 6) % 7));
  const week = Array.from(
    { length: 7 },
    (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i),
  );
  return (
    <div className="mt-4 rounded-xl border border-[#eaf0f6] bg-[#fbfdfe] p-2">
      <ol className="grid grid-cols-7 gap-1" aria-label="Week of your visit">
        {week.map((d) => {
          const ymd = toYMD(d);
          const isVisit = ymd === day;
          const isToday = ymd === today;
          const tag = SERVICE_TAG[getTodayService(d).name];
          return (
            <li
              key={ymd}
              aria-current={isVisit ? 'date' : undefined}
              aria-label={`${d.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' })}${
                isVisit ? ', your visit' : ''
              }${tag ? `, ${getTodayService(d).name} day` : ''}`}
              className={cn(
                'flex flex-col items-center rounded-lg py-1.5',
                isVisit
                  ? 'bg-gradient-to-b from-[#0d9488] to-[#115e59] text-white shadow-[0_6px_14px_-6px_rgba(15,118,110,0.6)]'
                  : isToday
                    ? 'bg-white ring-1 ring-inset ring-[#0f766e]/45'
                    : '',
              )}
            >
              <span
                className={cn(
                  'text-[10px] font-bold uppercase tracking-[0.06em]',
                  isVisit ? 'text-white/80' : 'text-[#94a3b8]',
                )}
              >
                {d.toLocaleDateString('en-PH', { weekday: 'narrow' })}
              </span>
              <span
                className={cn(
                  'text-[13px] font-semibold tabular-nums',
                  isVisit ? 'text-white' : 'text-[#1e293b]',
                )}
              >
                {d.getDate()}
              </span>
              <span
                className={cn(
                  'h-3 max-w-full truncate px-0.5 text-[8.5px] font-semibold uppercase leading-3',
                  isVisit ? 'text-white/85' : 'text-[#0f766e]/70',
                )}
              >
                {tag ?? ''}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 px-1 text-[10.5px] leading-4 text-[#94a3b8]">
        Clinic days: Mon Consultation · Tue Prenatal · Thu Family Planning · 2nd Wed Immunization
      </p>
    </div>
  );
}

function PatientDashboard() {
  const reduceMotion = useReducedMotion();
  const session = getSession();
  const service = getTodayService();
  const name = session?.name?.trim().split(' ')[0] || 'there';
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[] | null>(null);
  const [announcementsError, setAnnouncementsError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    myAppointments()
      .then((r) => {
        if (!cancelled) setAppointments(r.appointments);
      })
      .catch(() => {
        if (!cancelled) setAppointments([]);
      });
    listAnnouncements()
      .then((r) => {
        if (!cancelled) setAnnouncements(r.announcements);
      })
      .catch(() => {
        if (!cancelled) setAnnouncementsError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const today = todayYMD();
  const live = (appointments ?? []).filter((a) => a.status === 'pending' || a.status === 'confirmed');
  const upcoming = live.filter((a) => a.day >= today).sort((a, b) => (a.day < b.day ? -1 : 1));
  const next = upcoming[0];
  const pendingCount = (appointments ?? []).filter((a) => a.status === 'pending').length;
  const completedCount = (appointments ?? []).filter((a) => a.status === 'completed').length;

  const rise = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const riseTransition = { type: 'spring', bounce: 0, duration: 0.35 } as const;

  return (
    <DashboardShell
      title="Dashboard"
      subtitle={longToday()}
      roleLabel="Patient"
      userName={session?.name}
      userEmail={session?.email ?? ''}
      todayService={`${service.name} — ${service.detail}`}
      nav={patientNav}
      notificationsTo="/app/notifications"
    >
      {/* Greeting: the page's one warm moment, without a saturated block. */}
      <motion.section
        {...rise}
        transition={riseTransition}
        aria-labelledby="patient-greeting"
        className="app-card relative isolate overflow-hidden p-5 sm:p-7"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-24 bg-[radial-gradient(80%_140%_at_12%_-40%,rgba(20,184,166,0.16),transparent_70%)]"
        />
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#0f766e]">
              <span aria-hidden className="h-px w-5 bg-[#0f766e]/45" />
              {service.name} today
            </p>
            <h2
              id="patient-greeting"
              className="mt-2 font-display text-[26px] font-semibold leading-[1.1] tracking-[-0.03em] text-[#042f2e] sm:text-[32px]"
            >
              {greeting()}, {name}
            </h2>
            <p className="mt-2 text-[13.5px] leading-6 text-[#475569]">
              Walk-ins are welcome on service days — booking ahead keeps your wait short.
            </p>
          </div>
          <Link to="/app/appointments/new" search={{ service: undefined }} className={`${primaryButton} shrink-0`}>
            <Plus size={17} aria-hidden />
            Book appointment
          </Link>
        </div>
      </motion.section>

      <motion.div {...rise} transition={{ ...riseTransition, delay: 0.04 }} className="grid grid-cols-2 gap-3.5 sm:grid-cols-3">
        <StatTile
          icon={CalendarDays}
          label="Upcoming"
          value={appointments === null ? '—' : upcoming.length}
          hint={upcoming.length === 1 ? 'Scheduled visit' : 'Scheduled visits'}
        />
        <StatTile
          icon={Clock3}
          label="Awaiting confirm"
          value={appointments === null ? '—' : pendingCount}
          hint={pendingCount === 0 ? 'All requests handled' : 'Staff will confirm soon'}
          tone="amber"
        />
        <StatTile
          icon={Stethoscope}
          label="Visits completed"
          value={appointments === null ? '—' : completedCount}
          hint="Shown in My Records"
          tone="slate"
          className="col-span-2 sm:col-span-1"
        />
      </motion.div>

      <div className="grid items-start gap-5 lg:grid-cols-5">
        {/* Next appointment — the one thing most patients open the app for. */}
        <motion.section
          {...rise}
          transition={{ ...riseTransition, delay: 0.08 }}
          aria-labelledby="patient-next"
          className={`app-card lg:col-span-2 ${cardPadding}`}
        >
          <CardHeading title="Next appointment" />
          <div className="mt-4">
            {appointments === null ? (
              <EmptyNote>Loading your appointments…</EmptyNote>
            ) : next ? (
              <>
                <div className="flex items-start gap-3">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#0f766e]/10 text-[#0f766e]">
                    <CalendarCheck size={20} aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="font-display text-[16px] font-semibold leading-snug tracking-[-0.01em] text-slate-900">
                      {serviceName(next)}
                    </p>
                    <p className="mt-0.5 text-[13px] text-slate-600">{formatDay(next.day)}</p>
                    <p className="mt-0.5 text-[12px] text-slate-500">{TIME_LABEL[next.timePreference]}</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <StatusChip status={next.status} />
                  <span className="text-[12px] font-medium text-slate-500">{relativeDay(next.day, today)}</span>
                </div>

                <WeekStrip day={next.day} today={today} />

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  {next.status === 'confirmed' ? (
                    <a
                      href={googleCalendarAddUrl({
                        serviceName: serviceName(next),
                        day: next.day,
                        timePreference: next.timePreference,
                      })}
                      target="_blank"
                      rel="noreferrer"
                      className={chipButton}
                    >
                      <CalendarPlus size={15} aria-hidden />
                      Add to my Google Calendar
                    </a>
                  ) : (
                    <p className="text-[12px] leading-5 text-slate-500">
                      You can add it to your own calendar once the center confirms it.
                    </p>
                  )}
                  <Link
                    to="/app/appointments"
                    className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#0f766e] hover:underline hover:underline-offset-4"
                  >
                    Manage
                    <ArrowRight size={15} aria-hidden />
                  </Link>
                </div>
              </>
            ) : (
              <>
                <p className="text-[13.5px] leading-6 text-slate-600">
                  No upcoming visit. Book one and your confirmed appointment and reminders will appear here.
                </p>
                <Link
                  to="/app/appointments/new"
                  search={{ service: undefined }}
                  className={`${primaryButton} mt-4 h-10 text-[13px]`}
                >
                  Book a visit
                </Link>
              </>
            )}
          </div>
        </motion.section>

        {/* Announcements — real posts from the center, previewed three at a time. */}
        <motion.section
          {...rise}
          transition={{ ...riseTransition, delay: 0.12 }}
          aria-labelledby="patient-announcements"
          className={`app-card lg:col-span-3 ${cardPadding}`}
        >
          <CardHeading
            title="From the health center"
            description="Schedule changes, vaccination days and advisories."
            action={
              <Link
                to="/app/announcements"
                className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#0f766e] hover:underline hover:underline-offset-4"
              >
                View all
                <ArrowRight size={15} aria-hidden />
              </Link>
            }
          />
          <div className="mt-4">
            {announcementsError ? (
              <InlineNotice>Couldn't load announcements right now.</InlineNotice>
            ) : announcements === null ? (
              <EmptyNote>Loading announcements…</EmptyNote>
            ) : announcements.length === 0 ? (
              <EmptyNote>No announcements yet. New posts from the center will show up here.</EmptyNote>
            ) : (
              <ul className="divide-y divide-[#eaf0f6]">
                {announcements.slice(0, 3).map((a) => (
                  <li key={a.id} className="py-3.5 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#e9f7f4] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#115e59] ring-1 ring-inset ring-[#0f766e]/15">
                        <Megaphone size={10} aria-hidden />
                        {CATEGORY_LABELS[a.category]}
                      </span>
                      <span className="text-[11px] tabular-nums text-[#94a3b8]">{formatShortDate(a.publishedAt)}</span>
                      {a.pinned && (
                        <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-[#0f766e]">
                          Pinned
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 text-[13.5px] font-semibold leading-snug text-[#042f2e]">{a.title}</p>
                    <p className="mt-1 line-clamp-2 text-[12.5px] leading-5 text-[#64748b]">{a.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </motion.section>
      </div>
    </DashboardShell>
  );
}

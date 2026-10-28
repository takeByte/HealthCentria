import { createFileRoute, Link } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  CalendarCheck,
  CalendarDays,
  Clock3,
  Megaphone,
  Plus,
  Stethoscope,
} from 'lucide-react';
import { DashboardShell } from '../../components/dashboard-shell';
import { patientNav } from '../../components/patient-nav';
import { CardHeading, EmptyNote, InlineNotice, StatTile, StatusChip, cardPadding, primaryButton } from '../../components/app-ui';
import { getSession } from '../../lib/auth';
import { CATEGORY_LABELS, listAnnouncements, myAppointments, type Announcement, type Appointment } from '../../lib/api';
import { getTodayService } from '../../lib/schedule';

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
          className="pointer-events-none absolute -right-24 -top-28 -z-10 size-64 rounded-full bg-teal-300/15 blur-3xl"
        />
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-teal-700">
              {service.name} today
            </p>
            <h2
              id="patient-greeting"
              className="mt-1.5 font-display text-[26px] font-semibold leading-tight tracking-[-0.025em] text-slate-900 sm:text-[30px]"
            >
              {greeting()}, {name}
            </h2>
            <p className="mt-1.5 text-[13.5px] leading-6 text-slate-600">
              Walk-ins are welcome on service days — booking ahead keeps your wait short.
            </p>
          </div>
          <Link to="/app/appointments/new" search={{ service: undefined }} className={`${primaryButton} shrink-0`}>
            <Plus size={17} aria-hidden />
            Book appointment
          </Link>
        </div>
      </motion.section>

      <motion.div {...rise} transition={{ ...riseTransition, delay: 0.04 }} className="grid gap-3.5 sm:grid-cols-3">
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
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-teal-600/10 text-teal-700">
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
                <div className="mt-4 flex items-center justify-between gap-3">
                  <StatusChip status={next.status} />
                  <Link
                    to="/app/appointments"
                    className="inline-flex items-center gap-1 text-[13px] font-semibold text-teal-700 hover:underline hover:underline-offset-4"
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
                className="inline-flex items-center gap-1 text-[13px] font-semibold text-teal-700 hover:underline hover:underline-offset-4"
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
              <ul className="divide-y divide-slate-200/70">
                {announcements.slice(0, 3).map((a) => (
                  <li key={a.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full bg-teal-600/10 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-teal-800">
                        <Megaphone size={11} aria-hidden />
                        {CATEGORY_LABELS[a.category]}
                      </span>
                      <span className="text-[11.5px] text-slate-400">{formatShortDate(a.publishedAt)}</span>
                      {a.pinned && <span className="text-[11.5px] font-semibold text-teal-700">Pinned</span>}
                    </div>
                    <p className="mt-1.5 text-[13.5px] font-semibold leading-snug text-slate-900">{a.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-5 text-slate-600">{a.body}</p>
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

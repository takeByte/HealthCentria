import { createFileRoute, Link } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  CalendarCheck,
  Clock3,
  FileText,
  Megaphone,
  Stethoscope,
} from 'lucide-react';
import { DashboardShell } from '../../components/dashboard-shell';
import { opsNav } from '../../components/ops-nav';
import {
  CardHeading,
  EmptyNote,
  InlineNotice,
  PageHero,
  StatTile,
  panel,
  primaryButton,
  secondaryButton,
} from '../../components/app-ui';
import { getSession } from '../../lib/auth';
import { listAnnouncements, queueAppointments, type Announcement } from '../../lib/api';
import { getTodayService } from '../../lib/schedule';

export const Route = createFileRoute('/staff/dashboard')({
  component: StaffDashboard,
});

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function displayFirstName(name?: string): string {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (parts.length > 1 && /^(dr\.?|nurse|mr\.?|mrs\.?|ms\.?)$/i.test(parts[0])) return parts[1];
  return parts[0] ?? 'there';
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

function StaffDashboard() {
  const reduceMotion = useReducedMotion();
  const session = getSession();
  const service = getTodayService();
  const firstName = displayFirstName(session?.name);
  const [counts, setCounts] = useState<{ today: number; pending: number } | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[] | null>(null);
  const [announcementsError, setAnnouncementsError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const now = new Date();
    const t = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    Promise.all([
      queueAppointments({ from: t, to: t }).catch(() => ({ appointments: [] })),
      queueAppointments({ status: 'pending' }).catch(() => ({ appointments: [] })),
    ]).then(([todays, pendings]) => {
      if (cancelled) return;
      setCounts({
        today: todays.appointments.filter((a) => a.status === 'confirmed' || a.status === 'pending').length,
        pending: pendings.appointments.length,
      });
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

  const rise = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const riseTransition = { type: 'spring', bounce: 0, duration: 0.35 } as const;

  return (
    <DashboardShell
      title="Staff Dashboard"
      subtitle={`${service.name} today — ${service.detail}`}
      roleLabel={session?.role === 'admin' ? 'Admin' : 'Staff'}
      userName={session?.name}
      userEmail={session?.email ?? ''}
      todayService={`${service.name} — ${service.detail}`}
      nav={opsNav(session?.role)}
      notificationsTo="/staff/notifications"
    >
      <motion.div {...rise} transition={riseTransition}>
        <PageHero
          eyebrow={`${service.name} today`}
          title={`${greeting()}, ${firstName}`}
          description={
            counts === null
              ? 'Loading today’s queue…'
              : counts.pending > 0
                ? `${counts.pending} request${counts.pending === 1 ? '' : 's'} waiting for review. Confirm or decline before the clinic fills up.`
                : 'The queue is clear. Review today’s confirmed visits and keep the patient records up to date.'
          }
          action={
            <Link to="/staff/appointments" className={`${primaryButton} shrink-0`}>
              Open the queue <ArrowRight size={16} aria-hidden />
            </Link>
          }
        />
      </motion.div>

      <motion.div
        {...rise}
        transition={{ ...riseTransition, delay: 0.04 }}
        className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatTile
          icon={CalendarCheck}
          label="Today"
          value={counts === null ? '—' : counts.today}
          hint="Confirmed + pending visits"
        />
        <StatTile
          icon={Clock3}
          label="Pending requests"
          value={counts === null ? '—' : counts.pending}
          hint={counts?.pending === 0 ? 'Queue is clear' : 'Confirm or decline'}
          tone="amber"
        />
        <StatTile
          icon={Stethoscope}
          label="Today's service"
          value={service.name}
          hint={service.detail}
          tone="sky"
        />
        <StatTile icon={FileText} label="Reports" value="30 days" hint="Visits per service" tone="slate" />
      </motion.div>

      <div className="grid items-start gap-5 lg:grid-cols-5">
        <motion.section
          {...rise}
          transition={{ ...riseTransition, delay: 0.08 }}
          className={`${panel} lg:col-span-2`}
        >
          <CardHeading
            title="Pending approvals"
            description={
              counts === null
                ? 'Loading the queue…'
                : counts.pending === 0
                  ? 'Nothing waiting — the queue is clear.'
                  : `${counts.pending} request${counts.pending === 1 ? '' : 's'} need${counts.pending === 1 ? 's' : ''} review.`
            }
          />
          <Link to="/staff/appointments" className={`${primaryButton} mt-4 h-10 px-4 text-[13px]`}>
            Review requests <ArrowRight size={15} aria-hidden />
          </Link>
          <Link to="/staff/walk-in" className={`${secondaryButton} mt-2 h-10 px-4 text-[13px]`}>
            Register a walk-in
          </Link>
        </motion.section>

        <motion.section
          {...rise}
          transition={{ ...riseTransition, delay: 0.12 }}
          className={`${panel} lg:col-span-3`}
        >
          <CardHeading
            title="From the health center"
            description="The same announcements patients see in their feed."
            action={
              <Link
                to="/staff/announcements"
                className="inline-flex items-center gap-1 text-[13px] font-semibold text-teal-700 hover:underline hover:underline-offset-4"
              >
                View all <ArrowRight size={15} aria-hidden />
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
                        {a.pinned ? 'Pinned' : 'Announcement'}
                      </span>
                      <span className="text-[11.5px] text-slate-400">{formatShortDate(a.publishedAt)}</span>
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

      <motion.section {...rise} transition={{ ...riseTransition, delay: 0.16 }} className={panel}>
        <CardHeading
          title="Visits per service"
          description="Completed visits per service for the last 30 days."
          action={
            <Link to="/staff/reports" className={`${secondaryButton} h-9 px-3.5 text-[13px]`}>
              Open reports <ArrowRight size={15} aria-hidden />
            </Link>
          }
        />
      </motion.section>
    </DashboardShell>
  );
}

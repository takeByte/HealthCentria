import { createFileRoute, Link } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  CalendarCheck,
  Clock3,
  DatabaseBackup,
  Settings,
  UserCog,
  Users,
} from 'lucide-react';
import { AnnouncementList } from '../../components/announcement-list';
import { ClinicSchedule } from '../../components/clinic-schedule';
import { DashboardShell } from '../../components/dashboard-shell';
import { opsNav } from '../../components/ops-nav';
import { ServiceUtilization } from '../../components/service-utilization';
import {
  CardHeading,
  PageHero,
  StatTile,
  panel,
  primaryButton,
} from '../../components/app-ui';
import { getSession } from '../../lib/auth';
import { listAnnouncements, overview, type Announcement } from '../../lib/api';
import { getTodayService } from '../../lib/schedule';

export const Route = createFileRoute('/admin/dashboard')({
  component: AdminDashboard,
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

function AdminDashboard() {
  const reduceMotion = useReducedMotion();
  const session = getSession();
  const service = getTodayService();
  const firstName = displayFirstName(session?.name);
  const [counts, setCounts] = useState<{
    today: number;
    pending: number;
    totalPatients: number;
    activeStaff?: number;
  } | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[] | null>(null);
  const [announcementsError, setAnnouncementsError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    overview()
      .then((r) => {
        if (!cancelled) setCounts(r);
      })
      .catch(() => {
        if (!cancelled) setCounts(null);
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

  const v = (n: number | undefined) => (counts === null ? '—' : String(n ?? 0));

  const rise = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const riseTransition = { type: 'spring', bounce: 0, duration: 0.35 } as const;

  return (
    <DashboardShell
      title="Admin Dashboard"
      subtitle="Everything happening at the center, at a glance"
      roleLabel="Admin"
      userName={session?.name}
      userEmail={session?.email ?? ''}
      todayService={`${service.name} — ${service.detail}`}
      nav={opsNav(session?.role, session?.permissions)}
      notificationsTo="/staff/notifications"
    >
      <motion.div {...rise} transition={riseTransition}>
        <PageHero
          eyebrow={`${service.name} today`}
          title={`${greeting()}, ${firstName}`}
          description={
            counts === null
              ? 'Loading the center’s numbers…'
              : counts.pending > 0
                ? `${counts.pending} request${counts.pending === 1 ? '' : 's'} need review. Keep the queue moving and the patient register current.`
                : 'The queue is clear. This is a good moment to review staff accounts, services and settings.'
          }
          action={
            <Link to="/staff/appointments" className={`${primaryButton} shrink-0`}>
              Review the queue <ArrowRight size={16} aria-hidden />
            </Link>
          }
        />
      </motion.div>

      <motion.div
        {...rise}
        transition={{ ...riseTransition, delay: 0.04 }}
        className="grid grid-cols-2 gap-3.5 xl:grid-cols-4"
      >
        <StatTile
          icon={CalendarCheck}
          label="Today"
          value={v(counts?.today)}
          hint="Confirmed + pending visits"
        />
        <StatTile
          icon={Clock3}
          label="Pending requests"
          value={v(counts?.pending)}
          hint={counts?.pending === 0 ? 'Queue is clear' : 'Needs review'}
          tone="amber"
        />
        <StatTile
          icon={Users}
          label="Total patients"
          value={v(counts?.totalPatients)}
          hint="Registered patient accounts"
          tone="sky"
        />
        <StatTile
          icon={UserCog}
          label="Staff accounts"
          value={v(counts?.activeStaff)}
          hint="Active staff + admins"
          tone="slate"
        />
      </motion.div>

      <motion.div {...rise} transition={{ ...riseTransition, delay: 0.08 }}>
        <ClinicSchedule />
      </motion.div>

      <div className="grid items-start gap-5 lg:grid-cols-5">
        <motion.section {...rise} transition={{ ...riseTransition, delay: 0.12 }} className={`${panel} lg:col-span-3`}>
          <CardHeading
            title="From the health center"
            description="Announcements are shared with staff and patients."
            action={
              <Link
                to="/staff/announcements"
                className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#1f55a8] hover:underline hover:underline-offset-4"
              >
                Manage <ArrowRight size={15} aria-hidden />
              </Link>
            }
          />
          <div className="mt-4">
            <AnnouncementList
              announcements={announcements}
              error={announcementsError}
              emptyMessage="No announcements yet. Post one and it appears for staff and patients."
            />
          </div>
        </motion.section>

        <motion.section {...rise} transition={{ ...riseTransition, delay: 0.16 }} className={`${panel} lg:col-span-2`}>
          <CardHeading
            title="Workspace administration"
            description="Manage who can sign in and how patients reach the center."
          />
          <div className="mt-4 grid gap-2">
            <Link
              to="/admin/staff-accounts"
              className="group flex items-center gap-3 rounded-xl border border-[#eaf0f6] bg-[#fbfdfe] px-3 py-2.5 transition-colors hover:border-[#c6d8e4] hover:bg-white"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white text-[#1f55a8] ring-1 ring-inset ring-[#e2e8f0]">
                <UserCog size={15} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-semibold text-[#0b2c4f]">Staff accounts</span>
                <span className="block truncate text-[11px] text-[#94a3b8]">Invite, suspend, reset</span>
              </span>
              <ArrowRight
                size={14}
                aria-hidden
                className="shrink-0 text-[#94a3b8] transition-transform group-hover:translate-x-0.5 group-hover:text-[#1f55a8]"
              />
            </Link>
            <Link
              to="/admin/backups"
              className="group flex items-center gap-3 rounded-xl border border-[#eaf0f6] bg-[#fbfdfe] px-3 py-2.5 transition-colors hover:border-[#c6d8e4] hover:bg-white"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white text-[#1f55a8] ring-1 ring-inset ring-[#e2e8f0]">
                <DatabaseBackup size={15} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-semibold text-[#0b2c4f]">Backups</span>
                <span className="block truncate text-[11px] text-[#94a3b8]">Schedule and restore</span>
              </span>
              <ArrowRight
                size={14}
                aria-hidden
                className="shrink-0 text-[#94a3b8] transition-transform group-hover:translate-x-0.5 group-hover:text-[#1f55a8]"
              />
            </Link>
            <Link
              to="/admin/settings"
              className="group flex items-center gap-3 rounded-xl border border-[#eaf0f6] bg-[#fbfdfe] px-3 py-2.5 transition-colors hover:border-[#c6d8e4] hover:bg-white"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white text-[#1f55a8] ring-1 ring-inset ring-[#e2e8f0]">
                <Settings size={15} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-semibold text-[#0b2c4f]">Settings</span>
                <span className="block truncate text-[11px] text-[#94a3b8]">Clinic, email, integrations</span>
              </span>
              <ArrowRight
                size={14}
                aria-hidden
                className="shrink-0 text-[#94a3b8] transition-transform group-hover:translate-x-0.5 group-hover:text-[#1f55a8]"
              />
            </Link>
          </div>
        </motion.section>
      </div>

      <motion.div {...rise} transition={{ ...riseTransition, delay: 0.2 }}>
        <ServiceUtilization />
      </motion.div>
    </DashboardShell>
  );
}

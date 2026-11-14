import { createFileRoute, Link } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  CalendarCheck,
  Clock3,
  FileText,
  Stethoscope,
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
  StatusPill,
  panel,
  primaryButton,
  secondaryButton,
} from '../../components/app-ui';
import { getSession } from '../../lib/auth';
import { sessionCan } from '../../lib/permissions';
import {
  listAnnouncements,
  queueAppointments,
  type Announcement,
  type StaffAppointment,
} from '../../lib/api';
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

function patientName(a: StaffAppointment): string {
  return typeof a.patient === 'object' ? a.patient.name : 'Patient';
}

function serviceLabel(a: StaffAppointment): string {
  return typeof a.service === 'object' ? a.service.name : 'Service';
}

function formatDayShort(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-PH', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function StaffDashboard() {
  const reduceMotion = useReducedMotion();
  const session = getSession();
  const service = getTodayService();
  const firstName = displayFirstName(session?.name);
  const canAppointments = sessionCan(session, 'appointments.manage');
  const canWalkIn = sessionCan(session, 'walkin.manage');
  const canReports = sessionCan(session, 'reports.view');
  const canAnnouncements = sessionCan(session, 'announcements.manage');
  const [counts, setCounts] = useState<{ today: number; pending: number } | null>(null);
  const [requests, setRequests] = useState<StaffAppointment[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[] | null>(null);
  const [announcementsError, setAnnouncementsError] = useState(false);

  useEffect(() => {
    if (!canAppointments) {
      setCounts({ today: 0, pending: 0 });
      return;
    }
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
      setRequests(pendings.appointments.slice(0, 3));
    });
    return () => {
      cancelled = true;
    };
  }, [canAppointments]);

  useEffect(() => {
    let cancelled = false;
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
      nav={opsNav(session?.role, session?.permissions)}
      notificationsTo="/staff/notifications"
    >
      <motion.div {...rise} transition={riseTransition}>
        <PageHero
          eyebrow={`${service.name} today`}
          title={`${greeting()}, ${firstName}`}
          description={
            !canAppointments
              ? 'Your admin sets which tools this account can use. Open the menu to see what you can access.'
              : counts === null
                ? 'Loading today’s queue…'
                : counts.pending > 0
                  ? `${counts.pending} request${counts.pending === 1 ? '' : 's'} waiting for review. Confirm or decline before the clinic fills up.`
                  : 'The queue is clear. Review today’s confirmed visits and keep the patient records up to date.'
          }
          action={
            canAppointments ? (
              <Link to="/staff/appointments" className={`${primaryButton} shrink-0`}>
                Open the queue <ArrowRight size={16} aria-hidden />
              </Link>
            ) : canWalkIn ? (
              <Link to="/staff/walk-in" className={`${primaryButton} shrink-0`}>
                Register a walk-in <ArrowRight size={16} aria-hidden />
              </Link>
            ) : undefined
          }
        />
      </motion.div>

      <motion.div
        {...rise}
        transition={{ ...riseTransition, delay: 0.04 }}
        className={`grid grid-cols-2 gap-3.5 ${
          canAppointments && canReports ? 'xl:grid-cols-4' : canAppointments || canReports ? 'xl:grid-cols-3' : 'xl:grid-cols-1'
        }`}
      >
        {canAppointments && (
          <StatTile
            icon={CalendarCheck}
            label="Today"
            value={counts === null ? '—' : counts.today}
            hint="Confirmed + pending visits"
          />
        )}
        {canAppointments && (
          <StatTile
            icon={Clock3}
            label="Pending requests"
            value={counts === null ? '—' : counts.pending}
            hint={counts?.pending === 0 ? 'Queue is clear' : 'Confirm or decline'}
            tone="amber"
          />
        )}
        <StatTile
          icon={Stethoscope}
          label="Today's service"
          value={service.name}
          hint={service.detail}
          tone="sky"
        />
        {canReports && (
          <StatTile icon={FileText} label="Reports" value="30 days" hint="Visits per service" tone="slate" />
        )}
      </motion.div>

      <motion.div {...rise} transition={{ ...riseTransition, delay: 0.06 }}>
        <ClinicSchedule />
      </motion.div>

      <div className="grid items-start gap-5 lg:grid-cols-5">
        {(canAppointments || canWalkIn) && (
          <motion.section
            {...rise}
            transition={{ ...riseTransition, delay: 0.08 }}
            className={`${panel} lg:col-span-2`}
          >
            <CardHeading
              title={canAppointments ? 'Pending approvals' : 'Walk-in registration'}
              description={
                !canAppointments
                  ? 'Register a patient who arrives without an appointment.'
                  : counts === null
                    ? 'Loading the queue…'
                    : counts.pending === 0
                      ? 'Nothing waiting — the queue is clear.'
                      : `${counts.pending} request${counts.pending === 1 ? '' : 's'} need${counts.pending === 1 ? 's' : ''} review.`
              }
              action={
                canAppointments && counts !== null ? (
                  <StatusPill tone={counts.pending > 0 ? 'amber' : 'teal'}>
                    {counts.pending > 0 ? `${counts.pending} waiting` : 'Clear'}
                  </StatusPill>
                ) : undefined
              }
            />

            {canAppointments && counts === null && (
              <div className="mt-4 space-y-2.5" aria-hidden>
                {[0, 1].map((i) => (
                  <div key={i} className="flex items-center gap-2.5">
                    <div className="size-7 animate-pulse rounded-full bg-[#edf4f8]" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-2.5 w-1/2 animate-pulse rounded-full bg-[#edf4f8]" />
                      <div className="h-2 w-2/3 animate-pulse rounded-full bg-[#f2f7fb]" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {canAppointments && requests.length > 0 && (
              <ul className="mt-3.5 divide-y divide-[#eaf0f6]">
                {requests.map((a) => (
                  <li key={a.id} className="flex items-center gap-2.5 py-2 first:pt-0 last:pb-0">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#fdf5e4] text-[10px] font-bold text-[#8a5a10]">
                      {patientName(a)
                        .trim()
                        .split(/\s+/)
                        .slice(0, 2)
                        .map((w) => w[0]?.toUpperCase())
                        .join('')}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-semibold text-[#1e293b]">{patientName(a)}</p>
                      <p className="truncate text-[11px] text-[#94a3b8]">
                        {serviceLabel(a)} · {formatDayShort(a.day)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {canAppointments && (
                <Link to="/staff/appointments" className={`${primaryButton} h-10 px-4 text-[13px]`}>
                  Review requests <ArrowRight size={15} aria-hidden />
                </Link>
              )}
              {canWalkIn && (
                <Link to="/staff/walk-in" className={`${secondaryButton} h-10 px-4 text-[13px]`}>
                  Register a walk-in
                </Link>
              )}
            </div>
          </motion.section>
        )}

        <motion.section
          {...rise}
          transition={{ ...riseTransition, delay: 0.12 }}
          className={`${panel} ${canAppointments || canWalkIn ? 'lg:col-span-3' : 'lg:col-span-5'}`}
        >
          <CardHeading
            title="From the health center"
            description="The same announcements patients see in their feed."
            action={
              canAnnouncements ? (
                <Link
                  to="/staff/announcements"
                  className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#0f766e] hover:underline hover:underline-offset-4"
                >
                  View all <ArrowRight size={15} aria-hidden />
                </Link>
              ) : undefined
            }
          />
          <div className="mt-4">
            <AnnouncementList announcements={announcements} error={announcementsError} />
          </div>
        </motion.section>
      </div>

      {canReports && (
        <motion.div {...rise} transition={{ ...riseTransition, delay: 0.16 }}>
          <ServiceUtilization />
        </motion.div>
      )}
    </DashboardShell>
  );
}

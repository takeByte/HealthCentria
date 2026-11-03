import { createFileRoute } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { ActivityFeed } from '../../components/activity-log';
import { DashboardShell } from '../../components/dashboard-shell';
import { opsNav } from '../../components/ops-nav';
import { PageHero, StatusPill } from '../../components/app-ui';
import { getSession } from '../../lib/auth';
import { getTodayService } from '../../lib/schedule';

export const Route = createFileRoute('/staff/activity')({
  component: StaffActivity,
});

function StaffActivity() {
  const reduceMotion = useReducedMotion();
  const session = getSession();
  const today = getTodayService();
  const isAdmin = session?.role === 'admin';

  return (
    <DashboardShell
      title="Activity"
      subtitle="Work events on the center's records"
      roleLabel={isAdmin ? 'Admin' : 'Staff'}
      userName={session?.name}
      userEmail={session?.email ?? ''}
      todayService={`${today.name} — ${today.detail}`}
      nav={opsNav(session?.role)}
      notificationsTo="/staff/notifications"
    >
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
      >
        <PageHero
          eyebrow="Accountability"
          title="What happened, and who did it"
          description="Appointments, patient charts and announcements you work with, plus your own sign-ins. Configuration changes and other staff members' sign-ins stay admin-only."
          action={<StatusPill tone="slate">Scoped view</StatusPill>}
        />
      </motion.div>

      <ActivityFeed scope="staff" />
    </DashboardShell>
  );
}

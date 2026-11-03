import { createFileRoute } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { ActivityFeed } from '../../components/activity-log';
import { DashboardShell } from '../../components/dashboard-shell';
import { patientNav } from '../../components/patient-nav';
import { PageHero } from '../../components/app-ui';
import { getSession } from '../../lib/auth';
import { getTodayService } from '../../lib/schedule';

export const Route = createFileRoute('/app/activity')({
  component: MyActivity,
});

function MyActivity() {
  const reduceMotion = useReducedMotion();
  const session = getSession();
  const today = getTodayService();

  return (
    <DashboardShell
      title="Activity"
      subtitle="Your bookings, visits and profile changes"
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
      >
        <PageHero
          eyebrow="Your account"
          title="Everything that happened"
          description="Appointment requests and status changes, visit records written by staff, and edits to your own profile. You only ever see activity on your own account."
        />
      </motion.div>

      <ActivityFeed scope="patient" limit={12} compact />

      <p className="px-1 text-[11.5px] leading-5 text-slate-500">
        Activity is kept for 365 days. These entries are read-only — if something looks wrong, ask the front desk.
      </p>
    </DashboardShell>
  );
}

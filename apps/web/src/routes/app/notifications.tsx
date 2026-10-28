import { createFileRoute } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import { DashboardShell } from '../../components/dashboard-shell';
import { NotificationCenter } from '../../components/notifications';
import { patientNav } from '../../components/patient-nav';
import { EmptyNote, InlineNotice } from '../../components/app-ui';
import { getSession } from '../../lib/auth';
import { listNotifications, type NotificationItem } from '../../lib/api';
import { getTodayService } from '../../lib/schedule';

export const Route = createFileRoute('/app/notifications')({
  component: PatientNotifications,
});

function PatientNotifications() {
  const reduceMotion = useReducedMotion();
  const session = getSession();
  const today = getTodayService();
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listNotifications()
      .then((r) => {
        if (!cancelled) setItems(r.notifications);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load notifications.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <DashboardShell
      title="Notifications"
      subtitle="Appointment updates and reminders"
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
        className="max-w-3xl"
      >
        {error && <InlineNotice>{error}</InlineNotice>}
        {items === null && !error && <EmptyNote>Loading notifications…</EmptyNote>}
        {items !== null && <NotificationCenter items={items} onChanged={setItems} />}
      </motion.div>
    </DashboardShell>
  );
}

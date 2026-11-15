import { useLiveRefresh } from '../../lib/realtime';
import { createFileRoute } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import { AnnouncementFeed } from '../../components/announcement-feed';
import { DashboardShell } from '../../components/dashboard-shell';
import { patientNav } from '../../components/patient-nav';
import { EmptyNote, InlineNotice } from '../../components/app-ui';
import { getSession } from '../../lib/auth';
import { listAnnouncements, type Announcement } from '../../lib/api';
import { getTodayService } from '../../lib/schedule';

export const Route = createFileRoute('/app/announcements')({
  component: PatientAnnouncements,
});

function PatientAnnouncements() {
  const reduceMotion = useReducedMotion();
  const session = getSession();
  const today = getTodayService();
  const [items, setItems] = useState<Announcement[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [liveTick, setLiveTick] = useState(0);
  useLiveRefresh(['announcements'], () => setLiveTick((t) => t + 1));

  useEffect(() => {
    let cancelled = false;
    listAnnouncements()
      .then((r) => {
        if (!cancelled) {
          setItems(r.announcements);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load announcements.');
      });
    return () => {
      cancelled = true;
    };
  }, [liveTick]);

  return (
    <DashboardShell
      title="Announcements"
      subtitle="Schedule changes, vaccination days and advisories from the health center"
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
        className="space-y-3"
      >
        {error && <InlineNotice>{error}</InlineNotice>}
        {items === null && !error && <EmptyNote>Loading announcements…</EmptyNote>}
        {items !== null && <AnnouncementFeed items={items} />}
      </motion.div>
    </DashboardShell>
  );
}

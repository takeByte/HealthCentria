import { createFileRoute } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Database, FilePenLine, History, ShieldAlert } from 'lucide-react';
import { ActivityFeed } from '../../components/activity-log';
import { DashboardShell } from '../../components/dashboard-shell';
import { opsNav } from '../../components/ops-nav';
import { PageHero, StatTile, StatusPill, panel } from '../../components/app-ui';
import { formatDateTime } from '../../components/record-meta';
import { getSession } from '../../lib/auth';
import { activityPolicy, activitySummary } from '../../lib/api';
import { getTodayService } from '../../lib/schedule';

export const Route = createFileRoute('/admin/activity')({
  component: AdminActivity,
});

function AdminActivity() {
  const reduceMotion = useReducedMotion();
  const session = getSession();
  const today = getTodayService();
  const [summary, setSummary] = useState<{
    today: number;
    failedSignIns: number;
    recordsEdited: number;
    stored: number;
  } | null>(null);
  const [policy, setPolicy] = useState<{ retentionDays: number; oldest: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    activitySummary()
      .then((r) => {
        if (!cancelled) setSummary(r);
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      });
    activityPolicy()
      .then((r) => {
        if (!cancelled) setPolicy({ retentionDays: r.retentionDays, oldest: r.oldest });
      })
      .catch(() => {
        if (!cancelled) setPolicy(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rise = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const riseTransition = { type: 'spring', bounce: 0, duration: 0.35 } as const;
  const v = (n: number | undefined) => (summary === null ? '—' : String(n ?? 0));

  return (
    <DashboardShell
      title="Activity log"
      subtitle="Who changed what, and when"
      roleLabel="Admin"
      userName={session?.name}
      userEmail={session?.email ?? ''}
      todayService={`${today.name} — ${today.detail}`}
      nav={opsNav(session?.role)}
      notificationsTo="/staff/notifications"
    >
      <motion.div {...rise} transition={riseTransition}>
        <PageHero
          eyebrow="System transparency"
          title="Every change, recorded"
          description="Sign-ins, appointments, patient charts, announcements and configuration changes. Entries are written by the server and cannot be edited or deleted from this screen."
          action={<StatusPill tone="slate">Read-only</StatusPill>}
        />
      </motion.div>

      <motion.div
        {...rise}
        transition={{ ...riseTransition, delay: 0.04 }}
        className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatTile icon={History} label="Events today" value={v(summary?.today)} hint="Since midnight" />
        <StatTile
          icon={ShieldAlert}
          label="Failed sign-ins"
          value={v(summary?.failedSignIns)}
          hint="Last 24 hours"
          tone="amber"
        />
        <StatTile
          icon={FilePenLine}
          label="Records edited"
          value={v(summary?.recordsEdited)}
          hint="Patient charts · last 7 days"
          tone="sky"
        />
        <StatTile icon={Database} label="Stored entries" value={v(summary?.stored)} hint="Within retention" tone="slate" />
      </motion.div>

      <motion.div {...rise} transition={{ ...riseTransition, delay: 0.08 }}>
        <ActivityFeed scope="admin" showExport showPurge />
      </motion.div>

      <motion.section {...rise} transition={{ ...riseTransition, delay: 0.12 }} className={panel}>
        <h2 className="font-display text-[15px] font-semibold tracking-[-0.01em] text-slate-900">
          Retention policy
        </h2>
        <p className="mt-1 text-[13px] leading-6 text-slate-600">
          Activity is kept for {policy?.retentionDays ?? 365} days. After that an admin can purge it — the purge
          deletes only expired entries, asks for confirmation, and records itself (who, when, and how many rows).
          Passwords, tokens and OAuth secrets are never written to the log.
        </p>
        <p className="mt-2 text-[12px] text-slate-500">
          {policy?.oldest
            ? `Oldest stored entry: ${formatDateTime(policy.oldest)}.`
            : 'No entries stored yet.'}
        </p>
      </motion.section>
    </DashboardShell>
  );
}

import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowRight } from 'lucide-react';
import { CardHeading, EmptyNote, InlineNotice, chipButton, panel } from './app-ui';
import { visitsPerService, type ReportRange, type VisitsPerServiceRow } from '../lib/api';
import { cn } from '../lib/utils';

/**
 * Completed visits per service, pulled from the reports API.
 *
 * The dashboards used to leave this panel empty; the rows here are the same
 * numbers the reports page shows, so nothing on the home screen is invented.
 */
export function ServiceUtilization({
  range = 'month',
  limit = 5,
  className,
}: {
  range?: ReportRange;
  limit?: number;
  className?: string;
}) {
  const [data, setData] = useState<{ total: number; rows: VisitsPerServiceRow[] } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    visitsPerService(range)
      .then((r) => {
        if (!cancelled) setData({ total: r.total, rows: r.rows });
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  const rows = [...(data?.rows ?? [])].sort((a, b) => b.count - a.count).slice(0, limit);
  const max = Math.max(1, ...rows.map((r) => r.count));

  return (
    <section className={cn(panel, className)}>
      <CardHeading
        title="Service utilization"
        description={
          data
            ? `${data.total} completed visit${data.total === 1 ? '' : 's'} in the last 30 days.`
            : 'Completed visits per service in the last 30 days.'
        }
        action={
          <Link to="/staff/reports" className={`${chipButton} shrink-0`}>
            Reports <ArrowRight size={14} aria-hidden />
          </Link>
        }
      />

      <div className="mt-4">
        {error ? (
          <InlineNotice>Couldn't load service totals right now.</InlineNotice>
        ) : data === null ? (
          <div className="space-y-3" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className="animate-pulse">
                <div className="h-2.5 w-1/2 rounded-full bg-[#edf4f8]" />
                <div className="mt-2 h-1.5 rounded-full bg-[#f2f7fb]" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyNote>No completed visits in this period yet.</EmptyNote>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => {
              const share = Math.round((r.count / max) * 100);
              return (
                <li key={r.serviceId}>
                  <div className="flex items-baseline gap-3">
                    <p className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[#1e293b]">
                      {r.serviceName}
                    </p>
                    <p className="font-display text-[12.5px] font-semibold tabular-nums text-[var(--brand-ink-dark)]">
                      {r.count}
                    </p>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#edf4f8]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[var(--brand-bright)] to-[var(--brand-deep)]"
                      style={{ width: `${Math.max(4, share)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

import { Megaphone, Pin } from 'lucide-react';
import { EmptyNote, InlineNotice } from './app-ui';
import type { Announcement } from '../lib/api';
import { cn } from '../lib/utils';

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

/**
 * The announcements feed shared by the staff and admin dashboards. Both used to
 * carry their own copy of this list; one component keeps the rows identical.
 */
export function AnnouncementList({
  announcements,
  error,
  limit = 3,
  emptyMessage = 'No announcements yet. New posts from the center will show up here.',
  className,
}: {
  announcements: Announcement[] | null;
  error?: boolean;
  limit?: number;
  emptyMessage?: string;
  className?: string;
}) {
  if (error) return <InlineNotice>Couldn't load announcements right now.</InlineNotice>;
  if (announcements === null) return <EmptyNote>Loading announcements…</EmptyNote>;
  if (announcements.length === 0) return <EmptyNote>{emptyMessage}</EmptyNote>;

  return (
    <ul className={cn('divide-y divide-[#eaf0f6]', className)}>
      {announcements.slice(0, limit).map((a) => (
        <li key={a.id} className="py-3.5 first:pt-0 last:pb-0">
          <div className="flex items-center gap-2">
            {a.pinned ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#fdf5e4] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#8a5a10] ring-1 ring-inset ring-[#e2c07a]/50">
                <Pin size={10} aria-hidden /> Pinned
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--brand-tint)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--brand-deep-strong)] ring-1 ring-inset ring-[var(--brand-deep)]/15">
                <Megaphone size={10} aria-hidden /> Announcement
              </span>
            )}
            <span className="ml-auto shrink-0 text-[11px] tabular-nums text-[#94a3b8]">
              {formatShortDate(a.publishedAt)}
            </span>
          </div>
          <p className="mt-1.5 text-[13.5px] font-semibold leading-snug text-[var(--brand-ink-dark)]">{a.title}</p>
          <p className="mt-1 line-clamp-2 text-[12.5px] leading-5 text-[#64748b]">{a.body}</p>
        </li>
      ))}
    </ul>
  );
}

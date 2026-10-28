import { useState, type ReactNode } from 'react';
import { ChevronDown, Megaphone, Pin } from 'lucide-react';
import { CATEGORY_LABELS, type Announcement } from '../lib/api';
import { cn } from '../lib/utils';
import { EmptyNote, cardPadding } from './app-ui';

const CATEGORY_STYLE: Record<Announcement['category'], string> = {
  'schedule-change': 'bg-amber-600/10 text-amber-800',
  'vaccination-day': 'bg-teal-600/10 text-teal-800',
  'health-advisory': 'bg-sky-600/10 text-sky-800',
  general: 'bg-slate-500/10 text-slate-700',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Shared reader used by the public page, the patient feed and the staff feed. */
export function AnnouncementFeed({
  items,
  actions,
  emptyNote,
}: {
  items: Announcement[];
  /** Optional row actions (edit/delete) — used by the staff composer list. */
  actions?: (item: Announcement) => ReactNode;
  emptyNote?: ReactNode;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (items.length === 0) {
    return (
      <EmptyNote className="px-5 py-6">
        {emptyNote ?? (
          <>
            No announcements yet. New posts from the center — schedule changes, vaccination days, health advisories —
            will appear here.
          </>
        )}
      </EmptyNote>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((a) => {
        const open = openId === a.id;
        return (
          <article
            key={a.id}
            className={cn(
              `app-card ${cardPadding}`,
              a.pinned && 'ring-1 ring-teal-600/25',
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {a.pinned && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-teal-700 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-white">
                    <Pin size={11} aria-hidden /> Pinned
                  </span>
                )}
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.06em]',
                    CATEGORY_STYLE[a.category],
                  )}
                >
                  <Megaphone size={11} aria-hidden />
                  {CATEGORY_LABELS[a.category]}
                </span>
                {formatDate(a.publishedAt) && (
                  <span className="text-[11.5px] text-slate-400">{formatDate(a.publishedAt)}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setOpenId(open ? null : a.id)}
                aria-expanded={open}
                aria-label={open ? `Hide full text of ${a.title}` : `Show full text of ${a.title}`}
                className="-mr-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 active:scale-[0.97]"
              >
                <ChevronDown size={17} className={cn('transition-transform duration-200', open && 'rotate-180')} />
              </button>
            </div>
            <h3 className="mt-2 font-display text-[15px] font-semibold leading-snug tracking-[-0.01em] text-slate-900">
              {a.title}
            </h3>
            <p
              className={cn(
                'mt-1 text-[13.5px] leading-6 text-slate-600 [overflow-wrap:anywhere]',
                !open && 'line-clamp-2',
              )}
            >
              {a.body}
            </p>
            {actions && <div className="mt-3.5 border-t border-slate-200/70 pt-3.5">{actions(a)}</div>}
          </article>
        );
      })}
    </div>
  );
}

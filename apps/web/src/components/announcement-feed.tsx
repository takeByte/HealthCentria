import { useState, type ReactNode } from 'react';
import { ChevronDown, Megaphone, Pin } from 'lucide-react';
import { CATEGORY_LABELS, type Announcement } from '../lib/api';
import { cn } from '../lib/utils';
import { EmptyNote, cardPadding } from './app-ui';
import { ImageGallery } from './announcement-images';
import { RecordMeta } from './record-meta';

const CATEGORY_STYLE: Record<Announcement['category'], string> = {
  'schedule-change': 'bg-amber-600/10 text-amber-800',
  'vaccination-day': 'bg-[#1f55a8]/10 text-[#1a448a]',
  'health-advisory': 'bg-sky-600/10 text-sky-800',
  general: 'bg-slate-500/10 text-slate-700',
};

function relativeTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 45) return 'Just now';
  const min = Math.round(sec / 60);
  if (min < 60) return min + 'm ago';
  const hr = Math.round(min / 60);
  if (hr < 24) return hr + 'h ago';
  const day = Math.round(hr / 24);
  if (day < 7) return day + 'd ago';
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function initials(name?: string): string {
  const parts = (name ?? '').trim().split(/s+/).filter(Boolean);
  if (parts.length === 0) return 'HC';
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function wasEdited(a: Announcement): boolean {
  if (!a.updatedAt || !a.createdAt) return false;
  return new Date(a.updatedAt).getTime() - new Date(a.createdAt).getTime() > 2000;
}

/** Shared reader used by the public page, the patient feed and the staff feed. */
export function AnnouncementFeed({
  items,
  actions,
  emptyNote,
  collapsible = true,
}: {
  items: Announcement[];
  /** Optional row actions (edit/delete) — used by the staff composer list. */
  actions?: (item: Announcement) => ReactNode;
  emptyNote?: ReactNode;
  /** When false the body is always shown in full (public reader). */
  collapsible?: boolean;
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
              a.pinned && 'ring-1 ring-[#1f55a8]/25',
            )}
          >
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#1695de] to-[#123c78] text-[13px] font-bold text-white"
              >
                {initials(a.authorName)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-1.5 text-[13.5px] font-semibold leading-5 text-slate-900">
                  <span className="truncate">{a.authorName || 'Health Center'}</span>
                  {a.authorRole && (
                    <span className="rounded-full bg-slate-100 px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.06em] text-slate-600">
                      {a.authorRole === 'admin' ? 'Admin' : 'Staff'}
                    </span>
                  )}
                </p>
                <p className="text-[11.5px] leading-5 text-slate-500">
                  <time
                    dateTime={a.publishedAt}
                    title={new Date(a.publishedAt).toLocaleString('en-PH', {
                      dateStyle: 'long',
                      timeStyle: 'short',
                    })}
                  >
                    {relativeTime(a.publishedAt)}
                  </time>
                  {wasEdited(a) && (
                    <span title={'Edited ' + new Date(a.updatedAt as string).toLocaleString('en-PH')}>
                      {' '}· Edited
                    </span>
                  )}
                </p>
              </div>
              {collapsible && (
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : a.id)}
                  aria-expanded={open}
                  aria-label={open ? `Hide full text of ${a.title}` : `Show full text of ${a.title}`}
                  className="-mr-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 active:scale-[0.97]"
                >
                  <ChevronDown size={17} className={cn('transition-transform duration-200', open && 'rotate-180')} />
                </button>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {a.pinned && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#1f55a8] px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-white">
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
            </div>
            <h3 className="mt-2 font-display text-[15px] font-semibold leading-snug tracking-[-0.01em] text-slate-900">
              {a.title}
            </h3>
            <p
              className={cn(
                'mt-1 whitespace-pre-line text-[13.5px] leading-6 text-slate-600 [overflow-wrap:anywhere]',
                !open && collapsible && 'line-clamp-2',
              )}
            >
              {a.body}
            </p>
            <ImageGallery images={a.images ?? []} />
            {actions && (
              <RecordMeta
                createdAt={a.createdAt ?? a.publishedAt}
                updatedAt={a.updatedAt}
                updatedByName={a.updatedByName}
                className="mt-2"
              />
            )}
            {actions && <div className="mt-3.5 border-t border-slate-200/70 pt-3.5">{actions(a)}</div>}
          </article>
        );
      })}
    </div>
  );
}

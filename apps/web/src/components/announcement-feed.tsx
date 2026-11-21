import { useMemo, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  Bookmark,
  Check,
  ChevronDown,
  Megaphone,
  Pin,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { CATEGORY_LABELS, type Announcement, type AnnouncementCategory } from '../lib/api';
import { cn } from '../lib/utils';
import { EmptyNote } from './app-ui';
import { ImageGallery } from './announcement-images';

const CATEGORY_STYLE: Record<Announcement['category'], string> = {
  'schedule-change': 'bg-[#fdf5e4] text-[#8a5a10] ring-[#e2c07a]/50',
  'vaccination-day': 'bg-[var(--brand-tint)] text-[var(--brand-deep-strong)] ring-[var(--brand-deep)]/20',
  'health-advisory': 'bg-[var(--brand-sky)]/30 text-[var(--brand-ink)] ring-[var(--brand-sky)]/70',
  general: 'bg-slate-500/10 text-slate-700 ring-slate-500/20',
};

const FILTERS: Array<{ key: 'all' | 'pinned' | AnnouncementCategory; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'pinned', label: 'Pinned' },
  { key: 'schedule-change', label: 'Schedule Change' },
  { key: 'vaccination-day', label: 'Vaccination' },
  { key: 'health-advisory', label: 'Health Advisory' },
  { key: 'general', label: 'General' },
];

const BOOKMARK_KEY = 'healthcentria.announcements.bookmarks';

function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function initials(name?: string): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'HC';
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function wasEdited(a: Announcement): boolean {
  if (!a.updatedAt || !a.createdAt) return false;
  return new Date(a.updatedAt).getTime() - new Date(a.createdAt).getTime() > 2000;
}

function readBookmarks(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(BOOKMARK_KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveBookmarks(ids: Set<string>) {
  try {
    localStorage.setItem(BOOKMARK_KEY, JSON.stringify([...ids]));
  } catch {
    // Private mode: the toggle still works for this visit to the screen.
  }
}

function CategoryTag({ category }: { category: AnnouncementCategory }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.06em] ring-1 ring-inset',
        CATEGORY_STYLE[category],
      )}
    >
      <Megaphone size={10} aria-hidden />
      {CATEGORY_LABELS[category]}
    </span>
  );
}

/**
 * Shared reader used by the public page, the patient feed and the staff feed.
 *
 * The card layout follows the announcement mockup: tags, title, a two-line
 * excerpt, optional thumbnail and an author footer. The date rail some designs
 * put beside the card is deliberately not used; the date lives in the footer
 * where it belongs to the author line.
 */
export function AnnouncementFeed({
  items,
  actions,
  emptyNote,
  collapsible = true,
  toolbar = true,
}: {
  items: Announcement[];
  /** Optional row actions (edit/delete) — used by the staff composer list. */
  actions?: (item: Announcement) => ReactNode;
  emptyNote?: ReactNode;
  /** When false the body is always shown in full (public reader). */
  collapsible?: boolean;
  /** Search, category pills, sort and the count row. */
  toolbar?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'pinned' | AnnouncementCategory>('all');
  const [sort, setSort] = useState<'newest' | 'oldest' | 'pinned'>('newest');
  const [bookmarks, setBookmarks] = useState<Set<string>>(readBookmarks);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = items.filter((a) => {
      const matchesFilter =
        filter === 'all' ||
        (filter === 'pinned' ? a.pinned : a.category === filter);
      const matchesQuery =
        !q ||
        a.title.toLowerCase().includes(q) ||
        a.body.toLowerCase().includes(q) ||
        (a.authorName ?? '').toLowerCase().includes(q);
      return matchesFilter && matchesQuery;
    });
    return [...filtered].sort((a, b) => {
      if (sort === 'oldest') return new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime();
      if (sort === 'pinned' && a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    });
  }, [items, query, filter, sort]);

  function toggleBookmark(id: string) {
    setBookmarks((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveBookmarks(next);
      return next;
    });
  }

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
    <div className="space-y-4">
      {toolbar && (
        <div className="space-y-2.5">
          <p className="text-right text-[11.5px] font-medium text-slate-500">
            {visible.length} announcement{visible.length === 1 ? '' : 's'}
            {visible.length !== items.length && ` of ${items.length}`}
          </p>
          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center">
            <div className="relative min-w-0 lg:flex-1">
              <Search
                size={17}
                aria-hidden
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search announcements…"
                aria-label="Search announcements by title, message or author"
                className="h-11 w-full rounded-full border border-slate-200 bg-white pl-11 pr-4 text-[13.5px] text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-[var(--brand-deep)] focus:ring-2 focus:ring-[var(--brand-deep)]/20"
              />
            </div>
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter announcements">
              {FILTERS.map((option) => {
                const active = filter === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setFilter(option.key)}
                    className={cn(
                      'inline-flex h-9 items-center rounded-full px-3.5 text-[12.5px] font-semibold transition-colors active:scale-[0.98]',
                      active
                        ? 'bg-[var(--brand-deep)] text-white shadow-[0_8px_18px_-12px_rgba(13,71,161,0.8)]'
                        : 'border border-slate-200 bg-white text-slate-600 hover:border-[var(--brand-deep)]/30 hover:text-[var(--brand-deep)]',
                    )}
                  >
                    {option.key === 'all' && active ? <Check size={13} aria-hidden /> : null}
                    {option.label}
                  </button>
                );
              })}
            </div>
            <label className="relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white pl-2.5 pr-1.5 text-[12.5px] font-medium text-slate-600">
              <SlidersHorizontal size={14} aria-hidden className="text-slate-400" />
              <span className="whitespace-nowrap">Sort by:</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as 'newest' | 'oldest' | 'pinned')}
                aria-label="Sort announcements"
                className="h-8 cursor-pointer appearance-none rounded-md bg-transparent pr-6 text-[12.5px] font-semibold text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-deep)]/25"
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="pinned">Pinned first</option>
              </select>
              <ChevronDown size={14} aria-hidden className="pointer-events-none absolute right-2 text-slate-500" />
            </label>
          </div>
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyNote className="px-5 py-6">No announcements match this search.</EmptyNote>
      ) : (
        <div className="space-y-3">
          {visible.map((a) => {
            const open = collapsible && openId === a.id;
            const saved = bookmarks.has(a.id);
            const canExpand = collapsible && a.body.length > 150;
            const bodyId = `announcement-body-${a.id}`;
            const thumbnail = (a.images ?? [])[0];

            return (
              <article
                key={a.id}
                className={cn(
                  'app-card overflow-hidden p-5 sm:p-6',
                  a.pinned && 'ring-1 ring-[var(--brand-deep)]/25',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <CategoryTag category={a.category} />
                    {a.pinned && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#fdf5e4] px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-[#8a5a10] ring-1 ring-inset ring-[#e2c07a]/50">
                        <Pin size={10} aria-hidden />
                        Pinned
                      </span>
                    )}
                  </div>
                  {collapsible && (
                    <button
                      type="button"
                      onClick={() => setOpenId(open ? null : a.id)}
                      aria-expanded={open}
                      aria-controls={bodyId}
                      aria-label={open ? `Hide full text of ${a.title}` : `Show full text of ${a.title}`}
                      className="-mr-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 active:scale-[0.97]"
                    >
                      <ChevronDown size={18} className={cn('transition-transform duration-200', open && 'rotate-180')} />
                    </button>
                  )}
                </div>

                <div className="mt-2.5 flex items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-display text-[17px] font-semibold leading-snug tracking-[-0.015em] text-slate-900 sm:text-[18.5px]">
                      {a.title}
                    </h3>
                    <p
                      id={bodyId}
                      className={cn(
                        'mt-1.5 whitespace-pre-line text-[13.5px] leading-6 text-slate-600 [overflow-wrap:anywhere]',
                        !open && 'line-clamp-2',
                      )}
                    >
                      {a.body}
                    </p>
                  </div>
                  {thumbnail && !open && (
                    <img
                      src={thumbnail.url}
                      alt={thumbnail.alt || ''}
                      loading="lazy"
                      className="hidden size-20 shrink-0 rounded-xl object-cover ring-1 ring-slate-200/80 sm:block"
                    />
                  )}
                </div>

                {open && (a.images ?? []).length > 0 && <ImageGallery images={a.images} />}

                <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/70 pt-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      aria-hidden
                      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--brand-tint)] text-[11px] font-bold text-[var(--brand-deep-strong)] ring-1 ring-inset ring-[var(--brand-deep)]/15"
                    >
                      {initials(a.authorName)}
                    </span>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] leading-5 text-slate-500">
                        <span className="truncate font-semibold text-slate-800">
                          {a.authorName || 'Health Center'}
                        </span>
                        {a.authorRole && (
                          <span className="rounded-full bg-slate-100 px-1.5 py-px text-[9.5px] font-bold uppercase tracking-[0.06em] text-slate-600">
                            {a.authorRole === 'admin' ? 'Admin' : 'Staff'}
                          </span>
                        )}
                        <span aria-hidden className="text-slate-300">
                          ·
                        </span>
                        <time
                          dateTime={a.publishedAt}
                          title={new Date(a.publishedAt).toLocaleString('en-PH', {
                            dateStyle: 'long',
                            timeStyle: 'short',
                          })}
                        >
                          {formatDay(a.publishedAt)}
                        </time>
                        {wasEdited(a) && (
                          <span
                            className="text-[11px] text-slate-400"
                            title={'Edited ' + new Date(a.updatedAt as string).toLocaleString('en-PH')}
                          >
                            (Edited)
                          </span>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    {canExpand && (
                      <button
                        type="button"
                        onClick={() => setOpenId(open ? null : a.id)}
                        aria-expanded={open}
                        aria-controls={bodyId}
                        className="group inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-semibold text-[var(--brand-deep)] transition-colors hover:bg-[var(--brand-deep)]/10 active:scale-[0.98]"
                      >
                        {open ? 'Show less' : 'Read more'}
                        <ArrowRight
                          size={14}
                          aria-hidden
                          className={cn('transition-transform duration-200', open ? '-rotate-90' : 'group-hover:translate-x-0.5')}
                        />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleBookmark(a.id)}
                      aria-pressed={saved}
                      aria-label={saved ? `Remove bookmark from ${a.title}` : `Bookmark ${a.title}`}
                      title={saved ? 'Remove bookmark' : 'Save for later'}
                      className={cn(
                        'flex size-8 items-center justify-center rounded-lg transition-colors active:scale-[0.97]',
                        saved
                          ? 'text-[var(--brand-deep)] hover:bg-[var(--brand-deep)]/10'
                          : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700',
                      )}
                    >
                      <Bookmark size={16} aria-hidden className={saved ? 'fill-current' : undefined} />
                    </button>
                  </div>
                </div>

                {actions && <div className="mt-3.5 border-t border-slate-200/70 pt-3.5">{actions(a)}</div>}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

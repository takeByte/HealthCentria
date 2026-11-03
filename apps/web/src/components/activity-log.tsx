import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  Download,
  LoaderCircle,
  Search,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import {
  ACTIVITY_CATEGORY_LABELS,
  ApiError,
  downloadActivityCsv,
  listActivity,
  listMyActivity,
  listOwnActivity,
  purgeActivity,
  type ActivityCategory,
  type ActivityEntry,
  type ActivityFilters,
  type ActivityPage,
} from '../lib/api';
import {
  EmptyNote,
  InlineNotice,
  SuccessNote,
  chipButton,
  dangerChipButton,
  fieldLabel,
  inputClass,
  panel,
  secondaryButton,
} from './app-ui';
import { formatDateTime } from './record-meta';
import { cn } from '../lib/utils';

type Scope = 'admin' | 'staff' | 'patient';
type Preset = 'today' | '7d' | '30d' | 'all' | 'custom';

const CATEGORIES = Object.keys(ACTIVITY_CATEGORY_LABELS) as ActivityCategory[];

const CATEGORY_STYLE: Record<ActivityCategory, string> = {
  auth: 'bg-slate-500/10 text-slate-700 ring-slate-500/20',
  appointments: 'bg-sky-600/10 text-sky-800 ring-sky-600/20',
  clinical: 'bg-teal-600/10 text-teal-800 ring-teal-600/20',
  people: 'bg-amber-500/10 text-amber-800 ring-amber-600/25',
  content: 'bg-indigo-500/10 text-indigo-800 ring-indigo-600/20',
  configuration: 'bg-amber-500/10 text-amber-800 ring-amber-600/25',
  system: 'bg-slate-500/10 text-slate-600 ring-slate-500/20',
};

/** Plain-language labels — the stored action stays machine-readable. */
const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Signed in',
  'auth.login_failed': 'Failed sign-in',
  'auth.logout': 'Signed out',
  'auth.register': 'Registered an account',
  'appointment.book': 'Appointment requested',
  'appointment.confirm': 'Appointment confirmed',
  'appointment.decline': 'Appointment declined',
  'appointment.cancel': 'Appointment cancelled',
  'appointment.complete': 'Visit completed',
  'appointment.walkin': 'Walk-in recorded',
  'patient.update': 'Patient record edited',
  'record.update': 'Clinical record edited',
  'patient.create': 'Patient account created',
  'staff.create': 'Staff account created',
  'staff.update': 'Staff account updated',
  'announcement.create': 'Announcement published',
  'announcement.update': 'Announcement edited',
  'announcement.delete': 'Announcement deleted',
  'service.create': 'Service added',
  'service.update': 'Service updated',
  'settings.google.update': 'Google credentials updated',
  'settings.google.reset': 'Google credentials reset',
  'settings.signin.update': 'Sign-in setting changed',
  'integration.update': 'Integration updated',
  'activity.purge': 'Activity log purged',
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/[._]/g, ' ');
}

function fieldLabelText(field: string): string {
  return field.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

function ymd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function presetRange(preset: Preset, customFrom: string, customTo: string): { from?: string; to?: string } {
  const today = new Date();
  if (preset === 'all') return {};
  if (preset === 'custom') return { from: customFrom || undefined, to: customTo || undefined };
  if (preset === 'today') return { from: ymd(today), to: ymd(today) };
  const days = preset === '7d' ? 7 : 30;
  const start = new Date(today);
  start.setDate(start.getDate() - (days - 1));
  return { from: ymd(start), to: ymd(today) };
}

function CategoryPill({ category }: { category: ActivityCategory }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.05em] ring-1 ring-inset',
        CATEGORY_STYLE[category] ?? CATEGORY_STYLE.system,
      )}
    >
      {ACTIVITY_CATEGORY_LABELS[category] ?? category}
    </span>
  );
}

export function ActivityFeed({
  scope,
  showExport = false,
  showPurge = false,
  limit = 20,
  compact = false,
  className,
}: {
  scope: Scope;
  showExport?: boolean;
  showPurge?: boolean;
  limit?: number;
  compact?: boolean;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [category, setCategory] = useState<ActivityCategory | 'all'>('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [actor, setActor] = useState('');
  const [preset, setPreset] = useState<Preset>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [meta, setMeta] = useState<{ total: number; pages: number; retentionDays: number } | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purging, setPurging] = useState(false);
  const [purgeResult, setPurgeResult] = useState<string | null>(null);
  const [purgeError, setPurgeError] = useState<string | null>(null);

  // Typing shouldn't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { from, to } = presetRange(preset, customFrom, customTo);

  const refresh = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    let cancelled = false;
    const filters: ActivityFilters = {
      category,
      q: query || undefined,
      actor: scope === 'admin' && actor.trim() ? actor.trim() : undefined,
      from,
      to,
      page: 1,
      limit,
    };
    const fetcher = scope === 'admin' ? listActivity : scope === 'staff' ? listMyActivity : listOwnActivity;

    setLoading(true);
    setError(null);
    fetcher(filters)
      .then((r: ActivityPage) => {
        if (cancelled) return;
        setEntries(r.entries);
        setMeta({ total: r.total, pages: r.pages, retentionDays: r.retentionDays });
        setPage(1);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setEntries([]);
          setError(err instanceof ApiError ? err.message : 'Could not load the activity log.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [scope, category, query, actor, from, to, limit, refreshKey]);

  async function loadMore() {
    if (!meta || page >= meta.pages) return;
    const next = page + 1;
    setLoadingMore(true);
    try {
      const fetcher = scope === 'admin' ? listActivity : scope === 'staff' ? listMyActivity : listOwnActivity;
      const r = await fetcher({
        category,
        q: query || undefined,
        actor: scope === 'admin' && actor.trim() ? actor.trim() : undefined,
        from,
        to,
        page: next,
        limit,
      });
      setEntries((current) => [...(current ?? []), ...r.entries]);
      setMeta({ total: r.total, pages: r.pages, retentionDays: r.retentionDays });
      setPage(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load more entries.');
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleExport() {
    setExportError(null);
    setExporting(true);
    try {
      await downloadActivityCsv({ category, q: query || undefined, actor: actor.trim() || undefined, from, to });
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : 'Could not export the log.');
    } finally {
      setExporting(false);
    }
  }

  async function handlePurge() {
    setPurgeError(null);
    setPurging(true);
    try {
      const r = await purgeActivity();
      setPurgeOpen(false);
      setPurgeResult(
        r.deleted === 0
          ? 'Nothing was old enough to purge — every entry is inside the retention window.'
          : `Purged ${r.deleted} entr${r.deleted === 1 ? 'y' : 'ies'} older than ${formatDateTime(r.cutoff)}.`,
      );
      refresh();
    } catch (err) {
      setPurgeError(err instanceof ApiError ? err.message : 'Could not purge the log.');
    } finally {
      setPurging(false);
    }
  }

  const retentionDays = meta?.retentionDays ?? 365;

  return (
    <div className={cn('space-y-4', className)}>
      {compact ? null : (
        <section className={cn(panel, 'py-4')}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search
                size={16}
                aria-hidden
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search action, person, or record…"
                aria-label="Search activity"
                className={`${inputClass} pl-10`}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <select
                value={preset}
                onChange={(e) => setPreset(e.target.value as Preset)}
                aria-label="Date range"
                className={`${inputClass} h-11 w-auto min-w-36`}
              >
                <option value="today">Today</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="all">All time</option>
                <option value="custom">Custom range</option>
              </select>
              {showExport && (
                <button
                  type="button"
                  onClick={handleExport}
                  disabled={exporting}
                  className={`${secondaryButton} h-11 px-4 text-[13px]`}
                >
                  {exporting ? (
                    <LoaderCircle size={15} className="animate-spin" aria-hidden />
                  ) : (
                    <Download size={15} aria-hidden />
                  )}
                  Export CSV
                </button>
              )}
              {showPurge && (
                <button
                  type="button"
                  onClick={() => {
                    setPurgeResult(null);
                    setPurgeError(null);
                    setPurgeOpen(true);
                  }}
                  className={`${dangerChipButton} h-11 px-4`}
                >
                  <Trash2 size={15} aria-hidden /> Purge expired
                </button>
              )}
            </div>
          </div>

          {preset === 'custom' && (
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="activity-from" className={fieldLabel}>
                  From
                </label>
                <input
                  id="activity-from"
                  type="date"
                  value={customFrom}
                  max={customTo || undefined}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className={`${inputClass} w-auto`}
                />
              </div>
              <div>
                <label htmlFor="activity-to" className={fieldLabel}>
                  To
                </label>
                <input
                  id="activity-to"
                  type="date"
                  value={customTo}
                  min={customFrom || undefined}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className={`${inputClass} w-auto`}
                />
              </div>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setCategory('all')}
              aria-pressed={category === 'all'}
              className={cn(
                'h-8 rounded-full px-3 text-[12px] font-semibold transition-colors',
                category === 'all'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
              )}
            >
              All
            </button>
            {CATEGORIES.filter((c) => (scope === 'staff' ? c !== 'configuration' : true)).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(category === c ? 'all' : c)}
                aria-pressed={category === c}
                className={cn(
                  'h-8 rounded-full px-3 text-[12px] font-semibold transition-colors',
                  category === c ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                )}
              >
                {ACTIVITY_CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>

          {scope === 'admin' && (
            <div className="mt-3">
              <label htmlFor="activity-actor" className="sr-only">
                Filter by actor
              </label>
              <input
                id="activity-actor"
                value={actor}
                onChange={(e) => setActor(e.target.value)}
                placeholder="Filter by actor name or id…"
                className={`${inputClass} h-10 max-w-xs text-[13px]`}
              />
            </div>
          )}
        </section>
      )}

      {exportError && <InlineNotice>{exportError}</InlineNotice>}
      {purgeResult && <SuccessNote>{purgeResult}</SuccessNote>}
      {error && <InlineNotice>{error}</InlineNotice>}

      <section className={cn(panel, 'p-0')}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-200/70 px-4 py-3 sm:px-5">
          <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-slate-500">
            {compact ? 'Recent activity' : 'Entries'}
          </p>
          <p className="text-[11.5px] text-slate-500">
            {entries === null ? 'Loading…' : `${entries.length} of ${meta?.total ?? 0}`}
          </p>
        </div>

        {entries === null && (
          <p className="px-4 py-6 text-[13px] text-slate-500 sm:px-5">Loading activity…</p>
        )}

        {entries !== null && entries.length === 0 && !loading && (
          <div className="px-4 py-4 sm:px-5">
            <EmptyNote>
              {scope === 'patient'
                ? 'Nothing here yet. Your bookings, visits and profile edits will appear as they happen.'
                : 'No entries match these filters.'}
            </EmptyNote>
          </div>
        )}

        {entries !== null && entries.length > 0 && (
          <ul className="divide-y divide-slate-200/70">
            {entries.map((entry) => {
              const isOpen = expanded === entry.id;
              const hasDetail = entry.changes.length > 0 || Boolean(entry.detail) || Boolean(entry.ip);
              return (
                <li key={entry.id} className="px-4 py-3 sm:px-5">
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : entry.id)}
                    aria-expanded={isOpen}
                    disabled={!hasDetail}
                    className={cn(
                      'flex w-full items-start gap-3 rounded-xl text-left',
                      hasDetail ? 'cursor-pointer' : 'cursor-default',
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'mt-1 size-2 shrink-0 rounded-full',
                        entry.outcome === 'failed' ? 'bg-red-500' : 'bg-teal-500',
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[13.5px] font-semibold leading-snug text-slate-900">
                          {actionLabel(entry.action)}
                        </span>
                        <CategoryPill category={entry.category} />
                        {entry.outcome === 'failed' && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.05em] text-red-700 ring-1 ring-inset ring-red-600/20">
                            <ShieldAlert size={10} aria-hidden /> Failed
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-[12.5px] leading-5 text-slate-600">
                        {entry.actor.name || 'Unknown actor'}
                        {entry.actor.role ? ` · ${entry.actor.role}` : ''}
                        {entry.target.label && entry.target.label !== entry.actor.name
                          ? ` → ${entry.target.label}`
                          : ''}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-slate-400">
                        {formatDateTime(entry.createdAt)}
                        {entry.changes.length > 0 &&
                          ` · ${entry.changes.length} field${entry.changes.length === 1 ? '' : 's'} changed`}
                      </span>
                    </span>
                    {hasDetail && (
                      <ChevronDown
                        size={16}
                        aria-hidden
                        className={cn('mt-1 shrink-0 text-slate-400 transition-transform', isOpen && 'rotate-180')}
                      />
                    )}
                  </button>

                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
                        animate={reduceMotion ? { opacity: 1 } : { opacity: 1, height: 'auto' }}
                        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-2.5 rounded-xl bg-slate-50/90 p-3.5">
                          {entry.detail && (
                            <p className="text-[12.5px] leading-5 text-slate-700">{entry.detail}</p>
                          )}

                          {entry.changes.length > 0 && (
                            <dl className="mt-2 space-y-2">
                              {entry.changes.map((c, i) => (
                                <div key={`${c.field}-${i}`} className="grid gap-1 sm:grid-cols-[9rem_1fr]">
                                  <dt className="text-[11px] font-bold uppercase tracking-[0.05em] text-slate-500">
                                    {fieldLabelText(c.field)}
                                  </dt>
                                  <dd className="flex flex-wrap items-center gap-1.5 text-[12.5px] leading-5">
                                    <span className="rounded-md bg-red-50 px-1.5 py-0.5 text-red-700 line-through decoration-red-300">
                                      {c.from || '—'}
                                    </span>
                                    <span aria-hidden className="text-slate-400">→</span>
                                    <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-emerald-800">
                                      {c.to || '—'}
                                    </span>
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          )}

                          <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-slate-400">
                            {entry.ip && <span>IP {entry.ip}</span>}
                            {entry.userAgent && <span className="truncate">{entry.userAgent}</span>}
                          </p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                </li>
              );
            })}
          </ul>
        )}

        {entries !== null && meta && page < meta.pages && (
          <div className="border-t border-slate-200/70 px-4 py-3 sm:px-5">
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className={`${chipButton} w-full`}
            >
              {loadingMore && <LoaderCircle size={14} className="animate-spin" aria-hidden />}
              Load more entries
            </button>
          </div>
        )}
      </section>

      {compact ? null : (
        <p className="flex items-start gap-2 px-1 text-[11.5px] leading-5 text-slate-500">
          <AlertTriangle size={13} aria-hidden className="mt-0.5 shrink-0 text-slate-400" />
          <span>
            Entries are append-only and read-only. Logs are kept for {retentionDays} days; only an admin can purge
            expired entries, and every purge is itself logged.
          </span>
        </p>
      )}

      <AnimatePresence>
        {purgeOpen && (
          <>
            <motion.div
              aria-hidden
              onClick={() => (purging ? null : setPurgeOpen(false))}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-40 bg-slate-900/40"
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="purge-title"
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
              animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
              transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
              className="fixed inset-x-4 top-1/4 z-50 mx-auto max-w-md rounded-2xl border border-white/70 bg-white p-6 shadow-2xl sm:inset-x-0"
            >
              <h2 id="purge-title" className="font-display text-[17px] font-semibold tracking-[-0.02em] text-slate-900">
                Purge expired entries?
              </h2>
              <p className="mt-2 text-[13px] leading-6 text-slate-600">
                This permanently deletes activity entries older than {retentionDays} days. Recent entries are never
                touched. The purge itself is recorded as a new entry with your name, the time, and how many rows were
                removed.
              </p>
              {purgeError && <InlineNotice className="mt-3">{purgeError}</InlineNotice>}
              <div className="mt-5 flex gap-2">
                <button
                  type="button"
                  onClick={handlePurge}
                  disabled={purging}
                  className={`${dangerChipButton} h-11 flex-1`}
                >
                  {purging && <LoaderCircle size={15} className="animate-spin" aria-hidden />}
                  Purge expired entries
                </button>
                <button
                  type="button"
                  onClick={() => setPurgeOpen(false)}
                  disabled={purging}
                  className={`${secondaryButton} flex-1`}
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

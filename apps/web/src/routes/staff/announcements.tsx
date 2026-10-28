import { createFileRoute } from '@tanstack/react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { LoaderCircle, Plus, Search } from 'lucide-react';
import { AnnouncementFeed } from '../../components/announcement-feed';
import { DashboardShell } from '../../components/dashboard-shell';
import { opsNav } from '../../components/ops-nav';
import {
  CardHeading,
  EmptyNote,
  InlineNotice,
  chipButton,
  dangerChipButton,
  fieldLabel,
  inputClass,
  panel,
  primaryButton,
  secondaryButton,
  selectClass,
  textareaClass,
} from '../../components/app-ui';
import { getSession } from '../../lib/auth';
import {
  ApiError,
  CATEGORY_LABELS,
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
  updateAnnouncement,
  type Announcement,
  type AnnouncementCategory,
} from '../../lib/api';
import { getTodayService } from '../../lib/schedule';

export const Route = createFileRoute('/staff/announcements')({
  component: StaffAnnouncements,
});

const CATEGORIES = Object.keys(CATEGORY_LABELS) as AnnouncementCategory[];

interface ComposerState {
  id?: string;
  title: string;
  body: string;
  category: AnnouncementCategory;
  pinned: boolean;
}

const emptyComposer: ComposerState = { title: '', body: '', category: 'general', pinned: false };

function StaffAnnouncements() {
  const reduceMotion = useReducedMotion();
  const session = getSession();
  const today = getTodayService();
  const isAdmin = session?.role === 'admin';
  const [items, setItems] = useState<Announcement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'all' | AnnouncementCategory>('all');

  useEffect(() => {
    let cancelled = false;
    listAnnouncements()
      .then((r) => {
        if (!cancelled) setItems(r.announcements);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load announcements.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!items) return null;
    const q = query.trim().toLowerCase();
    return items.filter((a) => {
      const matchesCategory = category === 'all' || a.category === category;
      const matchesQuery = !q || a.title.toLowerCase().includes(q) || a.body.toLowerCase().includes(q);
      return matchesCategory && matchesQuery;
    });
  }, [items, query, category]);

  async function submit() {
    if (!composer) return;
    if (!composer.title.trim() || !composer.body.trim()) {
      setFormError('Title and message are both required.');
      return;
    }
    setPending(true);
    setFormError(null);
    try {
      if (composer.id) {
        const r = await updateAnnouncement(composer.id, {
          title: composer.title.trim(),
          body: composer.body.trim(),
          category: composer.category,
          pinned: composer.pinned,
        });
        setItems((l) => (l ?? []).map((x) => (x.id === r.announcement.id ? r.announcement : x)));
      } else {
        const r = await createAnnouncement({
          title: composer.title.trim(),
          body: composer.body.trim(),
          category: composer.category,
          pinned: composer.pinned,
        });
        setItems((l) => [r.announcement, ...(l ?? [])]);
      }
      setComposer(null);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not publish. Try again.');
    } finally {
      setPending(false);
    }
  }

  async function remove(id: string) {
    setDeletingId(id);
    try {
      await deleteAnnouncement(id);
      setItems((l) => (l ?? []).filter((x) => x.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete. Try again.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <DashboardShell
      title="Announcements"
      subtitle="The shared feed visible to staff and patients, newest first"
      roleLabel={isAdmin ? 'Admin' : 'Staff'}
      userName={session?.name}
      userEmail={session?.email ?? ''}
      todayService={`${today.name} — ${today.detail}`}
      nav={opsNav(session?.role)}
      notificationsTo="/staff/notifications"
    >
      <motion.section
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
        className={`${panel} py-4`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardHeading
              title="Center announcements"
              description={
                items === null
                  ? 'Loading the feed…'
                  : `${items.length} post${items.length === 1 ? '' : 's'} · ${items.filter((a) => a.pinned).length} pinned · shared with patients`
              }
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setFormError(null);
              setComposer({ ...emptyComposer });
            }}
            className={`${primaryButton} h-10 shrink-0 px-4 text-[13px]`}
          >
            <Plus size={16} aria-hidden /> New post
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
          <div className="relative flex-1">
            <Search
              size={16}
              aria-hidden
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search announcements…"
              aria-label="Search announcements"
              className={`${inputClass} pl-10`}
            />
          </div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as 'all' | AnnouncementCategory)}
            aria-label="Filter by category"
            className={`${selectClass} sm:w-auto sm:min-w-44`}
          >
            <option value="all">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
      </motion.section>

      {error && <InlineNotice>{error}</InlineNotice>}
      {filtered === null && !error && <EmptyNote>Loading announcements…</EmptyNote>}
      {filtered !== null && (
        <motion.div
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
          transition={{ type: 'spring', bounce: 0, duration: 0.35, delay: 0.04 }}
          className="max-w-4xl"
        >
          <AnnouncementFeed
            items={filtered}
            emptyNote={
              items?.length === 0
                ? 'Nothing posted yet. Use “New post” to publish the first announcement.'
                : 'No announcements match this search.'
            }
            actions={(a) => (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setFormError(null);
                    setComposer({ id: a.id, title: a.title, body: a.body, category: a.category, pinned: a.pinned });
                  }}
                  className={chipButton}
                >
                  Edit
                </button>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => remove(a.id)}
                    disabled={deletingId === a.id}
                    aria-label={`Delete ${a.title}`}
                    className={dangerChipButton}
                  >
                    {deletingId === a.id ? (
                      <LoaderCircle size={14} className="animate-spin" aria-hidden />
                    ) : null}
                    Delete
                  </button>
                )}
              </div>
            )}
          />
        </motion.div>
      )}

      <p className="text-[12.5px] leading-5 text-slate-500">
        Publishing notifies registered patients by email and bell. Only admins can delete.
      </p>

      <AnimatePresence>
        {composer && (
          <>
            <motion.div
              aria-hidden
              onClick={() => setComposer(null)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-40 bg-slate-900/40"
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={composer.id ? 'Edit announcement' : 'New announcement'}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
              animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
              transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
              className="fixed inset-x-4 bottom-4 top-auto z-50 mx-auto max-w-lg rounded-2xl border border-white/70 bg-white/95 p-6 shadow-2xl backdrop-blur-xl sm:inset-0 sm:m-auto sm:h-fit"
            >
              <h2 className="font-display text-[17px] font-semibold tracking-[-0.02em] text-slate-900">
                {composer.id ? 'Edit post' : 'New post'}
              </h2>
              <p className="mt-1 text-[12.5px] leading-5 text-slate-500">
                Patients see this in their feed and receive a notification.
              </p>
              <div className="mt-4 space-y-4">
                <div>
                  <label htmlFor="ann-title" className={fieldLabel}>
                    Title *
                  </label>
                  <input
                    id="ann-title"
                    value={composer.title}
                    maxLength={200}
                    onChange={(e) => setComposer({ ...composer, title: e.target.value })}
                    placeholder="e.g. Prenatal moved to Wednesday this week"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="ann-category" className={fieldLabel}>
                    Category
                  </label>
                  <select
                    id="ann-category"
                    value={composer.category}
                    onChange={(e) => setComposer({ ...composer, category: e.target.value as AnnouncementCategory })}
                    className={selectClass}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="ann-body" className={fieldLabel}>
                    Message *
                  </label>
                  <textarea
                    id="ann-body"
                    rows={4}
                    maxLength={5000}
                    value={composer.body}
                    onChange={(e) => setComposer({ ...composer, body: e.target.value })}
                    placeholder="Write the announcement in plain language…"
                    className={textareaClass}
                  />
                </div>
                <label htmlFor="ann-pinned" className="flex cursor-pointer items-center gap-3 text-[13px] font-medium text-slate-700">
                  <input
                    id="ann-pinned"
                    type="checkbox"
                    checked={composer.pinned}
                    onChange={(e) => setComposer({ ...composer, pinned: e.target.checked })}
                    className="size-5 accent-teal-700"
                  />
                  Pin to the top of the feed
                </label>
                {formError && <InlineNotice>{formError}</InlineNotice>}
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={submit} disabled={pending} className={`${primaryButton} flex-1`}>
                    {pending && <LoaderCircle size={16} className="animate-spin" aria-hidden />}
                    {composer.id ? 'Save changes' : 'Publish to patients'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setComposer(null)}
                    disabled={pending}
                    className={`${secondaryButton} flex-1`}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </DashboardShell>
  );
}

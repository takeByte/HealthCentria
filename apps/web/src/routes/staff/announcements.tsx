import { useLiveRefresh } from '../../lib/realtime';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import { LoaderCircle, Lock, Plus } from 'lucide-react';
import { AnnouncementFeed } from '../../components/announcement-feed';
import { ImageUploader } from '../../components/image-uploader';
import { DashboardShell } from '../../components/dashboard-shell';
import { LockedActionButton } from '../../components/locked-action';
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
import { flash } from '../../lib/flash';
import {
  ApiError,
  CATEGORY_LABELS,
  createAnnouncement,
  deleteAnnouncement,
  getRecordLocks,
  isRecordLocked,
  listAnnouncements,
  updateAnnouncement,
  type Announcement,
  type AnnouncementImage,
  type AnnouncementCategory,
  type RecordLockInfo,
} from '../../lib/api';
import { lockRemaining, useRecordLock } from '../../lib/record-lock';
import { getTodayService } from '../../lib/schedule';
import { sessionCan } from '../../lib/permissions';

export const Route = createFileRoute('/staff/announcements')({
  beforeLoad: () => {
    const session = getSession();
    if (!sessionCan(session, 'announcements.manage')) throw redirect({ to: '/staff/dashboard' });
  },
  component: StaffAnnouncements,
});

const CATEGORIES = Object.keys(CATEGORY_LABELS) as AnnouncementCategory[];

interface ComposerState {
  id?: string;
  /** Version the editor started from. A list refresh must not change it, or conflicts go unnoticed. */
  version?: number;
  title: string;
  body: string;
  category: AnnouncementCategory;
  pinned: boolean;
  images: AnnouncementImage[];
}

const emptyComposer: ComposerState = { title: '', body: '', category: 'general', pinned: false, images: [] };

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
  // Who is editing each post, refreshed while the page is visible. The edit
  // form claims one post, so nobody else can open the same form and type.
  const [locksById, setLocksById] = useState<Record<string, RecordLockInfo>>({});

  const composerId = composer?.id ?? null;
  const recordLock = useRecordLock('announcements', composerId, !!composerId);

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

  // Lock changes do not emit a live event, so keep "being edited by" fresh
  // while the page is visible. Paused in a background tab.
  useEffect(() => {
    if (!items || items.length === 0) {
      setLocksById({});
      return;
    }
    let cancelled = false;
    const ids = items.map((a) => a.id);
    const load = () => {
      if (document.visibilityState !== 'visible') return;
      getRecordLocks('announcements', ids, recordLock.owner)
        .then((r) => {
          if (!cancelled) setLocksById(r.locks);
        })
        .catch(() => {
          // Best effort: the next poll retries.
        });
    };
    load();
    const timer = setInterval(load, 5_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [items, recordLock.owner]);

  /** Drop a released post from the badge map, so it does not linger until the next poll. */
  function forgetLock(id: string) {
    setLocksById((m) => {
      if (!m[id]) return m;
      const next = { ...m };
      delete next[id];
      return next;
    });
  }

  /** Give the post back before closing. Capped at 1 s so a slow release never traps the user. */
  async function releaseBeforeClose() {
    let timer: number | undefined;
    try {
      await Promise.race([
        recordLock.release(),
        new Promise<void>((resolve) => {
          timer = window.setTimeout(resolve, 1_000);
        }),
      ]);
    } finally {
      if (timer !== undefined) window.clearTimeout(timer);
    }
  }

  async function closeComposer() {
    await releaseBeforeClose();
    if (composerId) forgetLock(composerId);
    setComposer(null);
  }

  function startEdit(a: Announcement) {
    // The button is inert while held; this also covers a click landing between
    // polls, where the claim below reports the holder anyway.
    if (locksById[a.id]) return;
    setFormError(null);
    setComposer({
      id: a.id,
      version: a.version,
      title: a.title,
      body: a.body,
      category: a.category,
      pinned: a.pinned,
      images: a.images ?? [],
    });
  }

  async function submit() {
    if (!composer) return;
    if (!composer.title.trim() || !composer.body.trim()) {
      setFormError('Title and message are both required.');
      return;
    }
    if (composer.id && recordLock.heldByOther) {
      setFormError(
        `${recordLock.lock?.heldBy ?? 'Another staff member'} is editing this post. Wait for them to save or cancel.`,
      );
      return;
    }
    setPending(true);
    setFormError(null);
    try {
      if (composer.id) {
        const r = await updateAnnouncement(
          composer.id,
          {
            title: composer.title.trim(),
            body: composer.body.trim(),
            category: composer.category,
            pinned: composer.pinned,
            images: composer.images,
          },
          composer.version ?? 0,
          recordLock.owner,
        );
        setItems((l) => (l ?? []).map((x) => (x.id === r.announcement.id ? r.announcement : x)));
        flash('Announcement saved.');
      } else {
        const r = await createAnnouncement({
          title: composer.title.trim(),
          body: composer.body.trim(),
          category: composer.category,
          pinned: composer.pinned,
          images: composer.images,
        });
        setItems((l) => [r.announcement, ...(l ?? [])]);
        flash('Announcement published.');
      }
      if (composer.id) {
        // Hand the post back before closing, so the other editor's badge clears
        // now rather than on the next poll.
        await releaseBeforeClose();
        forgetLock(composer.id);
      }
      setComposer(null);
    } catch (err) {
      if (isRecordLocked(err)) {
        setFormError(err.message);
        void recordLock.refresh();
      } else {
        setFormError(err instanceof ApiError ? err.message : 'Could not publish. Try again.');
      }
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
      nav={opsNav(session?.role, session?.permissions)}
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
      </motion.section>

      {error && <InlineNotice>{error}</InlineNotice>}
      {items === null && !error && <EmptyNote>Loading announcements…</EmptyNote>}
      {items !== null && (
        <motion.div
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
          transition={{ type: 'spring', bounce: 0, duration: 0.35, delay: 0.04 }}
        >
          <AnnouncementFeed
            items={items}
            emptyNote="Nothing posted yet. Use “New post” to publish the first announcement."
            actions={(a) => {
              const editing = locksById[a.id];
              return (
                <div className="grid gap-2">
                  {editing && (
                    <p
                      id={`ann-edit-lock-${a.id}`}
                      role="status"
                      className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] leading-5 text-amber-900 ring-1 ring-inset ring-amber-600/20"
                    >
                      <Lock size={14} aria-hidden className="mt-0.5 shrink-0" />
                      <span>
                        <span className="font-semibold">
                          {editing.mine
                            ? 'You are editing this post in another tab.'
                            : `${editing.heldBy} is currently editing this post.`}
                        </span>{' '}
                        It unlocks on save, on leaving the editor, or {lockRemaining(editing.expiresAt)}.
                      </span>
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {editing ? (
                      <LockedActionButton
                        label="Edit"
                        className={chipButton}
                        describedBy={`ann-edit-lock-${a.id}`}
                        heldBy={editing.heldBy}
                        mine={editing.mine}
                      />
                    ) : (
                      <button type="button" onClick={() => startEdit(a)} className={chipButton}>
                        Edit
                      </button>
                    )}
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
                </div>
              );
            }}
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
              onClick={() => void closeComposer()}
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
              className="fixed inset-x-4 bottom-4 top-auto z-50 mx-auto max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-white/70 bg-white/95 p-6 shadow-2xl backdrop-blur-xl sm:inset-0 sm:m-auto sm:h-fit"
            >
              <h2 className="font-display text-[17px] font-semibold tracking-[-0.02em] text-slate-900">
                {composer.id ? 'Edit post' : 'New post'}
              </h2>
              <p className="mt-1 text-[12.5px] leading-5 text-slate-500">
                Patients see this in their feed and receive a notification.
              </p>
              {recordLock.heldByOther && (
                <p
                  role="status"
                  className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] leading-5 text-amber-900 ring-1 ring-inset ring-amber-600/20"
                >
                  <Lock size={14} aria-hidden className="mt-0.5 shrink-0" />
                  <span>
                    <span className="font-semibold">
                      {recordLock.lock?.heldBy ?? 'Another staff member'} is currently editing this post.
                    </span>{' '}
                    You can read it, but a save is refused until they finish or its lock ends{' '}
                    {lockRemaining(recordLock.lock?.expiresAt)}.
                  </span>
                </p>
              )}
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
                <ImageUploader
                  images={composer.images}
                  onChange={(images) => setComposer((c) => (c ? { ...c, images } : c))}
                  disabled={pending}
                />
                <label htmlFor="ann-pinned" className="flex cursor-pointer items-center gap-3 text-[13px] font-medium text-slate-700">
                  <input
                    id="ann-pinned"
                    type="checkbox"
                    checked={composer.pinned}
                    onChange={(e) => setComposer({ ...composer, pinned: e.target.checked })}
                    className="size-5 accent-[var(--brand-deep)]"
                  />
                  Pin to the top of the feed
                </label>
                {formError && <InlineNotice>{formError}</InlineNotice>}
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={submit}
                    disabled={pending || recordLock.heldByOther}
                    className={`${primaryButton} flex-1`}
                  >
                    {pending && <LoaderCircle size={16} className="animate-spin" aria-hidden />}
                    {composer.id ? 'Save changes' : 'Publish to patients'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void closeComposer()}
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

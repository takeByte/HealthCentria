import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  acquireVisitLocks,
  getVisitLocks,
  releaseVisitLocks,
  type VisitLockSection,
  type VisitLocks,
} from './api';

/**
 * Pessimistic section locks for the visit record screen.
 *
 * Locks are taken as soon as the screen opens, so nobody can start typing into
 * a section that is already being edited. The claim is renewed only while this
 * tab actually holds it, and it is given back when the screen closes, saves, or
 * is cancelled. After a save the tab stops renewing: the other editor can take
 * the sections, and they are claimed again as soon as somebody types.
 *
 * The status check matters as much as the claim: while this tab types, it also
 * polls who holds each section, so a field taken by somebody else turns
 * read-only instead of accepting text that could never be saved.
 *
 * This is the courtesy layer. The version check on the save is still what stops
 * a lost update - see lib/api.ts (EditConflictError) and utils/concurrency.js.
 */

const OWNER_KEY = 'healthcentria.visit-lock.owner';
const POLL_MS = 5_000;
const DEFAULT_HEARTBEAT_MS = 60_000;
const SECTIONS: VisitLockSection[] = ['diagnosis', 'prescription', 'visitNotes'];

/** A token for this tab, kept across reloads of the same tab. */
function tabOwner(): string {
  try {
    const existing = sessionStorage.getItem(OWNER_KEY);
    if (existing) return existing;
    const made = makeToken();
    sessionStorage.setItem(OWNER_KEY, made);
    return made;
  } catch {
    // Private mode / storage disabled: still works, just per mount.
    return makeToken();
  }
}

function makeToken(): string {
  try {
    return crypto.randomUUID().replace(/-/g, '');
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  }
}

export function isHeldByOther(locks: VisitLocks | null, section: VisitLockSection): boolean {
  const lock = locks?.[section];
  return !!lock && !lock.mine;
}

function holdsAny(locks: VisitLocks | null): boolean {
  return !!locks && SECTIONS.some((section) => locks[section]?.mine);
}

export interface VisitLocksState {
  /** This tab's lock token, sent with saves so the server can tell "mine". */
  owner: string;
  /** Null until the first claim comes back. */
  locks: VisitLocks | null;
  /** Sections currently held by somebody else (read-only for this tab). */
  blockedSections: VisitLockSection[];
  /** True while this tab holds at least one section (heartbeat runs). */
  holding: boolean;
  /** True once this tab has tried to claim the sections. */
  ready: boolean;
  /** Give the sections back now (save, cancel). */
  release: () => Promise<void>;
  /** Claim them again (first keystroke after a save). */
  reclaim: () => Promise<void>;
  /** Re-read who is editing, e.g. after a field-level 423. */
  refresh: () => Promise<void>;
}

/**
 * @param appointmentId visit to lock
 * @param enabled false on a visit that cannot be edited anyway
 */
export function useVisitLocks(appointmentId: string, enabled: boolean): VisitLocksState {
  const [locks, setLocks] = useState<VisitLocks | null>(null);
  const [holding, setHolding] = useState(false);
  const [ready, setReady] = useState(false);

  const owner = useMemo(() => tabOwner(), []);
  const nonce = useMemo(() => makeToken(), []);
  const aliveRef = useRef(true);
  // A ref as well as state: the heartbeat interval must see the live value.
  const holdingRef = useRef(false);
  // Typing can fire several onChange handlers before the first claim lands.
  const claimingRef = useRef(false);
  // The claim already in flight, so release() can wait for it before deleting.
  const claimPromiseRef = useRef<Promise<void> | null>(null);
  // Set by release(). Until the next explicit claim, no renewal or poll may
  // turn this tab back into the holder.
  const endedRef = useRef(false);
  // Deferred unmount release. React.StrictMode mounts, unmounts and mounts again
  // in development; a deferred release lets that second mount cancel it, while a
  // real unmount still gives the sections back.
  const pendingReleaseRef = useRef<{ appointmentId: string; timer: number } | null>(null);

  const noteLocks = useCallback((next: VisitLocks | null) => {
    const mine = !endedRef.current && holdsAny(next);
    holdingRef.current = mine;
    setHolding(mine);
  }, []);

  const claim = useCallback(async () => {
    if (claimingRef.current) return;
    claimingRef.current = true;
    endedRef.current = false;
    const work = (async () => {
      try {
        const result = await acquireVisitLocks(appointmentId, owner, nonce);
        if (!aliveRef.current) {
          // The screen closed while this claim was in flight: give it straight
          // back, otherwise it would sit there until the lease expires.
          void releaseVisitLocks(appointmentId, owner, nonce).catch(() => {});
          return;
        }
        setLocks(result.locks);
        noteLocks(result.locks);
      } catch {
        // The screen is still usable; the save path is the real guard.
      } finally {
        claimingRef.current = false;
        if (aliveRef.current) setReady(true);
      }
    })();
    claimPromiseRef.current = work;
    try {
      await work;
    } finally {
      if (claimPromiseRef.current === work) claimPromiseRef.current = null;
    }
  }, [appointmentId, owner, nonce, noteLocks]);

  const refresh = useCallback(async () => {
    try {
      const result = await getVisitLocks(appointmentId, owner);
      if (!aliveRef.current) return;
      setLocks(result.locks);
      noteLocks(result.locks);
    } catch {
      // Best effort: the next poll retries.
    }
  }, [appointmentId, owner, noteLocks]);

  const release = useCallback(async () => {
    // Stop the heartbeat first, so a renewal cannot land after the release and
    // keep the sections held for another 10 minutes. endedRef also stops a poll
    // that started before the delete from marking this tab as the holder again.
    endedRef.current = true;
    noteLocks(null);
    // A claim that was already in flight could create the row after the delete,
    // so let it finish and then delete what it made.
    if (claimPromiseRef.current) {
      try {
        await claimPromiseRef.current;
      } catch {
        // Nothing to clean up if the claim failed.
      }
    }
    try {
      await releaseVisitLocks(appointmentId, owner, nonce);
    } catch {
      // The lease expires on its own even if this call never lands.
    }
    // Show who holds what now (usually nobody), instead of stale "mine" flags.
    if (aliveRef.current) void refresh();
  }, [appointmentId, owner, nonce, noteLocks, refresh]);

  useEffect(() => {
    if (!enabled) return;
    // A StrictMode remount of the same visit cancels the deferred release of
    // the previous mount, so it cannot delete the claim this mount is about to make.
    const pending = pendingReleaseRef.current;
    if (pending && pending.appointmentId === appointmentId) {
      clearTimeout(pending.timer);
      pendingReleaseRef.current = null;
    }
    aliveRef.current = true;
    setReady(false);
    void claim();

    const poll = setInterval(() => void refresh(), POLL_MS);
    // Renew only while this tab holds a section. After a save the heartbeat
    // stops, which is what lets the other editor take over.
    const beat = setInterval(() => {
      if (holdingRef.current) void claim();
    }, DEFAULT_HEARTBEAT_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      aliveRef.current = false;
      holdingRef.current = false;
      clearInterval(poll);
      clearInterval(beat);
      document.removeEventListener('visibilitychange', onVisible);
      // Leaving the screen gives the sections back. Deferred so a StrictMode
      // remount can cancel it; the nonce stops this from deleting a newer claim.
      const timer = window.setTimeout(() => {
        if (pendingReleaseRef.current?.timer === timer) pendingReleaseRef.current = null;
        void releaseVisitLocks(appointmentId, owner, nonce).catch(() => {});
      }, 0);
      pendingReleaseRef.current = { appointmentId, timer };
    };
  }, [appointmentId, enabled, claim, refresh, owner, nonce]);

  const blockedSections = useMemo(
    () => SECTIONS.filter((section) => isHeldByOther(locks, section)),
    [locks],
  );

  return { owner, locks, blockedSections, holding, ready, release, reclaim: claim, refresh };
}

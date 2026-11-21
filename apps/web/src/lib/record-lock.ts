import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { makeToken, tabOwner } from './edit-owner';
import {
  acquireRecordLock,
  getRecordLock,
  releaseRecordLock,
  type RecordLockInfo,
  type RecordLockResource,
} from './api';

/**
 * A pessimistic edit lock for one record that is edited through a single form
 * (an announcement, a service).
 *
 * The claim is taken when the editor opens, renewed while it stays open, and
 * given back on save, cancel, or leaving. While another tab holds it this hook
 * reports who, so the screen can show "X is editing this" instead of letting
 * someone type a change whose save would be refused.
 *
 * This is the courtesy layer. The version check on the save is still what stops
 * a lost update - see lib/api.ts (EditConflictError).
 */

const POLL_MS = 5_000;
const DEFAULT_HEARTBEAT_MS = 60_000;

/** "in about 8 min" from the lease timestamp; the list re-renders on each poll. */
export function lockRemaining(expiresAt?: string): string {
  const ms = expiresAt ? new Date(expiresAt).getTime() - Date.now() : Number.NaN;
  if (!Number.isFinite(ms) || ms <= 0) return 'in a moment';
  const minutes = Math.ceil(ms / 60_000);
  return minutes <= 1 ? 'in under a minute' : `in about ${minutes} min`;
}

export interface RecordLockState {  /** This tab's lock token, sent with the save so the server can tell "mine". */
  owner: string;
  /** Null when the record is free or the last poll failed. */
  lock: RecordLockInfo | null;
  /** True when somebody else holds the record (the form must stay closed). */
  heldByOther: boolean;
  /** True while this tab holds the record (the heartbeat runs). */
  holding: boolean;
  /** True once this tab has tried to claim the record. */
  ready: boolean;
  /** Give the record back now (save, cancel). */
  release: () => Promise<void>;
  /** Claim it again (reopen the editor, or after the other lease expired). */
  reclaim: () => Promise<void>;
  /** Re-read the holder, e.g. after a 423 on save. */
  refresh: () => Promise<void>;
}

/**
 * @param resource which record type the lock belongs to
 * @param id the record being edited; empty when no editor is open
 * @param enabled false while the editor is closed
 */
export function useRecordLock(
  resource: RecordLockResource,
  id: string | null | undefined,
  enabled: boolean,
): RecordLockState {
  const [lock, setLock] = useState<RecordLockInfo | null>(null);
  const [holding, setHolding] = useState(false);
  const [ready, setReady] = useState(false);

  const owner = useMemo(() => tabOwner(), []);
  const nonce = useMemo(() => makeToken(), []);
  const active = enabled && !!id;
  const aliveRef = useRef(true);
  // A ref as well as state: the heartbeat must see the live value.
  const holdingRef = useRef(false);
  // Several keystrokes can arrive before the first claim comes back.
  const claimingRef = useRef(false);
  // The claim already in flight, so release() can wait for it before deleting.
  const claimPromiseRef = useRef<Promise<void> | null>(null);
  // Set by release(). Until the next explicit claim, no renewal or poll may
  // turn this tab back into the holder.
  const endedRef = useRef(false);
  // Deferred unmount release: React.StrictMode mounts, unmounts and mounts
  // again in development; deferring lets that second mount cancel it while a
  // real unmount still gives the record back.
  const pendingReleaseRef = useRef<{ key: string; timer: number } | null>(null);

  const noteLock = useCallback((next: RecordLockInfo | null) => {
    const mine = !endedRef.current && !!next && next.mine;
    holdingRef.current = mine;
    setHolding(mine);
  }, []);

  const claim = useCallback(async () => {
    if (!active || claimingRef.current) return;
    claimingRef.current = true;
    endedRef.current = false;
    const work = (async () => {
      try {
        const result = await acquireRecordLock(resource, id as string, owner, nonce);
        if (!aliveRef.current) {
          // The editor closed while this claim was in flight: give it straight
          // back, otherwise it would sit there until the lease expires.
          void releaseRecordLock(resource, id as string, owner, nonce).catch(() => {});
          return;
        }
        setLock(result.lock);
        noteLock(result.lock);
      } catch {
        // The editor is still usable; the save path is the real guard.
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
  }, [active, resource, id, owner, nonce, noteLock]);

  const refresh = useCallback(async () => {
    if (!active) return;
    try {
      const result = await getRecordLock(resource, id as string, owner);
      if (!aliveRef.current) return;
      setLock(result.lock);
      noteLock(result.lock);
    } catch {
      // Best effort: the next poll retries.
    }
  }, [active, resource, id, owner, noteLock]);

  const release = useCallback(async () => {
    if (!id) return;
    // Stop the heartbeat first, so a renewal cannot land after the release and
    // keep the record held for another ten minutes. endedRef also stops a poll
    // that started before the delete from marking this tab as the holder again.
    endedRef.current = true;
    noteLock(null);
    // A claim already in flight could create the row after the delete, so let
    // it finish and then delete what it made.
    if (claimPromiseRef.current) {
      try {
        await claimPromiseRef.current;
      } catch {
        // Nothing to clean up if the claim failed.
      }
    }
    try {
      await releaseRecordLock(resource, id, owner, nonce);
    } catch {
      // The lease expires on its own even if this call never lands.
    }
    if (aliveRef.current) void refresh();
  }, [resource, id, owner, nonce, noteLock, refresh]);

  useEffect(() => {
    if (!active) {
      setLock(null);
      setHolding(false);
      holdingRef.current = false;
      setReady(false);
      return;
    }

    const key = `${resource}:${id}`;
    // A StrictMode remount of the same editor cancels the deferred release of
    // the previous mount, so it cannot delete the claim this mount is about to make.
    const pending = pendingReleaseRef.current;
    if (pending && pending.key === key) {
      clearTimeout(pending.timer);
      pendingReleaseRef.current = null;
    }

    aliveRef.current = true;
    setReady(false);
    void claim();

    const poll = setInterval(() => void refresh(), POLL_MS);
    // Renew only while this tab holds the record. After a save the heartbeat
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
      // Leaving the editor gives the record back. Deferred so a StrictMode
      // remount can cancel it; the nonce stops it deleting a newer claim.
      const timer = window.setTimeout(() => {
        if (pendingReleaseRef.current?.timer === timer) pendingReleaseRef.current = null;
        void releaseRecordLock(resource, id as string, owner, nonce).catch(() => {});
      }, 0);
      pendingReleaseRef.current = { key, timer };
    };
  }, [active, resource, id, claim, refresh, owner, nonce]);

  const heldByOther = !!lock && !lock.mine;

  return { owner, lock, heldByOther, holding, ready, release, reclaim: claim, refresh };
}

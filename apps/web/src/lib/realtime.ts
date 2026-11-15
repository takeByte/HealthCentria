import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getSession } from './auth';

/**
 * Live updates, in three layers:
 *
 *  1. WebSocket push. The server says "appointments changed" and the page
 *     re-fetches. No patient data travels over the socket.
 *  2. Refresh when you come back to the tab or window (a missed hint, a laptop
 *     that slept).
 *  3. A slow timer, running ONLY while the WebSocket is not connected (a firewall
 *     or proxy that blocks it), so pages still catch up every so often.
 *
 * Pages use useLiveRefresh (quietly re-fetch) or useLiveStale (show an "updated,
 * reload" banner so nothing is replaced while someone is typing).
 */

export type LiveTopic = 'appointments' | 'notifications' | 'announcements' | 'services' | 'patients';

/** push = the server said so; focus = tab came back; poll = fallback timer; connect = (re)connected. */
export type LiveReason = 'push' | 'focus' | 'poll' | 'connect';
type Listener = (info: { topic: LiveTopic | 'all'; id?: string; patient?: string; reason: LiveReason }) => void;

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:5000';
const FALLBACK_POLL_MS = 60_000;
const FOCUS_MIN_HIDDEN_MS = 3_000;
const TOPICS: LiveTopic[] = ['appointments', 'notifications', 'announcements', 'services', 'patients'];

const listeners = new Map<LiveTopic, Set<Listener>>();
let socket: Socket | null = null;
let socketToken = '';
let connected = false;
let pollTimer: number | undefined;
let hiddenAt = 0;
let browserHooked = false;

function fire(topic: LiveTopic | 'all', reason: LiveReason, id?: string, patient?: string) {
  const targets = topic === 'all' ? TOPICS : [topic];
  for (const t of targets) {
    for (const listener of listeners.get(t) ?? []) listener({ topic: t, id, patient, reason });
  }
}

function listenerCount(): number {
  let n = 0;
  for (const set of listeners.values()) n += set.size;
  return n;
}

function stopPolling() {
  if (pollTimer !== undefined) window.clearInterval(pollTimer);
  pollTimer = undefined;
}

function startPolling() {
  if (pollTimer !== undefined || connected) return;
  pollTimer = window.setInterval(() => {
    if (!connected && document.visibilityState === 'visible' && listenerCount() > 0) fire('all', 'poll');
  }, FALLBACK_POLL_MS);
}

function hookBrowser() {
  if (browserHooked) return;
  browserHooked = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
    } else if (hiddenAt && Date.now() - hiddenAt >= FOCUS_MIN_HIDDEN_MS) {
      hiddenAt = 0;
      fire('all', 'focus');
    }
  });
  window.addEventListener('focus', () => {
    if (hiddenAt && Date.now() - hiddenAt >= FOCUS_MIN_HIDDEN_MS) {
      hiddenAt = 0;
      fire('all', 'focus');
    }
  });
}

/** This browser tab's connection id (sent with writes so the server does not echo the change back to it). */
export function currentSocketId(): string {
  return connected && socket?.id ? socket.id : '';
}

/** Closes the connection (sign out). It reconnects on its own with the next sign-in. */
export function disconnectLive() {
  stopPolling();
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
  socketToken = '';
  connected = false;
}

function ensureConnected() {
  hookBrowser();
  const token = getSession()?.token ?? '';
  if (!token) {
    disconnectLive();
    return;
  }
  if (socket && socketToken === token) return;
  disconnectLive();
  socketToken = token;
  socket = io(API_URL, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnectionDelayMax: 10_000,
  });
  socket.on('connect', () => {
    connected = true;
    stopPolling();
    // Anything that happened while we were away: bring every page up to date once.
    fire('all', 'connect');
  });
  const lost = () => {
    connected = false;
    startPolling();
  };
  socket.on('disconnect', lost);
  socket.on('connect_error', lost);
  socket.on('change', (msg: { topic?: string; id?: string; patient?: string }) => {
    if (msg?.topic && (TOPICS as string[]).includes(msg.topic)) fire(msg.topic as LiveTopic, 'push', msg.id, msg.patient);
  });
  startPolling();
}

/** Listen to some topics. Returns the function that stops listening. */
export function subscribeLive(topics: LiveTopic[], listener: Listener): () => void {
  for (const topic of topics) {
    if (!listeners.has(topic)) listeners.set(topic, new Set());
    listeners.get(topic)!.add(listener);
  }
  ensureConnected();
  return () => {
    for (const topic of topics) listeners.get(topic)?.delete(listener);
  };
}

/**
 * Quietly re-run `refetch` when any of the topics change, when the tab comes back,
 * and (only if the WebSocket is down) on a slow timer. Bursts are merged into one call.
 *
 * The `connect` reason is skipped on the very first connection, because the page
 * has just loaded its data itself.
 */
export function useLiveRefresh(topics: LiveTopic[], refetch: () => void): void {
  const latest = useRef(refetch);
  latest.current = refetch;
  const key = topics.join(',');
  useEffect(() => {
    let timer: number | undefined;
    const mountedAt = Date.now();
    const off = subscribeLive(topics, ({ reason }) => {
      if (reason === 'connect' && Date.now() - mountedAt < 5_000) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => latest.current(), 400);
    });
    return () => {
      off();
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/**
 * For screens where someone may be typing: instead of replacing the data, report that
 * it changed. `stale` turns true when the server pushes a change for these topics.
 * Pass `patientId` to care only about that patient (their record, or their appointments).
 * Call `clear` after reloading.
 */
export function useLiveStale(topics: LiveTopic[], patientId?: string): { stale: boolean; clear: () => void } {
  const [stale, setStale] = useState(false);
  const key = topics.join(',');
  useEffect(() => {
    setStale(false);
    return subscribeLive(topics, (info) => {
      if (info.reason !== 'push') return;
      if (patientId) {
        const about = info.topic === 'patients' ? info.id : info.patient;
        if (about && about !== patientId) return;
      }
      setStale(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, patientId]);
  return { stale, clear: () => setStale(false) };
}

import { Server } from 'socket.io';
import { env } from './config/env.js';
import { User } from './models/user.model.js';
import { effectivePermissions } from './utils/permissions.js';
import { verifySession } from './utils/tokens.js';

/**
 * Live updates over a WebSocket (socket.io).
 *
 * The server only says THAT something changed ({ topic, id }). It never sends
 * patient data. Each page then re-fetches through the normal API, so every
 * permission check stays where it already is.
 *
 * Who hears what (rooms):
 *   user:<id>        one person  (their notifications, their own appointments and record)
 *   perm:<key>       staff/admins holding that permission (admins hold all of them)
 *   all              every signed-in person (announcements, services)
 *
 * Permissions are read when a person connects, so a permission change applies the
 * next time their page reconnects. That is harmless: a missed hint just means the
 * tab-focus and timer refresh pick it up.
 *
 * Messages live in memory, so this works with ONE server process. For several copies of
 * the server, add the socket.io Redis adapter.
 */

let io = null;

/**
 * Connection limits. REST rate limits do not cover the WebSocket, so a script
 * could otherwise open thousands of sockets (each one holds memory) or hammer
 * the handshake, which reads the user from the database.
 *  - at most MAX_SOCKETS_PER_USER open at once per account (several tabs are fine)
 *  - at most HANDSHAKES_PER_MINUTE connection attempts per IP address
 * Counters are in memory, like the rest of the realtime layer (one server process).
 */
const MAX_SOCKETS_PER_USER = 5;
const HANDSHAKES_PER_MINUTE = 60;
const HANDSHAKE_WINDOW_MS = 60_000;
const openSockets = new Map(); // userId -> number of open sockets
const handshakes = new Map(); // ip -> { count, resetAt }

/** Client IP. Only trusts X-Forwarded-For when TRUST_PROXY says a proxy is in front. */
function clientIp(socket) {
  if (env.TRUST_PROXY > 0) {
    const hops = String(socket.handshake.headers['x-forwarded-for'] ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    const trusted = hops[hops.length - env.TRUST_PROXY];
    if (trusted) return trusted;
  }
  return socket.handshake.address || 'unknown';
}

/** Counts a connection attempt; false once this IP is over its limit for the window. */
function allowHandshake(ip) {
  const now = Date.now();
  const entry = handshakes.get(ip);
  if (!entry || entry.resetAt <= now) {
    handshakes.set(ip, { count: 1, resetAt: now + HANDSHAKE_WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= HANDSHAKES_PER_MINUTE;
}

// Drop expired entries so the map cannot grow without bound.
const handshakeCleanup = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of handshakes) if (entry.resetAt <= now) handshakes.delete(ip);
}, HANDSHAKE_WINDOW_MS);
handshakeCleanup.unref();

export function initRealtime(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: env.CLIENT_URL },
    serveClient: false,
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });

  // Cheapest check first: too many connection attempts from one IP.
  io.use((socket, next) => {
    if (!allowHandshake(clientIp(socket))) return next(new Error('rate_limited'));
    return next();
  });

  // Same login check as the REST API: a valid token for an active account.
  io.use(async (socket, next) => {
    try {
      const payload = verifySession(socket.handshake.auth?.token);
      const user = await User.findById(payload.sub).select('role active tokenVersion permissions deletedAt').lean();
      if (!user || !user.active || user.deletedAt || (user.tokenVersion ?? 0) !== Number(payload.ver ?? 0)) {
        return next(new Error('unauthorized'));
      }
      if ((openSockets.get(String(user._id)) ?? 0) >= MAX_SOCKETS_PER_USER) {
        return next(new Error('too_many_connections'));
      }
      socket.data.user = { id: String(user._id), role: user.role, permissions: effectivePermissions(user) };
      return next();
    } catch {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    openSockets.set(user.id, (openSockets.get(user.id) ?? 0) + 1);
    socket.on('disconnect', () => {
      const left = (openSockets.get(user.id) ?? 1) - 1;
      if (left > 0) openSockets.set(user.id, left);
      else openSockets.delete(user.id);
    });
    socket.join(`user:${user.id}`);
    socket.join('all');
    if (user.role !== 'patient') {
      for (const permission of user.permissions) socket.join(`perm:${permission}`);
    }
  });
  return io;
}

export async function closeRealtime() {
  if (!io) return;
  await new Promise((resolve) => io.close(resolve));
  io = null;
}

/**
 * Tell the given rooms that a topic changed. A no-op when realtime is not running (scripts, tests).
 * The browser that made the change sends its socket id (X-Socket-Id); that one tab is skipped,
 * because it already has the fresh data from its own response.
 */
function publish(rooms, topic, id, req, extra = {}) {
  if (!io) return;
  const targets = [rooms].flat().filter(Boolean);
  if (!targets.length) return;
  const origin = typeof req?.get === 'function' ? String(req.get('x-socket-id') ?? '').trim() : '';
  let sender = io.to(targets);
  if (origin) sender = sender.except(origin);
  sender.emit('change', { topic, ...(id ? { id: String(id) } : {}), ...extra });
}

/**
 * What the controllers call after a change has been saved. Failures here must
 * never break a request, so every helper swallows its own errors.
 */
export const live = {
  /** New notification rows for these people. */
  notifications(userIds) {
    try {
      publish(userIds.map((id) => `user:${id}`), 'notifications');
    } catch {
      /* best effort */
    }
  },
  /** An appointment was created or changed (booking, status change, visit record). */
  appointment(appt, req) {
    try {
      const patientId = appt?.patient?._id ?? appt?.patient;
      publish(
        ['perm:appointments.manage', 'perm:patients.manage', patientId ? `user:${patientId}` : null],
        'appointments',
        appt?._id,
        req,
        patientId ? { patient: String(patientId) } : {},
      );
    } catch {
      /* best effort */
    }
  },
  announcements(id, req, extra = {}) {
    try {
      // `extra.version` lets other open tabs see at once that they hold an older version.
      publish('all', 'announcements', id, req, extra);
    } catch {
      /* best effort */
    }
  },
  services(id, req) {
    try {
      publish('all', 'services', id, req);
    } catch {
      /* best effort */
    }
  },
  /** A patient's record changed (profile, medical profile, deletion). */
  patient(patientId, req) {
    try {
      publish(['perm:patients.manage', 'perm:appointments.manage', `user:${patientId}`], 'patients', patientId, req);
    } catch {
      /* best effort */
    }
  },
};

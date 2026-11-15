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

export function initRealtime(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: env.CLIENT_URL },
    serveClient: false,
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });

  // Same login check as the REST API: a valid token for an active account.
  io.use(async (socket, next) => {
    try {
      const payload = verifySession(socket.handshake.auth?.token);
      const user = await User.findById(payload.sub).select('role active tokenVersion permissions deletedAt').lean();
      if (!user || !user.active || user.deletedAt || (user.tokenVersion ?? 0) !== Number(payload.ver ?? 0)) {
        return next(new Error('unauthorized'));
      }
      socket.data.user = { id: String(user._id), role: user.role, permissions: effectivePermissions(user) };
      return next();
    } catch {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
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
  announcements(id, req) {
    try {
      publish('all', 'announcements', id, req);
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

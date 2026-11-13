import mongoose from 'mongoose';
import { env } from '../config/env.js';

/**
 * Waits for the database instead of rejecting during the initial handshake.
 *
 * Every controller answers 503 while `readyState !== 1`, so a request that
 * lands while mongoose is still connecting used to fail with "Database is not
 * connected" even though the API was healthy. This gate holds such requests
 * until the connection is up, bounded by a per-process grace window
 * (`DB_WAIT_MS`) so a cold or unreachable Atlas cannot queue requests forever.
 *
 * The port is still opened immediately: probes and /api/health never wait.
 *
 * The grace window starts at process start. Once it has passed (or no
 * connection is expected, e.g. a placeholder URI), requests fail fast with
 * 503 + Retry-After — the same status the controllers return.
 */
const bootDeadline = Date.now() + env.DB_WAIT_MS;
// index.js skips connecting entirely when the URI is still a template.
const connectionExpected = !env.MONGODB_URI.includes('<user>');

function waitForConnection(ms) {
  if (mongoose.connection.readyState === 1) return Promise.resolve(true);
  return new Promise((resolve) => {
    let timer;
    const done = (connected) => {
      clearTimeout(timer);
      mongoose.connection.off('connected', onConnected);
      resolve(connected);
    };
    const onConnected = () => done(true);
    timer = setTimeout(() => done(mongoose.connection.readyState === 1), ms);
    mongoose.connection.once('connected', onConnected);
  });
}

export async function dbGate(req, res, next) {
  // Probes must answer even while the DB is down; cors answers preflights.
  if (req.method === 'OPTIONS' || req.path === '/health') return next();
  if (mongoose.connection.readyState === 1) return next();

  // Wait for whatever is left of the grace window. This covers the handshake
  // itself and the gaps between connectWithRetry attempts (readyState 0 after
  // a failed attempt) — otherwise the very first login can still 503 even
  // though the next retry would have succeeded a moment later.
  const remaining = bootDeadline - Date.now();
  if (connectionExpected && remaining > 0) {
    if (await waitForConnection(remaining)) return next();
  }

  res.set('Retry-After', '2');
  return res.status(503).json({
    success: false,
    code: 'db_unavailable',
    message: 'Database is not connected. Try again later.',
  });
}

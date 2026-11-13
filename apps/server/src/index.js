import mongoose from 'mongoose';
import { createApp } from './app.js';
import { connectDB } from './config/db.js';
import { env } from './config/env.js';
import { startBackupScheduler, stopBackupScheduler } from './services/backup-scheduler.js';

const RETRY_DELAYS_MS = [1000, 2000, 5000, 10000, 15000];

/**
 * Connect in the background with backoff. Never throws and never exits, so a
 * cold or rate-limited Atlas does not stop the API from booting — /api/health
 * reports the real connection state and mongoose reconnects on its own.
 */
async function connectWithRetry(uri) {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      await connectDB(uri);
      return;
    } catch (err) {
      const isLast = attempt === RETRY_DELAYS_MS.length;
      if (isLast) {
        console.error(`MongoDB still unreachable: ${err.message}`);
        return;
      }
      const delay = RETRY_DELAYS_MS[attempt];
      console.warn(
        `MongoDB connect failed (${err.message}) — retrying in ${delay / 1000}s ` +
          `[attempt ${attempt + 1}/${RETRY_DELAYS_MS.length + 1}]`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function main() {
  const isPlaceholder = env.MONGODB_URI.includes('<user>');
  if (isPlaceholder) {
    console.warn('MONGODB_URI is a placeholder — starting API without DB connection.');
  } else {
    // Intentionally not awaited: the port must open immediately for platform
    // probes. Requests that need the DB wait for the handshake in dbGate.
    void connectWithRetry(env.MONGODB_URI);
  }

  const app = createApp();

  const server = app.listen(env.PORT, () => {
    console.log(`API listening on http://localhost:${env.PORT}`);
  });

  startBackupScheduler();

  const shutdown = async () => {
    console.log('Shutting down...');
    stopBackupScheduler();
    server.close(async () => {
      if (mongoose.connection.readyState === 1) await mongoose.disconnect();
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();

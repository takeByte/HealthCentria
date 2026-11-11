import 'dotenv/config';
import { connectDB, disconnectDB } from '../config/db.js';
import { runBackup } from '../services/backup.js';

// One-off snapshot for an external scheduler (Windows Task Scheduler, cron,
// Render cron job). The API also runs backups in-process; this script is for
// hosts that prefer the job outside the web process.
//   pnpm --filter @healthcentria/server backup

async function main() {
  if (!process.env.MONGODB_URI || process.env.MONGODB_URI.includes('<user>')) {
    console.error('MONGODB_URI is missing or still a placeholder — set it in apps/server/.env first.');
    process.exit(2);
  }

  await connectDB(process.env.MONGODB_URI);
  try {
    const result = await runBackup({ trigger: 'manual' });
    console.log(
      `Backup written: ${result.fileName} (${result.documents} documents, ${result.bytes} bytes) ` +
        `in ${result.durationMs}ms.`,
    );
    if (result.removed) console.log(`Removed ${result.removed} old backup file(s) past retention.`);
  } finally {
    await disconnectDB();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

import 'dotenv/config';
import { z } from 'zod';
import { connectDB, disconnectDB } from '../config/db.js';
import { User } from '../models/user.model.js';
import { hashPassword, isValidPassword, PASSWORD_ERROR_MESSAGE } from '../utils/password.js';

// One-time bootstrap for privileged accounts (admin/staff).
// Public registration only creates patients, so the very first admin — and
// staff until the Staff Accounts UI exists — are created here.
//
// Usage:
//   node src/scripts/seed-user.js --email=admin@example.com --password=ChangeMe123 --role=admin --name="Clinic Admin"
//   node src/scripts/seed-user.js --email=nurse@example.com --password=ChangeMe123 --role=staff --name="Nurse Joy"
//   node src/scripts/seed-user.js --email=admin@example.com --password=NewPass123 --force   # reset password
//
// SEED_EMAIL / SEED_PASSWORD / SEED_ROLE / SEED_NAME env vars work as fallback
// for the --email / --password / --role / --name flags.

const argsSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid --email.'),
  password: z.string().refine(isValidPassword, PASSWORD_ERROR_MESSAGE),
  role: z.enum(['admin', 'staff']).default('admin'),
  name: z.string().trim().min(1).default('Clinic Admin'),
  force: z.boolean().default(false),
});

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) {
      const key = match[1];
      out[key] = match[2];
    } else if (arg === '--force') {
      out.force = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node src/scripts/seed-user.js --email=E --password=P [--role=admin|staff] [--name=N] [--force]');
      process.exit(0);
    }
  }
  return argsSchema.parse({
    email: out.email ?? process.env.SEED_EMAIL,
    password: out.password ?? process.env.SEED_PASSWORD,
    role: out.role ?? process.env.SEED_ROLE ?? undefined,
    name: out.name ?? process.env.SEED_NAME ?? undefined,
    force: out.force ?? false,
  });
}

async function main() {
  let input;
  try {
    input = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof z.ZodError) {
      console.error('Invalid arguments:');
      for (const issue of err.issues) console.error(`  - ${issue.path.join('.') || 'input'}: ${issue.message}`);
      process.exit(2);
    }
    throw err;
  }

  if (!process.env.MONGODB_URI || process.env.MONGODB_URI.includes('<user>')) {
    console.error('MONGODB_URI is missing or still a placeholder — set it in apps/server/.env first.');
    process.exit(2);
  }

  await connectDB(process.env.MONGODB_URI);
  try {
    const existing = await User.findOne({ email: input.email });
    if (existing && !input.force) {
      console.error(`Refusing: ${input.email} already exists as "${existing.role}". Re-run with --force to reset its password.`);
      process.exit(1);
    }
    const passwordHash = await hashPassword(input.password);
    if (existing) {
      existing.passwordHash = passwordHash;
      existing.role = input.role;
      existing.fullName = input.name;
      existing.active = true;
      await existing.save();
      console.log(`Updated ${input.email} → role "${input.role}".`);
    } else {
      await User.create({
        email: input.email,
        passwordHash,
        role: input.role,
        fullName: input.name,
      });
      console.log(`Created ${input.role} account: ${input.email}`);
    }
    console.log('Log in with this email + password. Change the password after first login.');
  } finally {
    await disconnectDB();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(5000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  CLIENT_URL: z.string().default('http://localhost:5173'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET is required (min 16 chars) — generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().default('HealthCentria <onboarding@resend.dev>'),

  // SMTP delivery (e.g. Brevo relay). Used instead of Resend when all three of
  // SMTP_HOST/SMTP_USER/SMTP_PASS are set. MAIL_FROM is the visible sender and
  // falls back to RESEND_FROM.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().optional(),

  // reCAPTCHA v2 (secret half). Optional in development — the auth routes skip
  // verification when it is absent — but production refuses unverified logins.
  // Admins can override both keys at runtime from Settings; these values are
  // the fallback when no custom row exists.
  RECAPTCHA_SITE_KEY: z.string().optional(),
  RECAPTCHA_SECRET_KEY: z.string().optional(),

  // Number of reverse-proxy hops in front of the API. Leave 0 locally; set to 1
  // (or more) on Nginx/Render/Railway so rate limiting and activity logs see
  // the real client IP instead of the proxy's.
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  // Google OAuth (optional). Sign-in with Google stays disabled until both the
  // client id and secret are set. See README § "Sign in with Google".
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // Must match an "Authorized redirect URI" in the Google Cloud console exactly.
  // Defaults to the local API callback.
  GOOGLE_CALLBACK_URL: z.string().optional(),

  // Encrypts credentials an admin stores from the admin UI. Optional so the API
  // still boots without it; saving custom credentials requires a valid key.
  // Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  SETTINGS_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'SETTINGS_ENCRYPTION_KEY must be 64 hex characters (32 bytes).')
    .optional(),

  // Google Calendar sync (optional). The service account must have the target
  // calendar shared with it. When these are absent the integration is disabled
  // and appointment confirmation keeps working exactly as before.
  GOOGLE_CALENDAR_ID: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: z.string().optional(),
  GOOGLE_CALENDAR_TIMEZONE: z.string().default('Asia/Manila'),
  GOOGLE_CALENDAR_LOCATION: z.string().optional(),

  // Superadmin PIN: required (X-Super-Pin header) to save, reset or switch any
  // integration in admin Settings. When empty, those changes are refused.
  // SU_EMAIL receives a notice after every approved change.
  SU_PIN: z.string().optional(),
  SU_EMAIL: z.string().optional(),

  // Google Sheets export: the spreadsheet (shared with the service account as
  // Editor) that receives each export as a new tab. Set as
  // DEFAULT_GOOGLE_SHEETS_SPREADSHEET_ID; an admin can override it in Settings.
  GOOGLE_SHEETS_SPREADSHEET_ID: z.string().optional(),

  // Clinic name in the header of every export. Optional: falls back to
  // GOOGLE_CALENDAR_LOCATION, then "Barangay 11 Health Center".
  CLINIC_NAME: z.string().optional(),

  // Google Drive (PDF uploads). OAuth client of type "Web application"; an
  // admin clicks "Connect Google Drive" in Settings and PDFs are uploaded as
  // that Google account. Set as DEFAULT_GOOGLE_DRIVE_* in .env.
  GOOGLE_DRIVE_CLIENT_ID: z.string().optional(),
  GOOGLE_DRIVE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_DRIVE_FOLDER_ID: z.string().optional(),
  // Must match an Authorized redirect URI on that OAuth client. Defaults to
  // http://localhost:<PORT>/api/admin/settings/google-drive/callback.
  GOOGLE_DRIVE_REDIRECT_URI: z.string().optional(),
});

// Integration defaults that an admin can override from Settings are named
// DEFAULT_* in .env (custom overrides live encrypted in the database, never in
// .env). The older names still work; when both are set, DEFAULT_* wins.
// Internally the app keeps using the old names, so no other code changes.
const DEFAULT_ALIASES = {
  GOOGLE_CLIENT_ID: 'DEFAULT_GOOGLE_CLIENT_ID',
  GOOGLE_CLIENT_SECRET: 'DEFAULT_GOOGLE_CLIENT_SECRET',
  SMTP_HOST: 'DEFAULT_SMTP_HOST',
  SMTP_PORT: 'DEFAULT_SMTP_PORT',
  SMTP_USER: 'DEFAULT_SMTP_USER',
  SMTP_PASS: 'DEFAULT_SMTP_PASS',
  MAIL_FROM: 'DEFAULT_MAIL_FROM',
  RECAPTCHA_SITE_KEY: 'DEFAULT_RECAPTCHA_SITE_KEY',
  RECAPTCHA_SECRET_KEY: 'DEFAULT_RECAPTCHA_SECRET_KEY',
  GOOGLE_SHEETS_SPREADSHEET_ID: 'DEFAULT_GOOGLE_SHEETS_SPREADSHEET_ID',
  GOOGLE_DRIVE_CLIENT_ID: 'DEFAULT_GOOGLE_DRIVE_CLIENT_ID',
  GOOGLE_DRIVE_CLIENT_SECRET: 'DEFAULT_GOOGLE_DRIVE_CLIENT_SECRET',
  GOOGLE_DRIVE_FOLDER_ID: 'DEFAULT_GOOGLE_DRIVE_FOLDER_ID',
};

const source = { ...process.env };
for (const [legacy, preferred] of Object.entries(DEFAULT_ALIASES)) {
  if (process.env[preferred]) source[legacy] = process.env[preferred];
}

export const env = envSchema.parse(source);

export const googleOAuth = {
  enabled: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
  clientId: env.GOOGLE_CLIENT_ID ?? '',
  clientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
  callbackUrl: env.GOOGLE_CALLBACK_URL ?? `http://localhost:${env.PORT}/api/auth/google/callback`,
};

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
});

export const env = envSchema.parse(process.env);

export const googleOAuth = {
  enabled: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
  clientId: env.GOOGLE_CLIENT_ID ?? '',
  clientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
  callbackUrl: env.GOOGLE_CALLBACK_URL ?? `http://localhost:${env.PORT}/api/auth/google/callback`,
};

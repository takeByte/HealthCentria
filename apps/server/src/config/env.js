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
});

export const env = envSchema.parse(process.env);

export const googleOAuth = {
  enabled: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
  clientId: env.GOOGLE_CLIENT_ID ?? '',
  clientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
  callbackUrl: env.GOOGLE_CALLBACK_URL ?? `http://localhost:${env.PORT}/api/auth/google/callback`,
};

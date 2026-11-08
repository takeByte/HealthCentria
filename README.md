# E-Kalinga

Monorepo (pnpm workspaces):

- `apps/server` — Express + TypeScript REST API, MongoDB Atlas (Mongoose)
- `apps/web` — React + Vite + TanStack Router frontend

## Prerequisites

- Node.js >= 20
- pnpm >= 9 (`corepack enable`)
- A MongoDB Atlas connection string

## Setup

```bash
pnpm install
cp apps/server/.env.example apps/server/.env   # then fill in MONGODB_URI
cp apps/web/.env.example apps/web/.env          # optional, defaults to http://localhost:5000
```

## Develop

```bash
# both
pnpm dev

# individually
pnpm dev:server   # http://localhost:5000
pnpm dev:web      # http://localhost:5173
```

## CAPTCHA (reCAPTCHA v2)

Login and registration are protected by a server-verified reCAPTCHA v2 checkbox
plus per-IP rate limits.

1. Create a **reCAPTCHA v2 → "I'm not a robot" Checkbox** key pair at
   <https://www.google.com/recaptcha/admin>.
2. Add every hostname that serves the site (`localhost` for development and the
   production domain), otherwise the widget reports an invalid-domain error.
3. Put the **site key** in `apps/web/.env`:

   ```bash
   VITE_RECAPTCHA_SITE_KEY=...
   ```

4. Put the **secret key** in `apps/server/.env`:

   ```bash
   RECAPTCHA_SECRET_KEY=...
   ```

The token is verified with Google in `apps/server/src/middleware/verifyCaptcha.js`
before the controller runs; a frontend-only widget could be bypassed by calling
the API directly. In development a missing secret skips the check, while
production refuses unverified auth requests. Behind a reverse proxy also set
`TRUST_PROXY=1` so rate limiting sees real client IPs.

## Email delivery (SMTP)

Password reset codes and announcements are sent through SMTP. Configure it in
**Admin → Settings → Email delivery** (saved encrypted in MongoDB, applied
immediately) or with the `DEFAULT_SMTP_*` values in `apps/server/.env`; the database
settings win when both exist.

| Variable | Example |
| --- | --- |
| `DEFAULT_SMTP_HOST` | `smtp-relay.brevo.com` |
| `DEFAULT_SMTP_PORT` | `587` |
| `DEFAULT_SMTP_USER` | SMTP login |
| `DEFAULT_SMTP_PASS` | SMTP password or API key |
| `DEFAULT_MAIL_FROM` | `E-Kalinga <clinic@your-domain.com>` |

Saving from the admin UI requires `SETTINGS_ENCRYPTION_KEY` (64 hex characters)
in `apps/server/.env`. Use **Send test email** to verify the connection; the
provider's error message is shown when it fails. Resend stays available as a
fallback when `RESEND_API_KEY` is set and SMTP is not configured.

## Email verification

Patients who self-register start with `emailVerified: false`. Right after the
account is created, registration shows a third step asking for the 6-digit code
before continuing to the dashboard (the patient can choose **Skip for now**).
Anyone who skips, or signs in later without verifying, sees a reminder banner in
the app. The code is only ever sent to the address already stored on the account,
so the public registration form cannot be used to mail arbitrary inboxes.
Verification is a reminder, not a gate: unverified patients keep full access.
Codes expire after 30 minutes and a resend is allowed once per minute.

## Demo data

Seed accounts, services, appointments/visit records, announcements and notifications
(shared across the admin, staff and patient views):

```bash
pnpm --filter @healthcentria/server seed:demo
```

The seed is idempotent — re-running it updates the demo records instead of
duplicating them, and it never resets an existing account's password. New demo
accounts created by the script use the password `Demo1234!`.

## Build

```bash
pnpm build
```

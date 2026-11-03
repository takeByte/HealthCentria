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

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

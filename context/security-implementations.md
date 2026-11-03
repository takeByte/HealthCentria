# Security Implementations — HealthCentria (E-Kalinga)

> This document describes the security controls that exist in the current codebase. It is written for developers, reviewers, and project documentation. It separates what is implemented from what is still missing, so the system is not described as more secure than it really is.

## Contents

1. [Rule-Based Access Control (RBAC)](#1-rule-based-access-control-rbac)
2. [Activity Logs (Audit Trail)](#2-activity-logs-audit-trail)
3. [Other Security Features](#3-other-security-features)
4. [Current Limitations and Production Hardening](#4-current-limitations-and-production-hardening)
5. [Security at a Glance](#5-security-at-a-glance)
6. [Source Map](#6-source-map)
7. [Bottom Line](#7-bottom-line)

## How to read this document

- **Authentication** answers: “Who are you?”
- **Authorization** answers: “What are you allowed to do?”
- **Rule-based access control** means the server checks explicit rules before allowing an action. In this system the main rule is the user’s role, with extra rules for ownership, account state, and record state. In practice this is **Role-Based Access Control (RBAC)** with ownership rules layered on top.
- **Activity log / audit log** is the append-only record of security-relevant actions: who did what, when, to which record, and what changed.
- **Retention** is how long the activity log is kept before an administrator may purge it.

The short version:

1. Three fixed roles — **patient**, **staff**, **admin** — are enforced by the API.
2. Every protected request needs a valid signed JWT, and most routes also require a specific role.
3. Controllers add **ownership checks**, so a patient can only act on their own records.
4. Security-relevant actions are written to an **append-only activity log** with actor, target, changes, outcome, IP, and user agent.
5. The log is visible in different scopes: admin sees everything, staff sees work events plus their own sign-ins, and patients see only their own record.
6. Supporting controls include scrypt password hashing, encrypted OAuth secrets, Google ID-token verification, Helmet, CORS restriction, and Zod validation.

---

## 1. Rule-Based Access Control (RBAC)

### 1.1 The access-control model in one paragraph

Access is decided on the **server**, not in the browser. A request first passes `requireAuth`, which checks for a Bearer JWT and verifies its signature and expiry. It then usually passes `requireRole(...)`, which checks the role claim inside the token. After that, the controller applies narrower **ownership and state rules** — for example, “this appointment must belong to the signed-in patient” or “only a pending appointment can be confirmed.” The frontend also has route guards, but those are only for user experience; they are not the security boundary.

### 1.2 The three roles

| Role | How the account is created | Main access | Important restrictions |
|---|---|---|---|
| **Patient** | Self-registers on the public registration page; can also sign in with Google; staff can create a patient during walk-in registration. | View and update their own profile; book and cancel their own appointments; view their own appointments, clinical visit details, notifications, and activity. | Cannot view another patient’s record. Cannot access staff or admin screens. Cannot change their own role. |
| **Staff** | Created only by an admin through Staff Accounts, or bootstrapped with the server seed script. Staff cannot self-register. | Appointment queue; confirm, decline, and complete visits; patient directory and charts; walk-ins; create and update services; create and update announcements; reports; their own activity plus work events. | Cannot manage staff accounts. Cannot change system settings or Google credentials. Cannot delete announcements. Cannot export or purge the activity log. Cannot see configuration events or another person’s sign-ins. |
| **Admin** | Seeded out-of-band for the first account, or created by another admin through Staff Accounts. | Everything staff can do, plus staff account management, settings, Google integration, announcement deletion, the full activity log, CSV export, and log purge. | Cannot demote or deactivate their own account. Cannot edit audit entries. |

Roles are **fixed for v1**. There is no custom role builder or per-user permission editor. This is intentional: it reduces the chance of accidentally granting excessive access.

### 1.3 How a request is authorized

The layers are applied in this order:

1. **Token check — `requireAuth`**
   - Reads the `Authorization: Bearer <token>` header.
   - Verifies the JWT using `JWT_SECRET`.
   - Rejects a missing, malformed, expired, or invalid token with **401 Unauthorized**.
   - Attaches `{ id, role }` from the token to `req.user`.

2. **Role check — `requireRole(...)`**
   - Compares `req.user.role` with the allowed roles for that route.
   - Returns **403 Forbidden** when the role is not allowed.

3. **Ownership check — inside the controller**
   - The controller filters by `req.user.id` or by the patient linked to the record.
   - A patient’s appointment lookup includes `patient: req.user.id`.
   - Patient profile endpoints read and write only the signed-in user.
   - Notification queries include `recipient: req.user.id`.
   - Results that do not belong to the caller usually return **404 Not Found** rather than 403, so the API does not reveal whether another record exists.

4. **State and business-rule checks**
   - Only pending appointments can be confirmed or declined.
   - Only confirmed appointments can be completed.
   - Only pending or confirmed appointments can be cancelled by a patient.
   - A patient cannot book the same service twice on the same day while a request is pending or confirmed.
   - Booking must fall within the 30-day horizon and match the service’s valid day.
   - Booking requires a completed patient profile.

5. **Frontend route guard — defense in depth**
   - `/app/*` redirects non-patients away.
   - `/staff/*` allows staff and admin; patients are redirected.
   - `/admin/*` allows only admin; other roles are redirected.
   - The sidebar is generated from the role, so admin-only items do not appear for staff.
   - These guards improve usability and reduce accidental access, but the API still enforces every rule.

### 1.4 Permission matrix

| Capability | Patient | Staff | Admin |
|---|---|---|---|
| Register / sign in | Public | Admin-created only | Seeded or admin-created |
| View and update own profile | Own only | No patient profile | No patient profile |
| View service catalog | Active services | All services | All services |
| Create or update a service | No | Yes | Yes |
| Book an appointment | Own only | Through walk-in | Through walk-in |
| Cancel an appointment | Own only | No patient cancel route | No patient cancel route |
| View appointment queue | No | Yes | Yes |
| Confirm / decline / complete an appointment | No | Yes | Yes |
| Create a walk-in | No | Yes | Yes |
| View patient directory and chart | No | Yes | Yes |
| Edit a patient chart | No | Yes | Yes |
| View announcements | Public feed | Yes | Yes |
| Create or update an announcement | No | Yes | Yes |
| Delete an announcement | No | No | Yes |
| View notifications | Own only | Own only | Own only |
| View reports and dashboard statistics | No | Yes | Yes, plus staff-account counts |
| Manage staff accounts | No | No | Yes |
| Change sign-in settings | No | No | Yes |
| Manage Google OAuth credentials | No | No | Yes |
| View own activity | Yes | Yes | Yes |
| View work-related activity | No | Yes | Yes |
| View the full activity log | No | No | Yes |
| Export the activity log as CSV | No | No | Yes |
| Purge expired activity entries | No | No | Yes |

Public endpoints are limited to things that are safe without login: the health check, the service catalog, active announcements, the public Google client ID, and the public Google sign-in on/off flag.

### 1.5 Ownership rules — the “rule” part of access control

These rules are applied even after a role check passes:

- **Patient appointments**
  - `GET /api/appointments/mine` filters by the signed-in patient.
  - `PATCH /api/appointments/:id/cancel` looks up `{ _id, patient: req.user.id }`.
  - A patient cannot cancel someone else’s appointment, even if they know the ID.

- **Patient profile**
  - `GET /api/patients/profile` and `PUT /api/patients/profile` use `req.user.id`; the client does not choose which user to update.
  - Staff and admin chart edits use `PATCH /api/patients/:id`, but the target must have `role: 'patient'`.

- **Notifications**
  - Listing is scoped to `recipient: req.user.id`.
  - Marking one notification as read requires both the notification ID and `recipient: req.user.id`.
  - Mark-all-read updates only the caller’s notifications.

- **Activity log**
  - A single `scopeFilter` function decides visibility for every activity query.
  - Admin gets no scope restriction.
  - Staff gets work categories plus entries where they are the actor.
  - Patients get entries linked to their patient record plus entries where they are the actor.
  - This prevents a patient from reading another patient’s activity and prevents staff from reading configuration events.

- **Records tied to patients**
  - Appointment and visit responses are built from controlled `present` functions, not by returning the raw database document.
  - This keeps internal fields such as `seedKey`, password hashes, and token material out of API responses.

### 1.6 Business-state rules that also protect data

These rules are not only workflow rules; they also prevent invalid or abusive state changes:

- A patient cannot book a past date or a date more than 30 days ahead.
- A patient cannot book a day when the service is not offered.
- A patient cannot create a duplicate pending/confirmed request for the same service and date.
- An inactive service cannot be booked.
- A walk-in must be for the current day.
- Only a pending appointment can be confirmed or declined.
- A decline requires a reason, and the reason is stored and logged.
- Only a confirmed appointment can be completed.
- Clinical fields (diagnosis, prescription, visit notes) are written by staff on completion and are read-only for patients.
- A patient with an incomplete Google-created profile is blocked from booking until the profile is completed. Reading and cancelling appointments remain available.
- Passwords must be at least 8 characters and contain at least two of: letters, numbers, and special characters.
- Birthdates must be valid and in the past for profile completion.
- Contact numbers must match the accepted Philippine formats in the profile flow.
- Free-text fields have server-side maximum lengths.

### 1.7 Account lifecycle and self-protection

- **Inactive accounts cannot sign in.** The login controller rejects `user.active === false` with the same generic message used for bad credentials.
- **`/api/auth/me` re-checks the database.** A deleted or deactivated account is rejected with 401 even if the token is still cryptographically valid.
- **The profile-completion gate re-checks the database.** It also respects a role change made after the token was issued.
- **Admins can reset a staff password.** A password value never enters the activity log; the log records only that a reset happened.
- **Admins cannot lock themselves out.** The Staff Accounts update route blocks self-demotion from admin and self-deactivation.
- **Staff cannot self-register.** Public registration always creates a patient, regardless of what the client sends.
- **Google sign-in never grants a role.** A new Google account is always a patient, and linking Google to an existing account never changes that account’s role.
- **The first privileged account is bootstrapped out-of-band.** The `seed:user` script creates an admin or staff account from the server CLI, not from the public API.

**Caveat about stateless sessions:** the role and active flag are stored inside the JWT at sign-in time. Most routes trust the token’s role and do not re-read the user. A role change or deactivation therefore takes effect on the **next login/token issuance**, not instantly on every already-issued token. `/me` and the profile-completion gate do re-check the database, but the general admin/staff routes do not. See the limitations section.

---

## 2. Activity Logs (Audit Trail)

### 2.1 Design principles

The activity log is designed as an accountability record, not a debugging log.

- **Server-written:** entries are created by controllers and services, not supplied directly by the browser.
- **Append-only at the API level:** there is no `PATCH` route and no per-entry `DELETE` route. The only removal is the admin retention purge.
- **Failure-aware:** failed sign-ins are recorded too, not just successful actions.
- **Non-blocking:** if writing an activity entry fails, the business action still succeeds. The logging error is printed to the API log instead of breaking the request.
- **Snapshot-friendly:** actor name and role are copied into the entry, so the history still reads correctly after a user is renamed or deleted.
- **Scoped visibility:** the same collection serves admin, staff, and patient views, but each role sees a different slice.
- **Retained, then purged:** entries are kept for 365 days; an admin can manually remove only expired entries.

### 2.2 What every entry contains

| Field | Meaning |
|---|---|
| `actor` | User ID of the person who performed the action. Nullable for a failed sign-in with no verified actor. |
| `actorName` | Snapshot of the actor’s name at the time of the action. |
| `actorRole` | `patient`, `staff`, `admin`, or empty when unknown. |
| `action` | Machine-readable action key, for example `appointment.confirm`. |
| `category` | Stored category used for filtering, for example `appointments`. |
| `targetType` | Type of the affected object, for example `appointment`, `patient`, `staff`, `announcement`, `service`, `settings`, `integration`, `activity`, or `auth`. |
| `targetId` | ID of the affected object when available. |
| `targetLabel` | Human-readable label, for example “Consultation on 2026-11-10” or a patient’s name. |
| `changes` | List of changed fields, each with a `field`, `from`, and `to` value. |
| `outcome` | `success` or `failed`. |
| `ip` | Client IP address, normalized by the request-context middleware. |
| `userAgent` | Browser/client user agent, truncated to 300 characters. |
| `detail` | Short human-readable explanation, truncated to 1,000 characters. |
| `createdAt` | Timestamp of the entry. Entries have no `updatedAt` by design. |
| `appointment` / `patient` | Optional direct references used by appointment and patient flows for scoping and investigation. |

Change values are truncated to 500 characters, and an entry stores at most 40 changed fields. Unchanged fields are dropped. Sensitive fields keep the fact that they changed but not the value.

The collection is indexed for the main investigation paths: newest-first, by category, by actor, and by target.

### 2.3 Event categories and actions

| Category | Actions written today |
|---|---|
| **auth** | `auth.login`, `auth.login_failed`, `auth.logout`, `auth.register` |
| **appointments** | `appointment.book`, `appointment.confirm`, `appointment.decline`, `appointment.cancel`, `appointment.complete`, `appointment.walkin` |
| **clinical** | `patient.update`, `record.update` |
| **people** | `patient.create`, `staff.create`, `staff.update` |
| **content** | `announcement.create`, `announcement.update`, `announcement.delete`, `service.create`, `service.update` |
| **configuration** | `settings.google.update`, `settings.google.reset`, `settings.signin.update`, `integration.update` (reserved for integration changes) |
| **system** | `activity.purge` |

What these cover in plain language:

- **Sign-in events:** successful login, failed login, logout, and patient self-registration.
- **Appointment events:** booking, confirmation, decline with reason, cancellation, completion, and walk-in booking.
- **Clinical events:** edits to a patient chart or clinical visit record.
- **People events:** creation of a patient at the front desk, creation of a staff/admin account, and updates to a staff/admin account.
- **Content events:** announcement creation, editing, and deletion; service creation and updates.
- **Configuration events:** Google OAuth credential updates and resets, and the Google sign-in on/off switch.
- **System events:** the activity-log purge itself.

`integration.update` exists in the allowed action list for future integration changes. The current Google settings flow uses the more specific `settings.google.*` actions.

### 2.4 What is deliberately not logged

The current audit trail records **actions**, not reads. It does not log:

- Opening a patient chart or reading a record.
- Viewing the appointment queue.
- Viewing reports or dashboards.
- Reading notifications or marking them read.
- Listing services or announcements.

This is an important boundary. If the project needs “who viewed this patient’s record,” that requires a separate read-audit design, because view events would be much higher volume and have different privacy and retention concerns.

### 2.5 Sensitive-data redaction

The logging service is designed so secrets do not leak into the audit trail.

- Field names matching password, secret, token, hash, authorization, cookie, API key, credential, Google ID, or session ID are treated as sensitive.
- For those fields, the entry records only `hidden → changed`, never the value.
- A staff password reset records `password: reset`; the actual password is never stored.
- A Google client-secret rotation records `clientSecret: changed`; the secret value is never stored.
- Login failures record only a **well-formed email address** that was attempted, never arbitrary typed text.
- Request bodies and authorization headers are not copied into the log.
- Detail text and change values are truncated to limit accidental data spill and storage abuse.

### 2.6 Who can see which entries

Visibility is decided in one place, so the same rules apply to the list, export, and count queries.

| Viewer | What they can see | What they cannot see |
|---|---|---|
| **Admin** | The full log, all categories, all actors, all targets. Can filter by actor, export CSV, view summary counts, and purge expired entries. | Cannot edit or delete individual entries. Cannot delete recent entries through the purge. |
| **Staff** | Appointment, clinical, and content work events. Their own sign-ins and their own actions. | Configuration events. Other staff members’ sign-ins. Staff account management events. The full system log. |
| **Patient** | Entries linked to their own patient record, their own appointments, their own profile edits, and actions they performed themselves. | Other patients’ records. Staff/admin events. Configuration events. The full system log. |

The patient view is intentionally narrow: it is a transparency feature for their own account, not a window into clinic operations.

### 2.7 Reading and filtering the log

The activity API supports:

- Category filter.
- Exact action filter.
- Actor name or actor ID filter.
- Target type and target ID filter.
- Outcome filter (`success` / `failed`).
- Free-text search across actor name, target label, detail, and action.
- Date range with `from` and `to`.
- Pagination with a default of 25 entries and a maximum of 100 per page.
- Newest-first ordering.

The UI exposes the same filters through the admin, staff, and patient activity pages. The admin page also shows summary tiles: events today, failed sign-ins in the last 24 hours, records edited in the last 7 days, and the total number of stored entries.

### 2.8 Export, retention, and purge

- **Retention window:** 365 days.
- **Export:** admin-only CSV. It respects the current filters and is capped at 10,000 rows. The file includes timestamp, actor, role, action, category, outcome, target details, IP, detail, and changes.
- **Purge:** admin-only and manual. The request must include `confirm: true`.
- **What purge deletes:** only entries strictly older than the 365-day cutoff. Recent entries are never touched.
- **Self-accounting:** after deleting expired rows, the purge writes a new `activity.purge` entry containing the admin, the cutoff, and the number of deleted rows. Because that entry is written after the delete, the purge cannot delete its own record.
- **No automatic purge job:** the cleanup is an explicit admin action. There is no scheduled purge in the current code.
- **Cache behavior:** activity read, summary, policy, and export responses are marked `no-store` so browsers and proxies do not cache sensitive audit data.

### 2.9 Where the activity log lives

- Model and action/category catalog: `apps/server/src/models/audit-log.model.js`
- Logging service, redaction, diffing, and retention helpers: `apps/server/src/services/activity.js`
- Read, filter, export, summary, and purge endpoints: `apps/server/src/controllers/activity.controller.js`
- Route guards: `apps/server/src/routes/activity.routes.js`
- Admin UI: `apps/web/src/routes/admin/activity.tsx`
- Staff UI: `apps/web/src/routes/staff/activity.tsx`
- Patient UI: `apps/web/src/routes/app/activity.tsx`
- Shared feed component: `apps/web/src/components/activity-log.tsx`

---

## 3. Other Security Features

### 3.1 Password security

- Passwords are hashed with **Node’s built-in scrypt**, not stored in plain text.
- Each password gets a random 16-byte salt.
- The derived key is 64 bytes.
- Verification uses `timingSafeEqual` to avoid timing leaks.
- The stored format is versioned: `scrypt$<salt>$<hash>`. This leaves room to change parameters later.
- Passwords must be at least 8 characters and contain at least two of: letters, numbers, and special characters on registration, staff creation, staff password reset, and operator seeding. Passwords are validated without trimming or alteration; whitespace counts as a special character.
- Passwords are never returned by the API and never written to the activity log.
- There is no self-service “forgot password” flow in v1. The login page tells users to ask the front desk. An admin can reset a staff password from Staff Accounts, and a server operator can use the seed script with `--force`.
- There is no password history or forced-password-change policy.

### 3.2 Session and token security

- A successful login or registration returns a **signed JWT**.
- The token contains the user ID (`sub`) and role.
- The default lifetime is **7 days** (`JWT_EXPIRES_IN`).
- Tokens are sent in the `Authorization: Bearer ...` header.
- `JWT_SECRET` is required at boot and must be at least 16 characters. The setup guidance recommends a 32-byte random hex value.
- The server does not use cookies for authentication in v1, which removes classic cookie-CSRF risk for the API.
- The client stores the session in `localStorage` under `healthcentria.session`.
- Logout records a server-side `auth.logout` entry, then the client discards the token.
- **Important:** sessions are stateless. The server cannot revoke an already-issued JWT. Logout is an audit event, not a server-side invalidation. See the limitations section.

### 3.3 HTTP and API hardening

- **Helmet** is enabled globally, adding standard security headers.
- **CORS** is restricted to the configured `CLIENT_URL`, so a browser page from another origin cannot read API responses.
- **JSON body parsing** is limited to JSON requests through `express.json()`.
- **Request logging** uses Morgan. In production it uses the combined format; in development it uses the dev format.
- **Request context middleware** captures the normalized client IP and user agent for activity entries.
- **404 handling** returns a generic JSON response instead of exposing framework details.
- **Error handling** returns a JSON error response and logs the server-side error.
- **Database outage handling** returns 503 for operations that need MongoDB rather than failing with an unclear error.
- **No-store** is used on activity data and admin Google settings responses.

### 3.4 Input validation and safe querying

- **Zod schemas** validate request bodies for authentication, appointments, patients, staff accounts, announcements, services, settings, reports, and activity queries.
- Enums are used for roles, statuses, sexes, service schedule modes, categories, outcomes, and time preferences. Unknown values are rejected.
- String fields have explicit maximum lengths; numeric fields have min/max bounds.
- Booking re-validates the service day, the 30-day horizon, and duplicate bookings on the server, so changing the browser request does not bypass the rules.
- Patient chart edits accept only profile fields; account fields such as role and password hash are intentionally absent from the schema.
- Search text used in regex filters is escaped before building the query, reducing regex-injection risk.
- Object IDs are validated in several controllers before lookup. Some other lookups rely on Mongoose casting, so malformed IDs can surface as server errors rather than clean 400/404 responses. See the limitations section.
- MongoDB is the only datastore, so SQL injection is not applicable. Zod validation and enum constraints reduce the risk of Mongo operator injection.
- React renders text content as text, and no `dangerouslySetInnerHTML` usage was found in the web app, which limits stored-XSS risk from announcement and note content.
- Duplicate email addresses are rejected by a unique index and by controller checks.

### 3.5 Google sign-in hardening

Google sign-in is implemented as a server-side OAuth 2.0 Authorization Code flow:

- The browser is redirected to Google with a signed, short-lived `state` value (10 minutes). The callback verifies that state, which protects against CSRF.
- The one-time authorization code is exchanged on the server; the client secret never reaches the browser.
- The returned ID token is verified against Google’s published JWKS keys.
- Verification checks:
  - RS256 signature.
  - Signing key ID and key rotation.
  - Issuer.
  - Audience (the configured client ID).
  - Expiry.
  - Issued-at time not in the future.
- `email_verified` must be true before the account is trusted.
- A new Google identity always becomes a **patient**. The role is hardcoded and never taken from the Google profile or the request.
- Linking Google to an existing local account does not change the existing role, password hash, or active state.
- The flow detects account mismatches: a Google identity cannot take over an account already linked to a different Google ID.
- Inactive accounts are rejected.
- An admin can turn Google sign-in off at runtime. The switch is checked both when the flow starts and when the callback completes, so a flow started before the switch was flipped cannot finish after it.
- Google credentials are resolved per request, so admin changes apply without restarting the API.
- If custom credentials cannot be decrypted, the server logs a warning and falls back to environment defaults instead of silently using broken credentials.

### 3.6 Secrets and OAuth credential storage

- Environment secrets live in `apps/server/.env`; `.env` is git-ignored, while `.env.example` is committed with placeholders.
- `JWT_SECRET` is required and length-checked at startup.
- Custom Google OAuth credentials saved from the admin UI are encrypted with **AES-256-GCM**.
- The encrypted payload contains the initialization vector, authentication tag, and ciphertext. The authentication tag detects tampering.
- Encryption uses `SETTINGS_ENCRYPTION_KEY`, which must be exactly 64 hex characters (32 bytes). If the key is missing or invalid, saving custom credentials fails with a clear error instead of storing a plaintext secret.
- The Google Client Secret is never returned in full. The admin API returns a masked value that reveals only the last four characters.
- The Google Client ID is masked by revealing roughly the first half.
- Submitting a blank value or the exact masked value means “keep the current value,” so the browser never needs the full stored secret.
- The public Google config endpoint returns only the client ID, which is public by design, and only when both credentials are configured.
- Google token-exchange errors deliberately omit Google’s response body because it can echo request context.

### 3.7 Data exposure minimization

- `presentUser` returns only ID, name, email, role, auth provider, profile-completion flag, and avatar URL. It does not return the password hash or Google subject ID.
- Staff account responses return ID, name, email, role, active flag, and timestamps — never the password hash.
- Patient list responses expose only the fields needed for the directory; full chart data is returned only from the patient detail endpoint.
- Activity entries are reshaped through a `present` function before leaving the server.
- The public announcements endpoint returns only active announcements.
- The public service catalog hides inactive services unless a staff/admin token is supplied.
- The public settings endpoint returns only `googleSignInEnabled`.
- The public Google config endpoint returns only the client ID.
- Walk-in creation of a new patient returns a temporary password only once to the staff member; it is not written to the activity log.

### 3.8 Privacy and consent

- Registration requires an explicit consent checkbox, and the server enforces `consent: true` with Zod. A request without consent is rejected.
- Registration collects only the fields needed to create the account; household and emergency details are optional at registration and can be completed later.
- Clinical fields are read-only for patients; patients can edit their own profile but not their diagnosis, prescription, or visit notes.
- Audit entries are visible to patients only for their own record, which supports transparency without exposing other patients.
- The activity log avoids storing secrets and truncates free text.

### 3.9 Operational resilience

- The API starts even if MongoDB is temporarily unreachable. It retries the connection with backoff and reports the real state through `/api/health`.
- Database-dependent controllers return 503 when the connection is not ready, rather than failing with an unclear error.
- The server handles graceful shutdown on SIGINT and SIGTERM, closing the HTTP server and the Mongoose connection.
- Mongoose uses `strictQuery` to avoid accidental query behavior from unknown fields.
- The server package has separate `dev`, `start`, seed, reminder, and type-check scripts. There is no build step because the server runs directly from source.

### 3.10 Frontend safety

- Role-based route guards redirect users away from areas their role cannot use.
- The sidebar is generated from the role, so admin-only entries are not shown to staff.
- The API client attaches the Bearer token only when a session exists.
- Destructive actions such as log purge and Google credential reset use confirmation dialogs.
- The admin Google settings screen receives masked credentials only, and the UI submits masked or blank values to mean “unchanged.”
- Activity views are read-only; there is no edit or delete control for individual entries.
- The login and registration pages display generic errors for invalid credentials.
- Patient clinical data is displayed read-only; editing is limited to the profile fields the API permits.

---

## 4. Current Limitations and Production Hardening

The controls above are real, but the system is still a v1 and has gaps that should be addressed before handling production health data at scale.

| Area | Current state | Risk / recommended next step |
|---|---|---|
| **Login rate limiting** | No rate limiter, account lockout, or CAPTCHA. | Credential stuffing and brute-force attempts are possible. Add IP- and account-based rate limits, progressive delays, lockout, and alerts on repeated `auth.login_failed` events. |
| **Multi-factor authentication** | Not implemented. | Admin accounts are high-value. Add MFA, at least for admins, before production. |
| **Password reset** | No self-service reset. Admins reset staff passwords; patients are told to ask the front desk. | Operational burden and weak account recovery. Add a signed, single-use, expiring reset token sent by email. |
| **Session revocation** | Stateless JWT, 7-day default, no refresh token, no server-side session store. Logout does not invalidate the token. | A stolen token stays valid until expiry, and role changes/deactivation do not apply instantly to every route. Add a token version or session record, shorten access-token lifetime, and use refresh tokens with revocation. |
| **Token storage** | JWT is stored in `localStorage`. | Any XSS can read it. Move to a `Secure`, `HttpOnly`, `SameSite` cookie with CSRF protection, or enforce a strict CSP and keep the XSS surface minimal. |
| **Role changes** | Role is embedded in the JWT. Most routes trust it until the token expires. | A demoted or deactivated user may retain access until re-login. Re-check the user on sensitive routes or use short-lived tokens plus revocation. |
| **Read auditing** | Only write/action events are logged. Record views are not logged. | The user story “who viewed resident records” is not fully met. If required, add a separate read-audit stream with its own retention and privacy rules. |
| **Log integrity** | Append-only at the API level, but not cryptographically chained or write-once. An admin can purge expired entries. | A database-level actor could alter rows. For stronger tamper evidence, add hash chaining, export to immutable storage, or dual-control purge. |
| **Field-level encryption** | Patient data relies on MongoDB Atlas encryption at rest and transport security; the app does not encrypt individual PHI fields. | If regulations require application-level protection, encrypt selected fields and manage key rotation. |
| **Automated backups** | No backup scheduler is implemented in this repository, although the system-flow document describes one as a requirement. | Add Atlas backup verification or a scheduled `mongodump`-style process, and test restores. |
| **Error disclosure** | The global error handler returns `err.message` to the client. | Internal details may leak. In production, return a generic 500 message and keep details in server logs. |
| **Proxy/IP trust** | Activity IP uses the first `X-Forwarded-For` value. | If the API is exposed directly, clients can spoof that header. Configure Express `trust proxy` and only trust a known reverse proxy. |
| **HTTP hardening** | Helmet defaults and CORS are enabled, but there is no app-specific CSP/HSTS policy in the repository. | Tune Helmet for the deployed frontend, enforce HTTPS, and set HSTS at the edge. |
| **Malformed IDs** | Some controllers validate ObjectIds; others rely on Mongoose casting. | Inconsistent errors and possible 500s. Add a shared ObjectId validation middleware. |
| **Email enumeration** | Login messages are generic, but registration returns 409 for an existing email. | This reveals whether an email is registered. Decide whether that tradeoff is acceptable; use a neutral response plus email verification if not. |
| **Demo fallback** | The web app can create a local demo session when the API is unreachable or auth routes return 404, inferring role from email prefixes such as `admin@`. | It does not grant API data without a real token, but it is unsafe for production. Disable the fallback in production builds. |
| **Monitoring and alerting** | Activity events exist, but there is no SIEM integration, alert rule, or anomaly detection. | Failed sign-ins and purges are only visible when someone opens the activity page. Add alerts for spikes, repeated failures, and configuration changes. |
| **Scheduled purge** | Purge is manual and admin-triggered. | Old data may accumulate. Add a scheduled purge with the same safeguards and audit entry, or a documented operational procedure. |
| **Security tests** | No automated security test suite is configured in the server package scripts. | Add tests for role boundaries, ownership checks, token expiry, redaction, and purge behavior. |
| **Permission editor** | Roles are fixed; there is no custom permission builder. | This is an intentional v1 scope decision, not a defect. Document it as such. |

---

## 5. Security at a Glance

| Control | Implemented? | Notes |
|---|---|---|
| Role-based route authorization | Yes | `requireAuth` + `requireRole` on protected routes. |
| Ownership checks | Yes | Patient records, appointments, notifications, and activity are scoped to the caller. |
| Server-side role assignment | Yes | Public registration and new Google accounts are always patients. |
| Password hashing | Yes | scrypt with random salt and timing-safe comparison. |
| JWT session | Yes | Signed token, 7-day default, Bearer header. |
| Token revocation | No | Stateless JWT; logout only writes an audit entry. |
| Activity/audit log | Yes | Append-only through the API, 7 categories, 25 action types. |
| Sensitive-field redaction | Yes | Passwords, tokens, secrets, hashes, and similar fields are never logged. |
| Scoped audit visibility | Yes | Admin full, staff work + own, patient own record only. |
| Audit CSV export | Yes | Admin only, filtered, capped at 10,000 rows. |
| Audit retention/purge | Yes | 365-day retention, manual admin purge, purge logs itself. |
| Google OAuth verification | Yes | State, JWKS signature, issuer, audience, expiry, verified email. |
| OAuth secret encryption | Yes | AES-256-GCM with authentication tag. |
| Credential masking | Yes | Client ID partially masked, secret last-four only. |
| Input validation | Yes | Zod schemas, enums, length limits, server-side business rules. |
| Security headers | Yes | Helmet defaults. |
| CORS restriction | Yes | Configured `CLIENT_URL` only. |
| Rate limiting / lockout | No | Recommended before production. |
| MFA | No | Recommended for admins. |
| Self-service password reset | No | Admin/desk-assisted only. |
| Automated backups | No | Described as a requirement but not implemented here. |
| Read/view auditing | No | Only write/action events are logged. |
| Field-level PHI encryption | No | Depends on Atlas encryption at rest. |

---

## 6. Source Map

| Concern | Main files |
|---|---|
| Authentication middleware and role checks | `apps/server/src/middleware/requireAuth.js` |
| Profile-completion gate | `apps/server/src/middleware/requireCompleteProfile.js` |
| JWT signing and verification | `apps/server/src/utils/tokens.js` |
| Password hashing | `apps/server/src/utils/password.js` |
| Login, registration, logout, Google OAuth | `apps/server/src/controllers/auth.controller.js` |
| Google token verification | `apps/server/src/utils/google.js` |
| User schema and roles | `apps/server/src/models/user.model.js` |
| Route permission map | `apps/server/src/routes/*.routes.js` |
| Appointment ownership and booking rules | `apps/server/src/controllers/appointment.controller.js` |
| Staff appointment actions and walk-ins | `apps/server/src/controllers/staff-appointment.controller.js` |
| Patient profile and chart rules | `apps/server/src/controllers/patient.controller.js` |
| Staff account management | `apps/server/src/controllers/staff.controller.js` |
| Activity model and action catalog | `apps/server/src/models/audit-log.model.js` |
| Activity logging, diffing, redaction, retention | `apps/server/src/services/activity.js` |
| Activity read/export/summary/purge API | `apps/server/src/controllers/activity.controller.js` |
| Activity route guards | `apps/server/src/routes/activity.routes.js` |
| Activity UI and scoped feed | `apps/web/src/components/activity-log.tsx`, `apps/web/src/routes/{admin,staff,app}/activity.tsx` |
| Admin settings and Google integration | `apps/server/src/controllers/settings.controller.js`, `apps/server/src/controllers/admin-settings.controller.js` |
| OAuth secret encryption | `apps/server/src/utils/secret-crypto.js` |
| Credential masking | `apps/server/src/utils/masking.js` |
| App hardening and middleware | `apps/server/src/app.js` |
| Request IP/user-agent context | `apps/server/src/middleware/requestContext.js` |
| Frontend session handling | `apps/web/src/lib/auth.ts` |
| Frontend API client | `apps/web/src/lib/api.ts` |
| Frontend route guards | `apps/web/src/routes/{app,staff,admin}/route.tsx` |
| Role-based sidebar | `apps/web/src/components/ops-nav.ts` |
| Seed/bootstrap of privileged accounts | `apps/server/src/scripts/seed-user.js` |
| Environment configuration | `apps/server/src/config/env.js`, `apps/server/.env.example` |

---

## 7. Bottom Line

HealthCentria already has a solid v1 security foundation:

- Clear separation of patient, staff, and admin capabilities.
- Server-side enforcement instead of relying on hidden buttons.
- Ownership checks that stop horizontal access between patients.
- An audit trail that is append-only through the API, scoped by role, and careful about secrets.
- Stronger-than-default handling for Google OAuth and stored OAuth credentials.

The biggest production gaps are **rate limiting, MFA, session revocation, secure token storage, automated backups, and read auditing**. Those should be treated as the next security work items rather than features that already exist.

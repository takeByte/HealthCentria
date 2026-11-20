# Concurrency control in HealthCentria

What happens when two people use the system at the same moment, and how HealthCentria keeps their work from colliding.

This document uses the real system as its examples.

---

## 1. The problem

A health center is a shared workspace. Things like these happen every day:

| Situation | What could go wrong without protection |
|---|---|
| Two staff open the same patient record. Both change the address. Both press Save. | The second save silently erases the first. This is a **lost update**. |
| A patient double-clicks "Book". | Two bookings are created. |
| Staff press "Complete visit" and the activity log write fails part-way. | The visit shows as completed, but the record of who completed it is missing. |
| An admin deletes a patient and the server stops half-way. | The patient is half anonymized: notes wiped but the name still there. |

Concurrency control is the set of techniques that prevent these. This document covers three families of technique, then shows where each one is used.

---

## 2. The three techniques in one table

| Technique | Idea | Cost | Where HealthCentria uses it |
|---|---|---|---|
| **Timestamp / version stamps** (optimistic) | Do not block anyone. Every record carries a version. A save only succeeds if the version is still the one the writer read. | Nobody waits. A rare conflict is reported and the user retries. | Edits on `/api/v2` (section 3) |
| **MVCC** (multi-version) | Keep consistent versions of the data, so readers always see a stable snapshot and never block writers. | Handled by the database. | The storage engine, on every read and inside each transaction snapshot (section 5). It does **not** detect a stale save. |
| **Locking** (pessimistic) | While one party works on something, block the others. | Others wait, and a lock that is never released can block people. | Field-level visit record locks (section 4) and compare-and-set |

**One distinction to keep straight.** MongoDB is MVCC inside the storage engine: a read sees a consistent snapshot, and a transaction reads from one snapshot. That is not the same as detecting a lost update between two separate HTTP requests. The application does that with **version stamps**, which is **optimistic concurrency control (OCC)**. The rest of this document keeps the two terms apart on purpose: MVCC is how the database serves reads and transaction snapshots; version stamps are how HealthCentria decides that a save is stale.

There is no single best technique. Optimistic checks suit editing forms where conflicts are rare. A transaction suits actions made of several writes that must succeed together. HealthCentria relies on version stamps for edits; they need no held lock to be reliable, and the version check is the safety net.

---

## 3. Version stamps (optimistic concurrency)

### How it works

1. Every record has a version number, `__v`. Mongoose keeps it up with `optimisticConcurrency: true` on the models for users, appointments, services and announcements.
2. The API sends the number to the screen as `version` whenever it returns a record.
3. When the user saves, the screen sends that `version` back.
4. The server saves **only if the record is still at that version**, in a single atomic step. If somebody else saved first, the version has moved on and the server answers **409**.
5. The screen keeps what the person typed and tells them to reload.

```
Editor A reads patient  -> version 3
Editor B reads patient  -> version 3
Editor A saves (v3)     -> saved, record is now version 4
Editor B saves (v3)     -> 409 EDIT_CONFLICT: "changed by someone else, reload"
```

The check happens twice on purpose:

- A readable check up front (`versionMatches` in `utils/concurrency.js`), which produces the friendly message.
- Mongoose's own save, which puts `__v` into the database filter. This closes the tiny gap between the check and the save, so two requests arriving in the same millisecond cannot both win.

### `save()` and update queries are guarded differently

Mongoose's `optimisticConcurrency` only adds `__v` to the filter when a document is saved through `save()`. It does **not** add it to `findOneAndUpdate`, `findByIdAndUpdate` or `updateOne`; those queries write whatever they are told, with no version check. So the code follows two rules:

- **`save()` paths** — patient chart, medical profile, service, announcement, staff account — get the save-time filter from Mongoose automatically. The up-front `versionMatches` only produces the friendly message; the save is the guarantee.
- **Update-query paths** — the visit record — put `versionFilterFor(req, before)` in the filter and `$inc: { __v: 1 }` in the update. A v2 client's version is used when sent. When a v1 client sends none, the version that was just read is used, so the write is still **compare-and-set** rather than last-write-wins.

Status changes (`confirm`, `decline`, `complete`, `cancel`) use the same idea with `status` as the token: `update ... where status is still 'confirmed'`, plus an increment of the version. That is why a visit cannot be completed twice.

### Why a counter and not a timestamp

The classic "timestamp ordering" idea compares times. In practice a version counter is safer:

- Two servers' clocks can disagree by a few seconds.
- Two saves can land in the same millisecond, giving equal timestamps.
- A counter only ever goes up, so it cannot be fooled by either.

`updatedAt` is still stored and returned, for people to read ("changed at 2:14 pm"), but it is not what decides a conflict.

### Where it applies

Patient record, medical profile, visit record, services, announcements and staff accounts. Confirm, decline, complete and cancel use a related technique: an atomic **compare-and-set** (`update ... where status is still 'confirmed'`), so two staff cannot both complete the same visit.

### Keeping an open form current

A version check alone would leave this annoying loop: a record changes, the open form still shows the old version, the person types, and the save is refused.

So an open record screen subscribes to the live change feed (WebSocket hints; the server only says *what* changed and each screen re-fetches through the normal API). When a change arrives:

- **Nothing is being typed:** the screen quietly re-fetches the record. The data on screen *and the version it will send* are current, so the next save simply works. No reload button, no lost draft.
- **A draft is open:** nothing is replaced. The screen shows "updated by someone else" and the person decides when to reload.

The same resync runs when the tab regains focus, when the WebSocket reconnects, and on a slow poll if the socket is blocked. So a change made while the page was asleep is picked up too.

"Typed" is tracked per screen: the patient form, the medical profile and the visit notes each report whether a draft exists. A draft is never overwritten by a background refresh; the server also refuses it if its version moved on, which is the safety net. The announcement composer and the service / staff account forms do not resync live, so a change made elsewhere is reported when the save is refused.

---

## 4. Locking

### What already protects you without any code

MongoDB locks each document for the instant of a write, so two writes to one document are never interleaved. That is why the version check above is reliable.

### Compare-and-set instead of a held lock

"Update this appointment **only if** its status is still confirmed" behaves like a lock that is held for one instant and released at once. It is the reason a visit can only be completed once, with no lock that could be forgotten.

### Small locks in the server

- **Backup running:** an in-memory flag stops two backups from overlapping.
- **Backup schedule:** the scheduler claims the day's slot before running, so a restart cannot run it twice.
- **PIN attempts and approvals:** counted in memory.

These work because there is **one server process**. See [Limits](#8-limits-and-next-steps).

### Field-level visit locks

The visit record screen can hold a **pessimistic lock per field**, not per record: one each for `diagnosis`, `prescription` and `visitNotes`. Two staff can work on different sections of the same visit at the same time, but nobody can start typing into a section someone else is already editing.

```
Staff A opens the visit record   -> claims Diagnosis, Prescription, Visit notes
Staff B opens the same visit     -> 423 FIELD_LOCKED for each section A holds
                                    B sees "A is editing" and those boxes are read-only
Staff A saves or cancels         -> sections released, B can type
```

The appointments queue shows the same holders at record level: while any section is held, the card says **"A is currently editing this visit"**, its **Complete visit** / **View / edit record** button is disabled, and the remaining lease is shown ("in about 8 min"). The queue re-reads this every 5 seconds, so the badge and the countdown update without a reload. The holder still sees the card (as "you are editing this in another tab"), and confirm/decline stay available.

How it behaves:

| Question | Answer |
|---|---|
| When is a lock taken? | As soon as the view/edit record screen opens. Nothing is typeable in a section until the claim attempt has been made. |
| What happens to the other tab? | The held section is disabled and labelled with the holder's **name**, resolved on the server from the login — never from the request body. |
| How does it end? | Save, Cancel, leaving the screen, or **expiry**. After a save the tab stops renewing, so the other editor can take over; the sections are claimed again on the next keystroke. |
| How is a crashed tab handled? | The lock is a **lease**: 10 minutes without a renewal, and it expires. A late release cannot delete a newer claim because each acquisition carries a nonce. |
| How does a closed tab block the record? | Up to the lease: a tab closed without Cancel keeps the record for the rest of the 10 minutes. Back/Cancel releases it at once; the long lease is the price of not dropping a lock while someone steps away from an open screen. |
| How is a stale claim taken over? | One atomic `findOneAndUpdate`, so a renewal and a takeover cannot both win. A unique index on `(appointmentId, section)` prevents two claims from existing. |
| How does the other tab find out? | It polls `GET /api/appointments/:id/record/locks` every 5 seconds while the screen is open. The holder renews every 60 seconds. A release is picked up on the next poll, and the blocked notice also has a **Reload this page** button for an immediate refresh. |
| Is it enforced? | The save is refused with **423 FIELD_LOCKED** only when another owner holds a section that the request would actually change. An unchanged field never blocks a save. |
| Does the queue button work for keyboard users? | It is `aria-disabled`, not natively `disabled`, and is described by the visible notice. A native disabled control cannot be focused, so keyboard and screen-reader users would never hear why it does not open. |
| How does the badge clear so quickly after a save? | The save waits for the release (capped at 1 s) before navigating, so the queue does not briefly show this tab as the editor. If the release never lands, the 10-minute lease still clears it. |
| Does it replace the version check? | **No.** The lock is advisory: a script, an older client, or the patient chart can call the API without claiming anything. The version check is still the guarantee. |

Endpoints (same permission as the record edit):

```
GET  /api/appointments/:id/record/locks            who holds each section
POST /api/appointments/:id/record/locks/acquire    claim all three (or report the blocked ones)
POST /api/appointments/:id/record/locks/release    give this tab's sections back
```

The tab identifies itself with `X-Edit-Owner`, a per-tab token kept in `sessionStorage`; it is not a credential and is only used to tell "my lock" from "someone else's".


---

## 5. MVCC and transactions

### MVCC in plain words

With MVCC the database keeps more than one version of the data at a time. A reader sees one consistent snapshot while a writer prepares a new version, so reading never has to wait for writing. MongoDB's storage engine does this for every read automatically.

### Transactions: all or nothing

A **transaction** groups several writes. It reads from one snapshot, and either **every** write is saved or **none** is (snapshot isolation). HealthCentria uses MongoDB Atlas, which supports them.

These actions are all-or-nothing:

| Action | Written together | Before |
|---|---|---|
| **Complete visit** | The status change, the clinical notes and their activity-log entries | A failure between steps left a completed visit without its log |
| **Edit a completed visit record** | The clinical update and its activity-log entry | A failure could save the notes without the record of who changed them |
| **Emergency walk-in, new patient** | The new patient account, the visit and their log entries | A failure could leave an account with no visit |
| **Delete patient** | Cancelling visits, wiping notes, deleting notifications and codes, anonymizing the account, and the log entry | A failure left a half-anonymized patient |

### The rule for emails and Google

Emails, Google Calendar and Drive cannot be rolled back. So they happen **after** the transaction commits. If one fails, the data is still correct and the failure is only logged.

---

## 6. Double submits: idempotency keys

A double-click or a retry after a slow network sends the same request twice. For "create" requests on `/api/v2`, the screen adds an `Idempotency-Key` header (one key per attempt). The server remembers the key for about 10 minutes:

- The first request creates the record and its result is stored.
- A repeat with the same key gets the **same result back** (header `Idempotent-Replay: true`) and creates nothing.
- Three simultaneous requests with one key create exactly one record.
- A **failed** request is forgotten, so a corrected retry can run.
- A new key means a new, deliberate request. Patients can still book the same service twice in a day.

Applies to booking, emergency walk-in, creating a staff account and posting an announcement.

---

## 7. API v2

The new behaviour lives under `/api/v2`. The old `/api` (v1) still works, so nothing breaks for older clients.

| | v1 `/api/...` | v2 `/api/v2/...` |
|---|---|---|
| Edit (PATCH) a record | No version needed. Last write wins, except Mongoose's save-time check. | **Must send `version`.** Out of date gives `409 EDIT_CONFLICT`. Missing gives `400 VERSION_REQUIRED`. |
| Create (POST) | Every request creates a record. | Optional `Idempotency-Key` header; a repeat returns the first result. |
| Permissions and validation | Same | **Same code**: v2 reuses the v1 routers, so a fix applies to both. |

Endpoints under v2: patients, patient medical profile, visit records, services, announcements and staff accounts (edits); booking, walk-in, announcements and staff accounts (creates). Every v2 response carries `X-API-Version: 2`.

Example:

```
PATCH /api/v2/patients/6af9...   { "address": "Purok 3", "version": 3 }

200 OK            { "patient": { ..., "version": 4 } }
409 Conflict      { "code": "EDIT_CONFLICT", "currentVersion": 4,
                    "message": "This patient record was changed by someone else ..." }
```

---

## 8. Limits and next steps

- **One server process** for the in-memory state. The backup lock, PIN lockout counters and approvals live in memory. If you ever run two copies of the server, they will not see each other. The fix is to keep that state in the database (or a shared lock). Not needed today. (The visit field locks are in MongoDB, so they do not have this limit.)
- **Conflicts are reported, not merged.** The user reloads and re-applies their change. Automatic merging of two edits is possible but rarely worth the complexity here. When nothing is being typed, the screen resyncs by itself and the person never sees the conflict.
- **Version granularity is the document; the lock granularity is the field.** Two edits to different fields of the same record still share one `__v`, so the second save can get `409 EDIT_CONFLICT` even though the other save touched a different field. The field lock reduces how often that happens by keeping two people out of the same box, but it does not give each field its own version. Field-level versions would add complexity this system does not need.
- **Visit field locks are advisory.** Any client that does not claim a section can still call the API; the version check is what makes the save safe. The lock exists to stop wasted typing, not to enforce access.
- **Idempotency memory is 10 minutes.** A retry after that creates a new record, by design.

---

## 9. Reducing the risk of transactions

Transactions touch the visit and delete flows, so they were added with these safeguards:

1. **A kill switch.** `USE_TRANSACTIONS=off` in `.env` returns to the old step-by-step behaviour without a code change.
2. **Narrow scope.** Only the four actions in section 5 use them, each a handful of writes.
3. **No outside calls inside.** Emails and Google calls run after commit, because the callback can be retried by MongoDB.
4. **Automatic retries** of transient errors, with a commit time limit of 10 seconds.
5. **Safe fallback.** On a database without transaction support (a standalone local server) the work runs once without a transaction, so development still works.
6. **Tested on a scratch database**, with failures injected on purpose: the visit, walk-in and delete flows each roll back completely (section below).
7. **Back up first.** Before enabling on live data, use **Admin > Backups > Back up now**.
8. **Roll out one flow at a time** and watch the Activity log. A failed transaction leaves no log entry for the change, which is the intended behaviour.
9. **Pairs with idempotency.** Retrying after a failed transaction cannot double-apply.

One deliberate choice to know about: the activity-log entry is written **inside** the transaction. That means the log can never describe a change that rolled back, but it also means that if the log write fails, the action fails and the user retries.

---

## 10. How the three work together on one visit

They act at three different moments, which is why none of them replaces the others.

```
Screen opens        Type                Save
     |                |                   |
  1. MVCC          3. Version check   ...
  (the screen       (nothing to do     ...
   reads a           until save)       ...
   snapshot)
     |
  2. Pessimistic lock
  (claim the three
   sections, show
   who holds them)
```

**1. MVCC (the database layer, always on).**
Every read on the screen sees one consistent snapshot, and the save runs inside `runInTransaction`: the `$set` of the clinical fields, the `$inc` of the version and the activity-log entry are one snapshot-isolated unit. A failure half-way writes nothing. This is MongoDB's own mechanism; nothing here re-implements it.

**2. Pessimistic lock (the prevention layer, at open).**
When the screen opens, the tab claims Diagnosis, Prescription and Visit notes. Another tab sees the holder's name, those fields are disabled, and a save that would change a held field is refused with `423 FIELD_LOCKED`. It prevents the wasted five minutes. It is a lease (10 minutes, renewed every 60 seconds) released on save, cancel or leaving the screen; a crashed tab therefore cannot freeze a section. After a save the tab does not grab the sections back: it stops renewing so the other editor can take over, and claims them again on the next keystroke.

**3. Optimistic version (the guarantee layer, at save).**
The record still carries `__v`. The save is pinned to the version the screen loaded (`versionFilterFor`), so even if a lock was bypassed, never taken, or expired at the wrong moment, a stale save **misses the filter and answers `409 EDIT_CONFLICT`** instead of overwriting the newer data.

What each one answers:

| If this happens | What catches it | What the user sees |
|---|---|---|
| Someone else is already typing in a section | Pessimistic lock | Field disabled, "X is editing", `423` if a save still tries |
| Someone saved first, after this screen loaded | Optimistic version | `409 EDIT_CONFLICT`, "reload to see the latest version" |
| The server dies between the note write and the log write | MVCC transaction | Nothing was written; the save is retried |
| A script or old client skips the locks | Optimistic version | `409`; it cannot silently overwrite |

In one sentence: **the lock stops the collision from starting, the version makes a lost update impossible, and the transaction makes the save atomic.**

Modified for this feature:

| File | Change |
|---|---|
| `apps/server/src/models/visit-field-lock.model.js` | New: per `(appointment, section)` lease, unique + TTL indexes |
| `apps/server/src/services/visit-locks.js` | New: atomic claim/renew/takeover, release, "held by others" |
| `apps/server/src/controllers/visit-lock.controller.js` | New: list / acquire / release endpoints |
| `apps/server/src/utils/edit-owner.js` | New: `X-Edit-Owner` / `X-Edit-Nonce` parsing |
| `apps/server/src/routes/appointment.routes.js` | Mounts the three lock routes |
| `apps/server/src/controllers/staff-appointment.controller.js` | Enforces locks on complete + record edit; record edit now runs in a transaction; releases after save; adds `editing` to each queue row |
| `apps/web/src/lib/api.ts` | `FieldLockedError` (423), lock types + calls, owner header on saves |
| `apps/web/src/lib/visit-lock.ts` | New: `useVisitLocks` - claim on open, 60 s renew while held, 5 s status poll, release on save, re-claim on the next keystroke |
| `apps/web/src/routes/staff/visits.$appointmentId.tsx` | Locked fields disabled with the holder's name; sends changed fields + owner; reclaims after save |
| `apps/web/src/routes/staff/appointments.tsx` | Queue shows "X is currently editing this visit", disables the visit links, and polls every 5 s |
| `docs/concurrency-control.md` | This document |


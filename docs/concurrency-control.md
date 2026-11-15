# Concurrency control in HealthCentria

What happens when two people use the system at the same moment, and how HealthCentria keeps their work from colliding.

This document uses the real system as its examples. Everything described here can be run and watched with one command (see [Try it yourself](#try-it-yourself)).

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
| **MVCC** (multi-version) | Keep consistent versions of the data, so readers always see a stable snapshot and never block writers. | Handled by the database. | Reads, and multi-step transactions (section 5) |
| **Locking** (pessimistic) | While one party works on something, block the others. | Others wait, and a lock that is never released can block people. | Inside the database, plus a few small locks in the server (section 4) |

There is no single best technique. Optimistic checks suit editing forms, where conflicts are rare and a lock would be annoying. Transactions suit actions made of several writes that must succeed together.

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
- Mongoose's own save, which puts `__v` into the database filter. This closes the tiny gap between the check and the save, so two requests arriving in the same millisecond cannot both win. (The demo proves this.)

### Why a counter and not a timestamp

The classic "timestamp ordering" idea compares times. In practice a version counter is safer:

- Two servers' clocks can disagree by a few seconds.
- Two saves can land in the same millisecond, giving equal timestamps.
- A counter only ever goes up, so it cannot be fooled by either.

`updatedAt` is still stored and returned, for people to read ("changed at 2:14 pm"), but it is not what decides a conflict.

### Where it applies

Patient record, medical profile, visit record, services, announcements and staff accounts. Confirm, decline, complete and cancel use a related technique: an atomic **compare-and-set** (`update ... where status is still 'confirmed'`), so two staff cannot both complete the same visit.

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

### Why there is no "being edited" lock

A pessimistic lock ("Nurse Joy is editing this record, wait") was considered and not chosen. If Joy closes her laptop, the lock stays until a timeout, and the whole team waits. The version check never blocks anyone and still stops overwrites.

---

## 5. MVCC and transactions

### MVCC in plain words

With MVCC the database keeps more than one version of the data at a time. A reader sees one consistent snapshot while a writer prepares a new version, so reading never has to wait for writing. MongoDB's storage engine does this for every read automatically.

### Transactions: all or nothing

A **transaction** groups several writes. It reads from one snapshot, and either **every** write is saved or **none** is (snapshot isolation). HealthCentria uses MongoDB Atlas, which supports them.

Three actions were made all-or-nothing:

| Action | Written together | Before |
|---|---|---|
| **Complete visit** | The status change, the clinical notes and their activity-log entries | A failure between steps left a completed visit without its log |
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

- **One server process.** The backup lock, PIN lockout counters and approvals live in memory. If you ever run two copies of the server, they will not see each other. The fix is to keep that state in the database (or a shared lock). Not needed today.
- **Conflicts are reported, not merged.** The user reloads and re-applies their change. Automatic merging of two edits is possible but rarely worth the complexity here.
- **Idempotency memory is 10 minutes.** A retry after that creates a new record, by design.

---

## 9. Reducing the risk of transactions

Transactions touch the visit and delete flows, so they were added with these safeguards:

1. **A kill switch.** `USE_TRANSACTIONS=off` in `.env` returns to the old step-by-step behaviour without a code change.
2. **Narrow scope.** Only the three actions in section 5 use them, each a handful of writes.
3. **No outside calls inside.** Emails and Google calls run after commit, because the callback can be retried by MongoDB.
4. **Automatic retries** of transient errors, with a commit time limit of 10 seconds.
5. **Safe fallback.** On a database without transaction support (a standalone local server) the work runs once without a transaction, so development still works.
6. **Tested on a scratch database**, with failures injected on purpose: the visit, walk-in and delete flows each roll back completely (section below).
7. **Back up first.** Before enabling on live data, use **Admin > Backups > Back up now**.
8. **Roll out one flow at a time** and watch the Activity log. A failed transaction leaves no log entry for the change, which is the intended behaviour.
9. **Pairs with idempotency.** Retrying after a failed transaction cannot double-apply.

One deliberate choice to know about: the activity-log entry is written **inside** the transaction. That means the log can never describe a change that rolled back, but it also means that if the log write fails, the action fails and the user retries.

---

## Try it yourself

From `apps/server`:

```
npm run demo:concurrency
```

It uses a throwaway database (never your real one), turns off emails and Google Calendar first, and deletes the database when finished. It prints a PASS or FAIL for each of these:

**A. Version checks**
- The current version saves; a stale one is refused with 409 and changes nothing.
- A missing version is refused with 400, and old v1 requests still work.
- Two simultaneous edits from the same version: exactly one wins.

**B. Double submits**
- A repeat with the same key returns the same booking.
- Three simultaneous requests with one key create exactly one booking.
- A new key creates a second booking, and a malformed key is refused.

**C. Transactions** (a step is broken on purpose)
- Complete visit: a failure leaves the visit untouched; a normal run saves the visit and both log entries.
- Walk-in: a failure creates neither the patient nor the visit; a retry with the same key then works.
- Delete patient: a failure leaves the patient fully intact; a normal run anonymizes and wipes notes together.

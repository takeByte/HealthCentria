// Concurrency control demo and test.
//
// Shows, on the real API, what happens when two people act at the same time:
//   A. Version checks   two staff edit the same record -> one saves, the other gets 409
//   B. Idempotency      a double-click or retry -> only one booking is created
//   C. Transactions     a step fails half-way -> nothing is left half-done
//
// Safe to run: it uses a separate SCRATCH database (dropped at the end), never the
// live one, and it switches off emails and Google Calendar before anything runs.
// Run from apps/server:   npm run demo:concurrency
import http from 'node:http';
import mongoose from 'mongoose';

// Block every outside service BEFORE the app loads: no real emails, no Google Calendar events.
// (dotenv does not override variables that already exist, even when empty.)
for (const k of ['RESEND_API_KEY','SMTP_HOST','SMTP_USER','SMTP_PASS','DEFAULT_SMTP_HOST','DEFAULT_SMTP_USER','DEFAULT_SMTP_PASS','GOOGLE_SERVICE_ACCOUNT_EMAIL','GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY','GOOGLE_CALENDAR_ID']) process.env[k] = '';

const base = new URL('../', import.meta.url).href;
const { env } = await import(base + 'config/env.js');

// Scratch database name derived from the real connection string, in memory only.
const url = new URL(env.MONGODB_URI);
const LIVE_DB = url.pathname.replace(/^\//, '');
const SCRATCH_DB = 'healthcentria_concurrency_scratch';
if (LIVE_DB === SCRATCH_DB) throw new Error('refusing to run: scratch name equals live name');
url.pathname = '/' + SCRATCH_DB;
await mongoose.connect(url.toString());
const dbName = mongoose.connection.db.databaseName;
if (dbName !== SCRATCH_DB) throw new Error('not connected to the scratch database: ' + dbName);
console.log('Connected to scratch database:', dbName, '(live database untouched)');

const { createApp } = await import(base + 'app.js');
const { User } = await import(base + 'models/user.model.js');
const { Service } = await import(base + 'models/service.model.js');
const { Appointment } = await import(base + 'models/appointment.model.js');
const { AuditLog } = await import(base + 'models/audit-log.model.js');
const { Notification } = await import(base + 'models/notification.model.js');
const { IdempotencyKey } = await import(base + 'models/idempotency-key.model.js');
const { signSession } = await import(base + 'utils/tokens.js');
const { hashPassword } = await import(base + 'utils/password.js');

// Safety check: prove outside services are really off before any data is written.
const { isGoogleCalendarConfigured } = await import(base + 'services/google-calendar.js');
const { sendEmail } = await import(base + 'utils/email.js');
const mailProbe = await sendEmail('probe@scratch.test', 'probe', 'probe');
if (isGoogleCalendarConfigured() || !mailProbe?.skipped) throw new Error('outside services are NOT blocked (calendar=' + isGoogleCalendarConfigured() + ', mail=' + JSON.stringify(mailProbe) + '): aborting');
console.log('Outside services blocked: no emails, no Google Calendar.');

// Make sure indexes (unique email, idempotency TTL) exist in the scratch database.
await Promise.all([User, Service, Appointment, IdempotencyKey].map((m) => m.init()));

const server = http.createServer(createApp());
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const call = async (method, path, { token, body, headers = {} } = {}) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try { data = await res.json(); } catch { /* none */ }
  return { status: res.status, data, replay: res.headers.get('idempotent-replay') };
};

let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed += 1; console.log('  PASS', name); }
  else { failed += 1; console.log('  FAIL', name, extra); }
};

try {
  // ---- fixtures ----
  const pw = await hashPassword('Scratch-pass-123');
  const admin = await User.create({ email: 'admin@scratch.test', passwordHash: pw, role: 'admin', fullName: 'Scratch Admin' });
  const patient = await User.create({
    email: 'patient@scratch.test', passwordHash: pw, role: 'patient', fullName: 'Scratch Patient',
    birthdate: new Date('2000-01-01'), sex: 'Female', address: 'Test', contactNumber: '09171234567',
  });
  const service = await Service.create({ name: 'Scratch Consult', schedule: { mode: 'weekly', weekdays: [1, 2, 3, 4, 5, 6] } });
  const adminToken = signSession(admin);
  const patientToken = signSession(patient);

  // ============ A. version checks ============
  console.log('\nA. Version checks (lost updates)');
  let r = await call('GET', `/api/patients/${patient.id}`, { token: adminToken });
  const v0 = r.data.patient.version;
  check('patient record carries a version', Number.isInteger(v0), JSON.stringify(r.data).slice(0, 80));

  r = await call('PATCH', `/api/v2/patients/${patient.id}`, { token: adminToken, body: { address: 'First edit', version: v0 } });
  check('v2 edit with the current version succeeds', r.status === 200 && r.data.patient.address === 'First edit', `${r.status}`);
  const v1 = r.data?.patient?.version;
  check('version moves forward after a save', v1 === v0 + 1, `v0=${v0} v1=${v1}`);

  r = await call('PATCH', `/api/v2/patients/${patient.id}`, { token: adminToken, body: { address: 'Stale edit', version: v0 } });
  check('v2 edit with a STALE version is refused (409 EDIT_CONFLICT)', r.status === 409 && r.data.code === 'EDIT_CONFLICT', `${r.status} ${r.data?.code}`);
  const stored = await User.findById(patient.id).lean();
  check('the stale edit did not overwrite the saved data', stored.address === 'First edit');

  r = await call('PATCH', `/api/v2/patients/${patient.id}`, { token: adminToken, body: { address: 'No version' } });
  check('v2 edit without a version is refused (400 VERSION_REQUIRED)', r.status === 400 && r.data.code === 'VERSION_REQUIRED', `${r.status} ${r.data?.code}`);

  r = await call('PATCH', `/api/patients/${patient.id}`, { token: adminToken, body: { address: 'Legacy v1 edit' } });
  check('v1 (old clients) still works without a version', r.status === 200 && r.data.patient.address === 'Legacy v1 edit', `${r.status}`);

  // two editors at the same instant with the same starting version
  r = await call('GET', `/api/patients/${patient.id}`, { token: adminToken });
  const vr = r.data.patient.version;
  const [r1, r2] = await Promise.all([
    call('PATCH', `/api/v2/patients/${patient.id}`, { token: adminToken, body: { address: 'Editor ONE', version: vr } }),
    call('PATCH', `/api/v2/patients/${patient.id}`, { token: adminToken, body: { address: 'Editor TWO', version: vr } }),
  ]);
  const codes = [r1.status, r2.status].sort();
  check('two simultaneous edits from the same version: exactly one wins, one gets 409', codes[0] === 200 && codes[1] === 409, JSON.stringify(codes));

  // ============ A2. MVCC `version` on announcements ============
  console.log('\nA2. MVCC version field (announcements)');
  const { Announcement } = await import(base + 'models/announcement.model.js');
  r = await call('POST', '/api/v2/announcements', { token: adminToken, body: { title: 'Task', body: 'v0 text', category: 'general' }, headers: { 'Idempotency-Key': 'mvcc-key-aaaaaaaaaaaaaaaa-1' } });
  const annId = r.data?.announcement?.id;
  let raw = await Announcement.collection.findOne({ _id: new mongoose.Types.ObjectId(annId) });
  check('new announcement is stored with version 0 in the database', raw?.version === 0, `stored=${raw?.version}`);

  // User A and User B both open it at version 0
  const [ra, rb] = [
    () => call('PATCH', `/api/v2/announcements/${annId}`, { token: adminToken, body: { body: 'edit by A', version: 0 } }),
    () => call('PATCH', `/api/v2/announcements/${annId}`, { token: adminToken, body: { body: 'edit by B', version: 0 } }),
  ];
  const rbRes = await rb(); // B saves first
  check('B saves from v0: 200 and version becomes 1', rbRes.status === 200 && rbRes.data.announcement.version === 1, `${rbRes.status}`);
  raw = await Announcement.collection.findOne({ _id: new mongoose.Types.ObjectId(annId) });
  check('database document now has version 1', raw.version === 1 && raw.body === 'edit by B', `v=${raw.version}`);
  const raRes = await ra(); // A still holds v0
  check('A saves from stale v0: refused with 409', raRes.status === 409 && raRes.data.code === 'EDIT_CONFLICT', `${raRes.status}`);
  check('409 carries the latest data (version 1, B text) so A syncs without reload', raRes.data?.current?.version === 1 && raRes.data?.current?.body === 'edit by B');
  raw = await Announcement.collection.findOne({ _id: new mongoose.Types.ObjectId(annId) });
  check('A did not overwrite anything (still version 1)', raw.version === 1 && raw.body === 'edit by B');

  // sync endpoint: detect change and fetch latest
  r = await call('GET', `/api/sync/announcements/${annId}?since=0`, { token: adminToken });
  check('sync with old version reports changed + latest data', r.data?.changed === true && r.data.version === 1 && r.data.announcement?.body === 'edit by B', JSON.stringify(r.data).slice(0, 100));
  r = await call('GET', `/api/sync/announcements/${annId}?since=1`, { token: adminToken });
  check('sync with current version reports unchanged (no data sent)', r.data?.changed === false && r.data.version === 1 && !r.data.announcement);

  // simultaneous saves from the same version: exactly one wins, version goes up by exactly 1
  const race = await Promise.all([1, 2, 3, 4, 5].map((n) => call('PATCH', `/api/v2/announcements/${annId}`, { token: adminToken, body: { body: `racer ${n}`, version: 1 } })));
  const wins = race.filter((x) => x.status === 200).length;
  const losses = race.filter((x) => x.status === 409).length;
  raw = await Announcement.collection.findOne({ _id: new mongoose.Types.ObjectId(annId) });
  check('5 simultaneous saves from v1: exactly one succeeds, four get 409', wins === 1 && losses === 4, `wins=${wins} losses=${losses}`);
  check('version increased by exactly 1 (now 2)', raw.version === 2, `v=${raw.version}`);

  // legacy document without a version field is treated as version 0
  const legacy = await Announcement.collection.insertOne({ title: 'Legacy', body: 'no version', category: 'general', images: [], pinned: false, active: true, publishedAt: new Date(), createdAt: new Date(), updatedAt: new Date() });
  r = await call('PATCH', `/api/v2/announcements/${legacy.insertedId}`, { token: adminToken, body: { body: 'migrated by edit', version: 0 } });
  check('legacy document (no version field) accepts version 0 and becomes version 1', r.status === 200 && r.data.announcement.version === 1, `${r.status}`);

  // ============ A3. MVCC `version` on patients, medical profile and visits ============
  console.log('\nA3. MVCC version field (patient record, medical profile, visits)');
  const rawUser = (id) => User.collection.findOne({ _id: new mongoose.Types.ObjectId(String(id)) });
  const rawAppt = (id) => Appointment.collection.findOne({ _id: new mongoose.Types.ObjectId(String(id)) });
  const pt = await User.create({
    email: 'mvcc-patient@scratch.test', passwordHash: pw, role: 'patient', fullName: 'Mvcc Patient',
    birthdate: new Date('1995-05-05'), sex: 'Female', address: 'Old address', contactNumber: '09171234567',
  });
  check('new patient is stored with a visible version field = 0', (await rawUser(pt.id)).version === 0, `v=${(await rawUser(pt.id)).version}`);

  // patient record: B saves first, A (stale) is refused and gets the latest chart back
  r = await call('PATCH', `/api/v2/patients/${pt.id}`, { token: adminToken, body: { address: 'Address by B', version: 0 } });
  check('patient record: save from v0 -> 200, version 1', r.status === 200 && r.data.patient.version === 1, `${r.status}`);
  check('patient record: database stores version 1', (await rawUser(pt.id)).version === 1);
  r = await call('PATCH', `/api/v2/patients/${pt.id}`, { token: adminToken, body: { address: 'Address by A', version: 0 } });
  check('patient record: stale save -> 409 with the latest chart', r.status === 409 && r.data.current?.version === 1 && r.data.current?.address === 'Address by B', `${r.status} ${JSON.stringify(r.data).slice(0, 90)}`);
  check('patient record: stale save wrote nothing', (await rawUser(pt.id)).address === 'Address by B' && (await rawUser(pt.id)).version === 1);

  // medical profile
  const med = (extra) => ({ bloodType: 'O+', allergies: ['Penicillin'], conditions: [], medications: [], immunizations: [], ...extra });
  r = await call('PATCH', `/api/v2/patients/${pt.id}/medical`, { token: adminToken, body: { ...med({}), version: 1 } });
  check('medical: save from v1 -> 200, version 2', r.status === 200 && r.data.patient.version === 2 && r.data.patient.medical.allergies[0] === 'Penicillin', `${r.status} ${JSON.stringify(r.data).slice(0, 80)}`);
  r = await call('PATCH', `/api/v2/patients/${pt.id}/medical`, { token: adminToken, body: { ...med({ allergies: ['Latex'] }), version: 1 } });
  check('medical: stale save -> 409 with latest medical data', r.status === 409 && r.data.current?.version === 2 && r.data.current?.medical?.allergies?.[0] === 'Penicillin', `${r.status}`);
  const medRace = await Promise.all([1, 2, 3, 4, 5].map((n) => call('PATCH', `/api/v2/patients/${pt.id}/medical`, { token: adminToken, body: { ...med({ conditions: [`c${n}`] }), version: 2 } })));
  check('medical: 5 simultaneous saves from v2 -> exactly one wins', medRace.filter((x) => x.status === 200).length === 1 && medRace.filter((x) => x.status === 409).length === 4, medRace.map((x) => x.status).join(','));
  check('medical: version went up by exactly 1 (now 3)', (await rawUser(pt.id)).version === 3, `v=${(await rawUser(pt.id)).version}`);

  // legacy documents without a version field
  await User.collection.updateOne({ _id: pt._id }, { $unset: { version: 1 } });
  r = await call('PATCH', `/api/v2/patients/${pt.id}`, { token: adminToken, body: { address: 'After legacy', version: 0 } });
  check('legacy patient (no version field) accepts version 0 -> becomes 1', r.status === 200 && (await rawUser(pt.id)).version === 1, `${r.status} v=${(await rawUser(pt.id)).version}`);
  const legacyStaff = await User.create({ email: 'legacy-staff@scratch.test', passwordHash: pw, role: 'staff', fullName: 'Legacy Staff' });
  await User.collection.updateOne({ _id: legacyStaff._id }, { $unset: { version: 1 } });
  r = await call('PATCH', `/api/v2/staff-accounts/${legacyStaff.id}`, { token: adminToken, body: { fullName: 'Legacy Renamed', version: 0 } });
  check('legacy staff account (save() path, no version field) still saves', r.status === 200, `${r.status} ${JSON.stringify(r.data).slice(0, 100)}`);

  // visits: two staff complete the same confirmed visit at the same moment
  const day3 = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 10); return d.toISOString().slice(0, 10); })();
  const mkVisit = () => Appointment.create({ patient: pt._id, service: service._id, day: day3, date: new Date(day3 + 'T12:00:00Z'), status: 'confirmed', timePreference: 'any', createdBy: admin._id });
  const visit = await mkVisit();
  check('new visit is stored with version 0', (await rawAppt(visit.id)).version === 0);
  const both = await Promise.all([
    call('PATCH', `/api/appointments/${visit.id}/complete`, { token: adminToken, body: { diagnosis: 'Dx from A', prescription: 'rx A', visitNotes: '' } }),
    call('PATCH', `/api/appointments/${visit.id}/complete`, { token: adminToken, body: { diagnosis: 'Dx from B', prescription: 'rx B', visitNotes: '' } }),
  ]);
  const completeStatuses = both.map((x) => x.status).sort();
  check('complete visit: two simultaneous completes -> one 200, one 409', completeStatuses[0] === 200 && completeStatuses[1] === 409, JSON.stringify(completeStatuses));
  const loser = both.find((x) => x.status === 409);
  check('complete visit: the 409 carries the latest visit (completed, with the winner\'s notes)', loser.data.current?.status === 'completed' && /^Dx from [AB]$/.test(loser.data.current?.diagnosis ?? ''), JSON.stringify(loser.data).slice(0, 120));
  let vRaw = await rawAppt(visit.id);
  check('complete visit: database version is 1 and holds exactly one set of notes', vRaw.version === 1 && /^Dx from [AB]$/.test(vRaw.diagnosis), `v=${vRaw.version}`);

  // visit record edits (the clinical notes on a completed visit)
  r = await call('PATCH', `/api/v2/appointments/${visit.id}/record`, { token: adminToken, body: { diagnosis: 'Corrected by B', version: 1 } });
  check('visit record: save from v1 -> 200, version 2', r.status === 200 && r.data.appointment.version === 2, `${r.status}`);
  r = await call('PATCH', `/api/v2/appointments/${visit.id}/record`, { token: adminToken, body: { diagnosis: 'Corrected by A', version: 1 } });
  check('visit record: stale save -> 409 with latest notes (version 2)', r.status === 409 && r.data.current?.version === 2 && r.data.current?.diagnosis === 'Corrected by B', `${r.status} ${JSON.stringify(r.data).slice(0, 90)}`);
  const recRace = await Promise.all([1, 2, 3, 4, 5].map((n) => call('PATCH', `/api/v2/appointments/${visit.id}/record`, { token: adminToken, body: { visitNotes: `race ${n}`, version: 2 } })));
  check('visit record: 5 simultaneous saves from v2 -> exactly one wins', recRace.filter((x) => x.status === 200).length === 1 && recRace.filter((x) => x.status === 409).length === 4, recRace.map((x) => x.status).join(','));
  check('visit record: version went up by exactly 1 (now 3)', (await rawAppt(visit.id)).version === 3);

  // confirm / decline race on a pending visit
  const pending = await Appointment.create({ patient: pt._id, service: service._id, day: day3, date: new Date(day3 + 'T12:00:00Z'), status: 'pending', timePreference: 'any', createdBy: admin._id });
  const cd = await Promise.all([
    call('PATCH', `/api/appointments/${pending.id}/confirm`, { token: adminToken }),
    call('PATCH', `/api/appointments/${pending.id}/decline`, { token: adminToken, body: { reason: 'Full' } }),
  ]);
  check('confirm vs decline at once: one wins, the other gets 409 + latest visit', cd.filter((x) => x.status === 200).length === 1 && cd.find((x) => x.status === 409)?.data?.current?.version === 1, cd.map((x) => x.status).join(','));
  check('confirm/decline: database version is exactly 1', (await rawAppt(pending.id)).version === 1);

  // ============ B. idempotent creates ============
  console.log('\nB. Double submits (idempotency)');
  const nextMonday = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7)); return d.toISOString().slice(0, 10); })();
  const bookBody = { serviceId: service.id, day: nextMonday, timePreference: 'any', notes: '' };
  const key1 = 'test-key-aaaaaaaaaaaaaaaa-0001';
  r = await call('POST', '/api/v2/appointments', { token: patientToken, body: bookBody, headers: { 'Idempotency-Key': key1 } });
  check('first booking succeeds (201)', r.status === 201, `${r.status} ${JSON.stringify(r.data).slice(0, 100)}`);
  const firstId = r.data?.appointment?.id;
  r = await call('POST', '/api/v2/appointments', { token: patientToken, body: bookBody, headers: { 'Idempotency-Key': key1 } });
  check('repeat with the same key returns the SAME booking (replay)', r.status === 201 && r.data.appointment.id === firstId && r.replay === 'true', `${r.status} replay=${r.replay}`);
  const key2 = 'test-key-bbbbbbbbbbbbbbbb-0002';
  const burst = await Promise.all([1, 2, 3].map(() => call('POST', '/api/v2/appointments', { token: patientToken, body: bookBody, headers: { 'Idempotency-Key': key2 } })));
  const created = burst.filter((x) => x.status === 201 && x.replay !== 'true').length;
  check('three simultaneous requests with one key create only ONE booking', created === 1, burst.map((x) => `${x.status}${x.replay ? 'R' : ''}`).join(','));
  const count = await Appointment.countDocuments({ patient: patient._id });
  check('database holds exactly 2 bookings (key1 and key2), not 5', count === 2, `count=${count}`);
  r = await call('POST', '/api/v2/appointments', { token: patientToken, body: bookBody, headers: { 'Idempotency-Key': 'test-key-cccccccccccccccc-0003' } });
  check('a deliberate second booking with a NEW key is allowed', r.status === 201);
  check('a bad key format is rejected', (await call('POST', '/api/v2/appointments', { token: patientToken, body: bookBody, headers: { 'Idempotency-Key': 'x' } })).status === 400);

  // ============ C. transactions ============
  console.log('\nC. All-or-nothing actions (transactions)');
  // pick a confirmed visit to complete
  const toComplete = await Appointment.create({
    patient: patient._id, service: service._id, day: nextMonday, date: new Date(nextMonday + 'T12:00:00Z'),
    status: 'confirmed', timePreference: 'any', createdBy: admin._id,
  });

  // C1: break the audit-log write and make sure the visit is NOT left half-completed
  const realCreate = AuditLog.create.bind(AuditLog);
  AuditLog.create = async (docs, ...rest) => {
    const first = Array.isArray(docs) ? docs[0] : docs;
    if (first?.action === 'appointment.complete') throw new Error('injected failure');
    return realCreate(docs, ...rest);
  };
  r = await call('PATCH', `/api/appointments/${toComplete.id}/complete`, { token: adminToken, body: { diagnosis: 'Should roll back', prescription: 'x', visitNotes: 'x' } });
  let after = await Appointment.findById(toComplete.id).lean();
  check('complete-visit: a failure part-way leaves the visit untouched (rollback)', after.status === 'confirmed' && !after.diagnosis, `status=${after.status} dx=${after.diagnosis} http=${r.status}`);
  AuditLog.create = realCreate;

  r = await call('PATCH', `/api/appointments/${toComplete.id}/complete`, { token: adminToken, body: { diagnosis: 'Real diagnosis', prescription: 'Rest', visitNotes: 'Ok' } });
  after = await Appointment.findById(toComplete.id).lean();
  const logs = await AuditLog.countDocuments({ appointment: toComplete._id, action: { $in: ['appointment.complete', 'record.update'] } });
  check('complete-visit: normal run commits the visit and both log entries', r.status === 200 && after.status === 'completed' && logs === 2, `http=${r.status} status=${after.status} logs=${logs}`);
  r = await call('PATCH', `/api/appointments/${toComplete.id}/complete`, { token: adminToken, body: { diagnosis: 'Again' } });
  check('complete-visit: completing twice is refused (409)', r.status === 409, `${r.status}`);

  // C2: walk-in with a NEW patient; break the second log and confirm no account and no visit remain
  const usersBefore = await User.countDocuments();
  const apptsBefore = await Appointment.countDocuments();
  AuditLog.create = async (docs, ...rest) => {
    const first = Array.isArray(docs) ? docs[0] : docs;
    if (first?.action === 'patient.create') throw new Error('injected failure');
    return realCreate(docs, ...rest);
  };
  r = await call('POST', '/api/v2/appointments/walk-in', {
    token: adminToken, body: { serviceId: service.id, newPatient: { fullName: 'Rollback Test Person' } },
    headers: { 'Idempotency-Key': 'walkin-key-aaaaaaaaaaaaaaa-1' },
  });
  check('walk-in: a failure part-way creates NEITHER the patient NOR the visit',
    (await User.countDocuments()) === usersBefore && (await Appointment.countDocuments()) === apptsBefore,
    `users ${usersBefore}->${await User.countDocuments()} appts ${apptsBefore}->${await Appointment.countDocuments()} http=${r.status}`);
  AuditLog.create = realCreate;
  // Retry with the SAME key as the failed attempt: a failure must not be remembered.
  r = await call('POST', '/api/v2/appointments/walk-in', {
    token: adminToken, body: { serviceId: service.id, newPatient: { fullName: 'Walk In Person' } },
    headers: { 'Idempotency-Key': 'walkin-key-aaaaaaaaaaaaaaa-1' },
  });
  check('walk-in: normal run creates the patient and the visit together',
    r.status === 201 && (await User.countDocuments()) === usersBefore + 1 && (await Appointment.countDocuments()) === apptsBefore + 1,
    `http=${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
  check('walk-in: the retry used the same key as the failed attempt and still worked (failures are not remembered)', r.status === 201 && r.replay !== 'true', `http=${r.status} replay=${r.replay}`);

  // C3: delete-patient flow, called directly (the route needs the superadmin PIN and an email approval)
  const { deletePatient } = await import(base + 'controllers/patient.controller.js');
  const victim = await User.create({
    email: 'victim@scratch.test', passwordHash: pw, role: 'patient', fullName: 'Victim Patient',
    birthdate: new Date('1990-01-01'), sex: 'Male', address: 'Somewhere', contactNumber: '09170000000',
  });
  const vAppt = await Appointment.create({
    patient: victim._id, service: service._id, day: nextMonday, date: new Date(nextMonday + 'T12:00:00Z'),
    status: 'completed', timePreference: 'any', diagnosis: 'Secret dx', prescription: 'Secret rx', createdBy: admin._id,
  });
  await Notification.create({ recipient: victim._id, type: 'new-request', title: 'x', body: 'x', link: '/x', key: 'scratch-n1' }).catch(() => {});
  const fakeRes = () => {
    const out = { status: 200, body: null };
    return { out, status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; }, set() { return this; } };
  };
  const callDelete = (id) => new Promise((resolve) => {
    const res = fakeRes();
    const origJson = res.json.bind(res);
    res.json = (b) => { origJson(b); resolve(res.out); return res; };
    deletePatient({ params: { id }, user: { id: String(admin._id), role: 'admin' }, ctx: {} }, res, (err) => resolve({ status: 500, body: String(err) }));
  });

  AuditLog.create = async (docs, ...rest) => {
    const first = Array.isArray(docs) ? docs[0] : docs;
    if (first?.action === 'patient.delete') throw new Error('injected failure');
    return realCreate(docs, ...rest);
  };
  const failedDelete = await callDelete(String(victim._id));
  const vUser = await User.findById(victim._id).lean();
  const vVisit = await Appointment.findById(vAppt._id).lean();
  check('delete-patient: a failure at the last step leaves the patient fully intact (rollback)',
    vUser.fullName === 'Victim Patient' && !vUser.deletedAt && vVisit.diagnosis === 'Secret dx',
    `name=${vUser.fullName} deletedAt=${vUser.deletedAt} dx=${vVisit.diagnosis} http=${failedDelete.status}`);
  AuditLog.create = realCreate;

  const okDelete = await callDelete(String(victim._id));
  const vUser2 = await User.findById(victim._id).lean();
  const vVisit2 = await Appointment.findById(vAppt._id).lean();
  check('delete-patient: normal run anonymizes the patient and wipes clinical notes together',
    okDelete.status === 200 && vUser2.fullName === 'Deleted patient' && !!vUser2.deletedAt && !vVisit2.diagnosis && !vVisit2.prescription,
    `http=${okDelete.status} name=${vUser2.fullName} dx=${vVisit2.diagnosis}`);
} catch (err) {
  failed += 1;
  console.log('TEST SCRIPT ERROR:', err?.stack ?? err);
} finally {
  await mongoose.connection.db.dropDatabase().catch(() => {});
  console.log('\nScratch database dropped.');
  await mongoose.disconnect();
  server.close();
  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

// Live updates (WebSocket) demo and test.
//
// Opens real WebSocket connections for several people and checks WHO hears about a change:
//   - the right people are told (and only them),
//   - the tab that made the change is not echoed,
//   - the message carries no personal data (just a topic and ids).
//
// Safe to run: it uses a separate SCRATCH database (dropped at the end), never the live
// one, and it switches off emails and Google Calendar before anything runs.
// Run from apps/server:   npm run demo:realtime
import http from 'node:http';
import mongoose from 'mongoose';
import { io as connectSocket } from 'socket.io-client';

// Block every outside service BEFORE the app loads (dotenv never overrides variables that already exist).
for (const k of ['RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'DEFAULT_SMTP_HOST', 'DEFAULT_SMTP_USER', 'DEFAULT_SMTP_PASS', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY', 'GOOGLE_CALENDAR_ID']) process.env[k] = '';

const base = new URL('../', import.meta.url).href;
const { env } = await import(base + 'config/env.js');

const url = new URL(env.MONGODB_URI);
const LIVE_DB = url.pathname.replace(/^\//, '');
const SCRATCH_DB = 'healthcentria_realtime_scratch';
if (LIVE_DB === SCRATCH_DB) throw new Error('refusing to run: scratch name equals live name');
url.pathname = '/' + SCRATCH_DB;
await mongoose.connect(url.toString());
if (mongoose.connection.db.databaseName !== SCRATCH_DB) throw new Error('not connected to the scratch database');
console.log('Connected to scratch database:', SCRATCH_DB, '(live database untouched)');

const { isGoogleCalendarConfigured } = await import(base + 'services/google-calendar.js');
const { sendEmail } = await import(base + 'utils/email.js');
const mailProbe = await sendEmail('probe@scratch.test', 'probe', 'probe');
if (isGoogleCalendarConfigured() || !mailProbe?.skipped) throw new Error('outside services are NOT blocked: aborting');
console.log('Outside services blocked: no emails, no Google Calendar.');

const { createApp } = await import(base + 'app.js');
const { initRealtime, closeRealtime } = await import(base + 'realtime.js');
const { User } = await import(base + 'models/user.model.js');
const { Service } = await import(base + 'models/service.model.js');
const { signSession } = await import(base + 'utils/tokens.js');
const { hashPassword } = await import(base + 'utils/password.js');
await Promise.all([User, Service].map((m) => m.init()));

const server = http.createServer(createApp());
initRealtime(server);
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const origin = `http://127.0.0.1:${port}`;

const call = async (method, path, { token, body, socketId } = {}) => {
  const res = await fetch(origin + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(socketId ? { 'X-Socket-Id': socketId } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try { data = await res.json(); } catch { /* none */ }
  return { status: res.status, data };
};

const sockets = [];
function listen(name, token) {
  return new Promise((resolve) => {
    const socket = connectSocket(origin, { auth: { token }, transports: ['websocket'], reconnection: false });
    const person = { name, socket, events: [], connected: false, error: null };
    socket.on('connect', () => { person.connected = true; resolve(person); });
    socket.on('connect_error', (e) => { person.error = e.message; resolve(person); });
    socket.on('change', (msg) => person.events.push(msg));
    sockets.push(socket);
  });
}
const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));
const heard = (p, topic) => p.events.some((e) => e.topic === topic);
const reset = (...people) => people.forEach((p) => { p.events.length = 0; });

let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed += 1; console.log('  PASS', name); }
  else { failed += 1; console.log('  FAIL', name, extra); }
};

try {
  const pw = await hashPassword('Scratch-pass-123');
  const admin = await User.create({ email: 'admin@scratch.test', passwordHash: pw, role: 'admin', fullName: 'Scratch Admin' });
  const limitedStaff = await User.create({ email: 'staff@scratch.test', passwordHash: pw, role: 'staff', fullName: 'Limited Staff', permissions: ['announcements.manage'] });
  const mk = (email, name) => User.create({ email, passwordHash: pw, role: 'patient', fullName: name, birthdate: new Date('2000-01-01'), sex: 'Female', address: 'Test', contactNumber: '09171234567' });
  const patientA = await mk('a@scratch.test', 'Patient A');
  const patientB = await mk('b@scratch.test', 'Patient B');
  const service = await Service.create({ name: 'Scratch Consult', schedule: { mode: 'weekly', weekdays: [1, 2, 3, 4, 5, 6] } });
  const tokens = { admin: signSession(admin), staff: signSession(limitedStaff), a: signSession(patientA), b: signSession(patientB) };

  console.log('\nConnecting');
  const refused = await listen('nobody', 'not-a-real-token');
  check('a connection with no valid login is refused', !refused.connected && refused.error === 'unauthorized', `connected=${refused.connected} error=${refused.error}`);
  const [adm, stf, pa, pb] = await Promise.all([listen('admin', tokens.admin), listen('limited staff', tokens.staff), listen('patient A', tokens.a), listen('patient B', tokens.b)]);
  check('admin, staff and both patients connect with a valid login', adm.connected && stf.connected && pa.connected && pb.connected);

  console.log('\nA patient books an appointment');
  const nextMonday = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7)); return d.toISOString().slice(0, 10); })();
  reset(adm, stf, pa, pb);
  let r = await call('POST', '/api/appointments', { token: tokens.a, socketId: pa.socket.id, body: { serviceId: service.id, day: nextMonday, timePreference: 'any', notes: '' } });
  await settle();
  const apptId = r.data?.appointment?.id;
  check('booking succeeds', r.status === 201, `${r.status}`);
  check('admin is told "appointments changed"', heard(adm, 'appointments'));
  check('admin is told about the new notification', heard(adm, 'notifications'));
  check('the patient who booked is NOT echoed their own change', !heard(pa, 'appointments'), JSON.stringify(pa.events));
  check('another patient hears nothing', pb.events.length === 0, JSON.stringify(pb.events));
  check('staff without the Appointments permission hears nothing about appointments', !heard(stf, 'appointments'), JSON.stringify(stf.events));

  console.log('\nAn admin confirms it');
  reset(adm, stf, pa, pb);
  r = await call('PATCH', `/api/appointments/${apptId}/confirm`, { token: tokens.admin, socketId: adm.socket.id });
  await settle();
  check('confirm succeeds', r.status === 200, `${r.status}`);
  check('the patient is told their appointment changed', heard(pa, 'appointments'));
  check('the patient is told about the new notification', heard(pa, 'notifications'));
  check('the other patient hears nothing', pb.events.length === 0, JSON.stringify(pb.events));
  check('the admin who confirmed is not echoed', !heard(adm, 'appointments'), JSON.stringify(adm.events));

  console.log('\nAn announcement is posted');
  reset(adm, stf, pa, pb);
  r = await call('POST', '/api/announcements', { token: tokens.admin, body: { title: 'Scratch announcement', body: 'Hello', category: 'general', pinned: false } });
  await settle();
  check('announcement is created', r.status === 201, `${r.status} ${JSON.stringify(r.data).slice(0, 80)}`);
  check('everyone signed in hears about it', heard(adm, 'announcements') && heard(stf, 'announcements') && heard(pa, 'announcements') && heard(pb, 'announcements'));

  console.log('\nA patient record is edited');
  reset(adm, stf, pa, pb);
  const got = await call('GET', `/api/patients/${patientA.id}`, { token: tokens.admin });
  r = await call('PATCH', `/api/v2/patients/${patientA.id}`, { token: tokens.admin, socketId: adm.socket.id, body: { address: 'New address', version: got.data.patient.version } });
  await settle();
  check('record edit succeeds', r.status === 200, `${r.status}`);
  check('that patient is told their record changed', heard(pa, 'patients'));
  check('the other patient hears nothing', pb.events.length === 0, JSON.stringify(pb.events));
  check('staff without the Patients permission hears nothing', !heard(stf, 'patients'), JSON.stringify(stf.events));

  console.log('\nWhat the messages contain');
  const everything = [...adm.events, ...stf.events, ...pa.events, ...pb.events];
  // `version` is the record's MVCC counter (a plain number), so open editors can tell they are behind.
  const allowed = new Set(['topic', 'id', 'patient', 'version']);
  check('messages carry only a topic, ids and a version number, never names, addresses or notes',
    everything.every((e) => Object.keys(e).every((k) => allowed.has(k))) && !JSON.stringify(everything).includes('New address'),
    JSON.stringify(everything).slice(0, 200));
} catch (err) {
  failed += 1;
  console.log('TEST SCRIPT ERROR:', err?.stack ?? err);
} finally {
  sockets.forEach((s) => s.disconnect());
  await closeRealtime().catch(() => {});
  await mongoose.connection.db.dropDatabase().catch(() => {});
  console.log('\nScratch database dropped.');
  await mongoose.disconnect();
  server.close();
  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

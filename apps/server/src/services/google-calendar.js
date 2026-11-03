import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { Appointment } from '../models/appointment.model.js';
import { CalendarEventLink } from '../models/calendar-event-link.model.js';
import { isGoogleCalendarSyncEnabled } from '../models/app-settings.model.js';
import { addDaysYMD, todayYMD } from '../utils/service-schedule.js';

/**
 * One-way Google Calendar mirror.
 *
 * Design rules:
 *  - The app is the source of truth. Google Calendar is only a view.
 *  - Only confirmed appointments and walk-ins are written.
 *  - Failures never throw into the appointment controller.
 *  - The event id is deterministic, so a retry cannot create duplicates.
 *  - No clinical notes, diagnosis, prescription, contact details, or attendees
 *    are sent to Google.
 */

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ERROR_CHARS = 300;

const CONFIRMED_STATUSES = new Set(['confirmed', 'completed']);

let tokenCache = { accessToken: '', expiresAt: 0 };
let tokenRequest = null;

function normalizePrivateKey(value) {
  return String(value ?? '')
    .replace(/\\n/g, '\n')
    .trim()
    .replace(/^["']|["']$/g, '');
}

function calendarConfig() {
  return {
    calendarId: String(env.GOOGLE_CALENDAR_ID ?? '').trim(),
    serviceAccountEmail: String(env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? '').trim(),
    privateKey: normalizePrivateKey(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY),
    timezone: String(env.GOOGLE_CALENDAR_TIMEZONE ?? 'Asia/Manila').trim() || 'Asia/Manila',
    location: String(env.GOOGLE_CALENDAR_LOCATION ?? '').trim(),
  };
}

export function isGoogleCalendarConfigured() {
  const config = calendarConfig();
  return Boolean(config.calendarId && config.serviceAccountEmail && config.privateKey);
}

function shortError(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > MAX_ERROR_CHARS ? `${text.slice(0, MAX_ERROR_CHARS - 1)}…` : text;
}

function errorMessage(error) {
  return shortError(error instanceof Error ? error.message : 'Unknown Google Calendar error.');
}

function googleErrorMessage(result) {
  const detail = result?.data?.error?.message;
  return `Google Calendar request failed (${result?.status ?? 'unknown'})${detail ? `: ${shortError(detail)}` : '.'}`;
}

function eventIdFor(appointment) {
  // Google event ids allow base32hex characters. The ObjectId hex string is a
  // safe subset, and the "hc" prefix makes the origin obvious.
  return `hc${String(appointment?._id ?? appointment).toLowerCase()}`;
}

async function getAccessToken(force = false) {
  if (!force && tokenCache.accessToken && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.accessToken;
  }
  if (tokenRequest) return tokenRequest;

  tokenRequest = (async () => {
    const config = calendarConfig();
    if (!config.serviceAccountEmail || !config.privateKey) {
      throw new Error('Google Calendar service account credentials are missing.');
    }

    const now = Math.floor(Date.now() / 1000);
    let assertion;
    try {
      assertion = jwt.sign(
        {
          iss: config.serviceAccountEmail,
          scope: CALENDAR_SCOPE,
          aud: TOKEN_ENDPOINT,
          iat: now,
          exp: now + 3600,
        },
        config.privateKey,
        { algorithm: 'RS256' },
      );
    } catch {
      throw new Error('Could not sign the Google service account request. Check GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.');
    }

    let response;
    try {
      response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(
        `Could not reach Google's token endpoint (${error?.name === 'TimeoutError' ? 'timeout' : 'network error'}).`,
      );
    }

    if (!response.ok) {
      // Deliberately omit the response body: it can echo request context.
      throw new Error(`Google service account token request failed (${response.status}).`);
    }

    const data = await response.json().catch(() => null);
    if (!data?.access_token) {
      throw new Error('Google did not return an access token for the service account.');
    }

    const expiresIn = Number(data.expires_in) || 3600;
    tokenCache = {
      accessToken: data.access_token,
      expiresAt: Date.now() + expiresIn * 1000,
    };
    return tokenCache.accessToken;
  })().finally(() => {
    tokenRequest = null;
  });

  return tokenRequest;
}

async function calendarRequest(method, path, { query, body, retry = true } = {}) {
  const token = await getAccessToken();
  const url = new URL(`${CALENDAR_API_BASE}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
  }

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(
      `Could not reach Google Calendar (${error?.name === 'TimeoutError' ? 'timeout' : 'network error'}).`,
    );
  }

  // A cached token can be revoked early. Clear it and retry once.
  if (response.status === 401 && retry) {
    tokenCache = { accessToken: '', expiresAt: 0 };
    return calendarRequest(method, path, { query, body, retry: false });
  }

  const text = await response.text().catch(() => '');
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  return { ok: response.ok, status: response.status, data };
}

function buildEvent(appointment) {
  const config = calendarConfig();
  const serviceName = appointment?.service?.name ?? 'Appointment';
  const patientName = appointment?.patient?.fullName ?? 'Patient';
  const endDay = addDaysYMD(appointment.day, 1);

  const event = {
    id: eventIdFor(appointment),
    summary: `${serviceName} — ${patientName}`,
    description: [
      `Service: ${serviceName}`,
      `Patient: ${patientName}`,
      `Time preference: ${appointment.timePreference ?? 'any'}`,
      `Status: ${appointment.status ?? 'confirmed'}`,
      `Appointment ID: ${appointment._id}`,
      'Managed by E-Kalinga',
    ].join('\n'),
    // All-day event. The end date is exclusive, as required by Google Calendar.
    // The time zone is informational; a date-only event is not shifted by DST.
    start: { date: appointment.day, timeZone: config.timezone },
    end: { date: endDay, timeZone: config.timezone },
    status: 'confirmed',
    transparency: 'opaque',
    visibility: 'private',
    // The app already sends its own reminders; avoid duplicate Google reminders.
    reminders: { useDefault: false, overrides: [] },
    extendedProperties: {
      private: {
        healthcentriaAppointmentId: String(appointment._id),
        healthcentriaSource: 'healthcentria',
      },
    },
    ...(config.location ? { location: config.location } : {}),
  };

  return event;
}

async function populatedAppointment(appointment) {
  const id = appointment?._id ?? appointment;
  if (
    appointment?.patient &&
    typeof appointment.patient === 'object' &&
    appointment?.service &&
    typeof appointment.service === 'object'
  ) {
    return appointment;
  }
  return Appointment.findById(id)
    .populate('patient', 'fullName')
    .populate('service', 'name')
    .lean();
}

async function upsertEvent(appointment) {
  const config = calendarConfig();
  const eventId = eventIdFor(appointment);
  const body = buildEvent(appointment);
  // `id` is writable on insert but immutable on patch.
  const { id: _eventId, ...patchBody } = body;
  const eventPath = `/calendars/${encodeURIComponent(config.calendarId)}/events/${encodeURIComponent(eventId)}`;

  // PATCH first: this updates an existing event and also works when a previous
  // attempt succeeded but the link row was not written.
  const patch = await calendarRequest('PATCH', eventPath, {
    query: { sendUpdates: 'none' },
    body: patchBody,
  });
  if (patch.ok) return eventId;

  if (patch.status !== 404 && patch.status !== 410) {
    throw new Error(googleErrorMessage(patch));
  }

  const insert = await calendarRequest('POST', `/calendars/${encodeURIComponent(config.calendarId)}/events`, {
    query: { sendUpdates: 'none' },
    body,
  });
  if (insert.ok) return eventId;

  // 409 means the deterministic id already exists. Treat it as a race and patch.
  if (insert.status === 409) {
    const retryPatch = await calendarRequest('PATCH', eventPath, {
      query: { sendUpdates: 'none' },
      body: patchBody,
    });
    if (retryPatch.ok) return eventId;
    throw new Error(googleErrorMessage(retryPatch));
  }

  throw new Error(googleErrorMessage(insert));
}

async function deleteEvent(appointment) {
  const config = calendarConfig();
  const eventId = eventIdFor(appointment);
  const result = await calendarRequest(
    'DELETE',
    `/calendars/${encodeURIComponent(config.calendarId)}/events/${encodeURIComponent(eventId)}`,
    { query: { sendUpdates: 'none' } },
  );
  if (result.ok || result.status === 404 || result.status === 410) return eventId;
  throw new Error(googleErrorMessage(result));
}

async function linkFor(appointment, calendarId, eventId) {
  return CalendarEventLink.findOneAndUpdate(
    { appointment: appointment._id ?? appointment },
    {
      $set: { calendarId, eventId },
      $setOnInsert: { status: 'pending' },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

/**
 * Create or update the calendar event for one appointment.
 * Never throws; returns a small result object instead.
 */
export async function syncAppointmentToCalendar(appointment, { force = false } = {}) {
  if (!isGoogleCalendarConfigured()) return { ok: false, skipped: 'not_configured' };

  if (!force) {
    let enabled;
    try {
      enabled = await isGoogleCalendarSyncEnabled();
    } catch (error) {
      const message = errorMessage(error);
      console.error('Google Calendar setting read failed:', message);
      return { ok: false, error: message };
    }
    if (!enabled) return { ok: false, skipped: 'disabled' };
  }

  let full;
  try {
    full = await populatedAppointment(appointment);
  } catch (error) {
    const message = errorMessage(error);
    console.error('Google Calendar appointment read failed:', message);
    return { ok: false, error: message };
  }
  if (!full) return { ok: false, skipped: 'appointment_not_found' };
  if (!CONFIRMED_STATUSES.has(full.status)) return { ok: false, skipped: 'not_confirmed' };

  const config = calendarConfig();
  const eventId = eventIdFor(full);
  let link;
  try {
    link = await linkFor(full, config.calendarId, eventId);
  } catch (error) {
    console.error('Google Calendar link write failed:', errorMessage(error));
    return { ok: false, error: errorMessage(error) };
  }
  if (!link) return { ok: false, error: 'Could not create the calendar link record.' };

  try {
    await upsertEvent(full);
    await CalendarEventLink.updateOne(
      { _id: link._id },
      {
        $set: {
          calendarId: config.calendarId,
          eventId,
          status: 'synced',
          lastSyncedAt: new Date(),
          lastError: '',
        },
        $inc: { attempts: 1 },
      },
    );
    return { ok: true, eventId };
  } catch (error) {
    const message = errorMessage(error);
    await CalendarEventLink.updateOne(
      { _id: link._id },
      { $set: { status: 'failed', lastError: message }, $inc: { attempts: 1 } },
    ).catch(() => {});
    console.error('Google Calendar sync failed:', message);
    return { ok: false, error: message };
  }
}

/**
 * Remove the calendar event for a cancelled or declined appointment.
 * Deletions still run when automatic sync is switched off so the calendar does
 * not keep stale events. Never throws.
 */
export async function removeAppointmentFromCalendar(appointment) {
  if (!isGoogleCalendarConfigured()) return { ok: false, skipped: 'not_configured' };

  const id = appointment?._id ?? appointment;
  const config = calendarConfig();
  const eventId = eventIdFor(id);

  try {
    await deleteEvent(id);
    await CalendarEventLink.findOneAndUpdate(
      { appointment: id },
      {
        $set: {
          calendarId: config.calendarId,
          eventId,
          status: 'deleted',
          lastSyncedAt: new Date(),
          lastError: '',
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
    return { ok: true, eventId };
  } catch (error) {
    const message = errorMessage(error);
    await CalendarEventLink.findOneAndUpdate(
      { appointment: id },
      {
        $set: { calendarId: config.calendarId, eventId, status: 'failed', lastError: message },
        $inc: { attempts: 1 },
      },
      { upsert: true, setDefaultsOnInsert: true },
    ).catch(() => {});
    console.error('Google Calendar delete failed:', message);
    return { ok: false, error: message };
  }
}

/** Admin status card data. */
export async function getGoogleCalendarStatus() {
  const config = calendarConfig();
  const [enabled, pending, failed, synced, lastSynced, lastFailed] = await Promise.all([
    isGoogleCalendarSyncEnabled(),
    CalendarEventLink.countDocuments({ status: 'pending' }),
    CalendarEventLink.countDocuments({ status: 'failed' }),
    CalendarEventLink.countDocuments({ status: 'synced' }),
    CalendarEventLink.findOne({ status: 'synced' }).sort({ lastSyncedAt: -1 }).select('lastSyncedAt').lean(),
    CalendarEventLink.findOne({ status: 'failed' })
      .sort({ updatedAt: -1 })
      .select('lastError updatedAt')
      .lean(),
  ]);

  return {
    configured: isGoogleCalendarConfigured(),
    enabled,
    calendarId: config.calendarId,
    timezone: config.timezone,
    pending,
    failed,
    synced,
    lastSyncedAt: lastSynced?.lastSyncedAt ?? null,
    lastError: lastFailed?.lastError ?? '',
  };
}

/** Verify the service account can read the target calendar. */
export async function testGoogleCalendarConnection() {
  if (!isGoogleCalendarConfigured()) {
    throw new Error('Google Calendar is not configured on this server.');
  }
  const config = calendarConfig();
  const result = await calendarRequest(
    'GET',
    `/calendars/${encodeURIComponent(config.calendarId)}/events`,
    { query: { maxResults: '1', singleEvents: 'true' } },
  );
  if (!result.ok) throw new Error(googleErrorMessage(result));
  return { calendarId: config.calendarId, timezone: config.timezone };
}

/** Retry link rows that are pending or failed. Used by the admin card and cron. */
export async function retryPendingCalendarSync({ limit = 50 } = {}) {
  if (!isGoogleCalendarConfigured()) {
    return { total: 0, ok: 0, failed: 0, skipped: 0 };
  }

  const links = await CalendarEventLink.find({ status: { $in: ['pending', 'failed'] } })
    .sort({ updatedAt: 1 })
    .limit(Math.min(Math.max(Number(limit) || 50, 1), 100))
    .lean();

  let ok = 0;
  let failed = 0;
  let skipped = 0;

  for (const link of links) {
    const appointment = await Appointment.findById(link.appointment)
      .populate('patient', 'fullName')
      .populate('service', 'name')
      .lean();

    if (!appointment) {
      await CalendarEventLink.updateOne(
        { _id: link._id },
        { $set: { status: 'deleted', lastError: 'Appointment no longer exists.' } },
      );
      skipped += 1;
      continue;
    }

    if (!CONFIRMED_STATUSES.has(appointment.status)) {
      // A cancelled/declined appointment may have a failed delete row. Retry the
      // delete so the calendar does not keep a stale event.
      const removed = await removeAppointmentFromCalendar(appointment);
      if (removed.ok) ok += 1;
      else if (removed.skipped) skipped += 1;
      else failed += 1;
      continue;
    }

    const result = await syncAppointmentToCalendar(appointment, { force: true });
    if (result.ok) ok += 1;
    else if (result.skipped) skipped += 1;
    else failed += 1;
  }

  return { total: links.length, ok, failed, skipped };
}

/** Backfill upcoming confirmed/completed appointments into the clinic calendar. */
export async function syncUpcomingAppointments({ limit = 50 } = {}) {
  if (!isGoogleCalendarConfigured()) {
    return { total: 0, ok: 0, failed: 0, skipped: 0 };
  }

  const appointments = await Appointment.find({
    status: { $in: ['confirmed', 'completed'] },
    day: { $gte: todayYMD() },
  })
    .populate('patient', 'fullName')
    .populate('service', 'name')
    .sort({ day: 1, createdAt: 1 })
    .limit(Math.min(Math.max(Number(limit) || 50, 1), 100))
    .lean();

  let ok = 0;
  let failed = 0;
  let skipped = 0;

  for (const appointment of appointments) {
    const result = await syncAppointmentToCalendar(appointment, { force: true });
    if (result.ok) ok += 1;
    else if (result.skipped) skipped += 1;
    else failed += 1;
  }

  return { total: appointments.length, ok, failed, skipped };
}

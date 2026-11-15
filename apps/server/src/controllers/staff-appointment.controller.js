import { z } from 'zod';
import mongoose from 'mongoose';
import { randomBytes } from 'node:crypto';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { Appointment } from '../models/appointment.model.js';
import { Service } from '../models/service.model.js';
import { diffChanges, logActivity } from '../services/activity.js';
import { isGoogleCalendarSyncEnabled } from '../models/app-settings.model.js';
import {
  getGoogleCalendarViewConfig,
  removeAppointmentFromCalendar,
  syncAppointmentToCalendar,
} from '../services/google-calendar.js';
import { User } from '../models/user.model.js';
import { hashPassword, isValidPassword } from '../utils/password.js';
import { sendEmail } from '../utils/email.js';
import { env } from '../config/env.js';
import { notifyPatientEmail, notifyUser } from '../utils/notifications.js';
import { versionFilter, versionMatches } from '../utils/concurrency.js';
import { TransactionAbort, runInTransaction } from '../utils/transaction.js';

const listQuery = z.object({
  status: z.enum(['pending', 'confirmed', 'declined', 'completed', 'cancelled']).optional(),
  serviceId: z.string().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const declineSchema = z.object({
  reason: z.string().trim().min(1, 'A reason is required to decline.').max(500),
});

const completeSchema = z.object({
  diagnosis: z.string().trim().max(1000).optional().default(''),
  prescription: z.string().trim().max(1000).optional().default(''),
  visitNotes: z.string().trim().max(2000).optional().default(''),
});

const recordEditSchema = z
  .object({
    diagnosis: z.string().trim().max(1000).optional(),
    prescription: z.string().trim().max(1000).optional(),
    visitNotes: z.string().trim().max(2000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update.' });

function requireDB(res) {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({ success: false, message: 'Database is not connected. Try again later.' });
    return false;
  }
  return true;
}

function present(a) {
  const obj = typeof a.toObject === 'function' ? a.toObject() : a;
  return {
    id: String(obj._id),
    version: Number(obj.__v ?? 0),
    patient:
      obj.patient && typeof obj.patient === 'object'
        ? { id: String(obj.patient._id), name: obj.patient.fullName, email: obj.patient.email }
        : obj.patient,
    service:
      obj.service && typeof obj.service === 'object'
        ? { id: String(obj.service._id), name: obj.service.name }
        : obj.service,
    day: obj.day,
    timePreference: obj.timePreference,
    notes: obj.notes,
    status: obj.status,
    declineReason: obj.declineReason,
    diagnosis: obj.diagnosis ?? '',
    prescription: obj.prescription ?? '',
    visitNotes: obj.visitNotes ?? '',
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
    updatedByName:
      obj.updatedBy && typeof obj.updatedBy === 'object' ? obj.updatedBy.fullName ?? '' : '',
  };
}

/** Human label stored on the entry so it still reads correctly later. */
function appointmentLabel(appt) {
  const service = appt.service && typeof appt.service === 'object' ? appt.service.name : '';
  const patient = appt.patient && typeof appt.patient === 'object' ? appt.patient.fullName : '';
  const subject = service || 'Appointment';
  return patient ? `${patient} — ${subject} on ${appt.day}` : `${subject} on ${appt.day}`;
}

function patientIdOf(appt) {
  return appt.patient && typeof appt.patient === 'object' ? appt.patient._id : appt.patient;
}

async function logAppointment(req, action, appt, { changes = [], detail = '', session } = {}) {
  await logActivity({
    req,
    session,
    action,
    target: { type: 'appointment', id: appt._id, label: appointmentLabel(appt) },
    changes,
    detail,
    appointment: appt._id,
    patient: patientIdOf(appt),
  });
}

/**
 * A guarded update matched nothing: either the appointment is gone or someone
 * else changed its status first. 404 vs 409 lets the UI tell those apart.
 */
async function appointmentConflict(res, id, message) {
  const exists = mongoose.isValidObjectId(id) && (await Appointment.exists({ _id: id }));
  if (!exists) {
    return res.status(404).json({ success: false, message: 'Appointment not found.' });
  }
  return res.status(409).json({ success: false, code: 'APPOINTMENT_CONFLICT', message });
}

export const queueAppointments = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: 'Invalid filters.' });
  }
  const { status, serviceId, from, to } = parsed.data;
  const filter = {};
  if (status) filter.status = status;
  if (serviceId) filter.service = serviceId;
  if (from || to) {
    filter.day = {};
    if (from) filter.day.$gte = from;
    if (to) filter.day.$lte = to;
  }
  const appointments = await Appointment.find(filter)
    .populate('patient', 'fullName email')
    .populate('service', 'name')
    .populate('updatedBy', 'fullName')
    .sort({ createdAt: -1, _id: -1 })
    .lean();
  res.json({ success: true, appointments: appointments.map(present) });
});

export const confirmAppointment = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  // Atomic transition: only one request can move pending → confirmed. A second
  // one matches no document and is told to reload instead of overwriting it.
  const appt = await Appointment.findOneAndUpdate(
    { _id: req.params.id, status: 'pending' },
    { $set: { status: 'confirmed', updatedBy: req.user.id }, $inc: { __v: 1 } },
    { new: true },
  );
  if (!appt) {
    return appointmentConflict(
      res,
      req.params.id,
      'Only pending appointments can be confirmed. Reload the queue to see its current status.',
    );
  }
  await appt.populate([
    { path: 'patient', select: 'fullName email' },
    { path: 'service', select: 'name' },
    { path: 'updatedBy', select: 'fullName' },
  ]);
  await logAppointment(req, 'appointment.confirm', appt, {
    changes: [['status', 'pending', 'confirmed']],
    detail: 'Staff confirmed the request.',
  });
  await notifyUser(appt.patient._id, {
    type: 'appointment-confirmed',
    title: `Confirmed: ${appt.service.name} on ${appt.day}`,
    body: 'Your appointment is confirmed. Please arrive on time and bring a valid ID.',
    link: '/app/appointments',
  }).catch(() => {});
  notifyPatientEmail(
    appt.patient._id,
    'appointments',
    appt.patient.email,
    `HealthCentria: appointment confirmed (${appt.service.name}, ${appt.day})`,
    `Good news — your ${appt.service.name} appointment on ${appt.day} is confirmed.\n\nPlease arrive on time and bring a valid ID.\n\n— HealthCentria Barangay Health Center`,
  ).catch(() => {});
  // Additive side effect: never blocks the response and never throws.
  void syncAppointmentToCalendar(appt).catch(() => {});
  res.json({ success: true, appointment: present(appt) });
});

export const declineAppointment = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const parsed = declineSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ success: false, message: 'A reason is required to decline.', errors: parsed.error.flatten().fieldErrors });
  }
  const appt = await Appointment.findOneAndUpdate(
    { _id: req.params.id, status: 'pending' },
    {
      $set: {
        status: 'declined',
        declineReason: parsed.data.reason,
        updatedBy: req.user.id,
      },
      $inc: { __v: 1 },
    },
    { new: true },
  );
  if (!appt) {
    return appointmentConflict(
      res,
      req.params.id,
      'Only pending appointments can be declined. Reload the queue to see its current status.',
    );
  }
  await appt.populate([
    { path: 'patient', select: 'fullName email' },
    { path: 'service', select: 'name' },
    { path: 'updatedBy', select: 'fullName' },
  ]);
  await logAppointment(req, 'appointment.decline', appt, {
    changes: [
      ['status', 'pending', 'declined'],
      ['declineReason', '', parsed.data.reason],
    ],
    detail: 'Staff declined the request.',
  });
  await notifyUser(appt.patient._id, {
    type: 'appointment-declined',
    title: `Declined: ${appt.service.name} on ${appt.day}`,
    body: `Reason: ${parsed.data.reason}`,
    link: '/app/appointments',
  }).catch(() => {});
  notifyPatientEmail(
    appt.patient._id,
    'appointments',
    appt.patient.email,
    `HealthCentria: appointment update (${appt.service.name}, ${appt.day})`,
    `Your ${appt.service.name} appointment on ${appt.day} could not be confirmed.\n\nReason: ${parsed.data.reason}\n\nPlease book another date.\n\n— HealthCentria Barangay Health Center`,
  ).catch(() => {});
  // Pending requests normally have no event; this also clears a stale one.
  void removeAppointmentFromCalendar(appt).catch(() => {});
  res.json({ success: true, appointment: present(appt) });
});

export const completeAppointment = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const parsed = completeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res
      .status(400)
      .json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }
  // Read first only to build the change diff and the 404/state message; the
  // write below is guarded on status so two staff cannot both complete it.
  const before = await Appointment.findById(req.params.id).lean();
  if (!before) return res.status(404).json({ success: false, message: 'Appointment not found.' });
  if (before.status !== 'confirmed') {
    return res.status(409).json({
      success: false,
      code: 'APPOINTMENT_CONFLICT',
      message: 'Only confirmed appointments can be completed. Reload the queue to see its current status.',
    });
  }
  const clinicalChanges = diffChanges([
    ['status', before.status, 'completed'],
    ['diagnosis', before.diagnosis ?? '', parsed.data.diagnosis],
    ['prescription', before.prescription ?? '', parsed.data.prescription],
    ['visitNotes', before.visitNotes ?? '', parsed.data.visitNotes],
  ]);

  // One transaction: the status change, the clinical notes and their activity-log
  // entries are saved together or not at all. The update is still guarded on
  // status, so two staff cannot both complete the same visit.
  let appt;
  try {
    appt = await runInTransaction(async (session) => {
      const updated = await Appointment.findOneAndUpdate(
        { _id: req.params.id, status: 'confirmed' },
        {
          $set: {
            status: 'completed',
            diagnosis: parsed.data.diagnosis,
            prescription: parsed.data.prescription,
            visitNotes: parsed.data.visitNotes,
            updatedBy: req.user.id,
          },
          $inc: { __v: 1 },
        },
        { new: true, session },
      );
      if (!updated) throw new TransactionAbort('APPOINTMENT_CHANGED');
      await updated.populate([
        { path: 'patient', select: 'fullName email' },
        { path: 'service', select: 'name' },
        { path: 'updatedBy', select: 'fullName' },
      ]);
      await logAppointment(req, 'appointment.complete', updated, {
        changes: clinicalChanges,
        detail: 'Visit marked completed.',
        session,
      });
      if (parsed.data.diagnosis || parsed.data.prescription || parsed.data.visitNotes) {
        await logAppointment(req, 'record.update', updated, {
          changes: clinicalChanges.filter((c) => c.field !== 'status'),
          detail: 'Clinical visit record written on completion.',
          session,
        });
      }
      return updated;
    });
  } catch (err) {
    if (err instanceof TransactionAbort) {
      return appointmentConflict(
        res,
        req.params.id,
        'This visit was already completed or changed by someone else. Reload the queue.',
      );
    }
    throw err;
  }
  // Keep the calendar title/description in step with the completed status.
  void syncAppointmentToCalendar(appt).catch(() => {});
  res.json({ success: true, appointment: present(appt) });
});

/**
 * PATCH /api/appointments/:id/record — correct the clinical notes on a visit
 * that is already completed. Completion is still the only way to create the
 * record; this only edits it afterward (and logs every changed field).
 */
export const updateAppointmentRecord = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const parsed = recordEditSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed.',
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  const before = await Appointment.findById(req.params.id).lean();
  if (!before) return res.status(404).json({ success: false, message: 'Appointment not found.' });
  if (before.status !== 'completed') {
    return res.status(409).json({
      success: false,
      code: 'APPOINTMENT_CONFLICT',
      message: 'Clinical notes can only be edited after the visit is completed.',
    });
  }
  if (!versionMatches(req, res, before, 'visit record')) return;

  const changes = diffChanges(
    ['diagnosis', 'prescription', 'visitNotes']
      .filter((field) => parsed.data[field] !== undefined)
      .map((field) => [field, before[field] ?? '', parsed.data[field]]),
  );

  const patch = { updatedBy: req.user.id };
  for (const field of ['diagnosis', 'prescription', 'visitNotes']) {
    if (parsed.data[field] !== undefined) patch[field] = parsed.data[field];
  }

  const appt = await Appointment.findOneAndUpdate(
    { _id: req.params.id, status: 'completed', ...versionFilter(req) },
    { $set: patch, $inc: { __v: 1 } },
    { new: true },
  ).populate([
    { path: 'patient', select: 'fullName email' },
    { path: 'service', select: 'name' },
    { path: 'updatedBy', select: 'fullName' },
  ]);
  if (!appt) {
    return appointmentConflict(
      res,
      req.params.id,
      req.expectedVersion === undefined
        ? 'This visit is no longer completed. Reload the patient record.'
        : 'This visit was changed by someone else while you were editing it. Reload to see the latest version, then make your change again.',
    );
  }

  await logAppointment(req, 'record.update', appt, {
    changes,
    detail: 'Clinical visit record edited after the visit.',
  });
  // Keep the mirrored calendar entry's description in step.
  void syncAppointmentToCalendar(appt).catch(() => {});

  res.json({ success: true, appointment: present(appt) });
});

// Emergency walk-ins: only the name is needed to start care. Everything else
// is optional and can be completed later, but is still validated when given.
const blankToUndefined = (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optional = (schema) => z.preprocess(blankToUndefined, schema.optional());

const phoneSchema = z
  .string()
  .trim()
  .min(7, 'Enter a valid contact number.')
  .regex(/^[\d+][\d\s\-()]{6,}$/, 'Enter a valid contact number.');

const newPatientSchema = z.object({
  fullName: z.string().trim().min(1, 'Full name is required.'),
  email: optional(z.string().trim().toLowerCase().email('Enter a valid email address.')),
  birthdate: optional(
    z
      .string()
      .refine((v) => !Number.isNaN(new Date(v + 'T00:00:00').getTime()), 'Enter a valid date.')
      .refine((v) => new Date(v + 'T00:00:00').getTime() <= Date.now(), 'Birthdate cannot be in the future.'),
  ),
  sex: optional(z.enum(['Female', 'Male', 'Other', 'Prefer not to say'])),
  address: optional(z.string().trim()),
  householdNumber: optional(z.string().trim()),
  contactNumber: optional(phoneSchema),
  philHealthNumber: optional(z.string().trim()),
  emergencyName: optional(z.string().trim()),
  emergencyNumber: optional(phoneSchema),
});

const walkInSchema = z.object({
  serviceId: z.string().min(1, 'Service is required.'),
  timePreference: z.enum(['morning', 'afternoon', 'any']).optional().default('any'),
  notes: z.string().trim().max(500, 'Notes must be 500 characters or fewer.').optional().default(''),
  patientEmail: z.string().trim().toLowerCase().email().optional(),
  newPatient: newPatientSchema.optional(),
  // Staff confirmed a "same name already exists" warning and want a new record anyway.
  allowDuplicate: z.boolean().optional().default(false),
}).refine((v) => v.patientEmail || v.newPatient, {
  message: 'Provide an existing patient email or new patient details.',
  path: ['patientEmail'],
});

function publicPatient(user) {
  return {
    id: String(user._id),
    name: user.fullName,
    email: user.email,
  };
}

export const lookupPatient = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const email = String(req.query.email ?? '').trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ success: false, message: 'Enter a valid email address.' });
  }
  const user = await User.findOne({ email }).lean();
  if (!user || user.role !== 'patient') {
    return res.status(404).json({ success: false, message: 'No patient found with this email.' });
  }
  res.json({ success: true, patient: publicPatient(user) });
});

export const walkInAppointment = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const parsed = walkInSchema.safeParse(req.body);
  if (!parsed.success) {
    // Name the first problem so the desk knows which field to fix (nested
    // newPatient fields would otherwise collapse into a bare "Validation failed.").
    const FIELD_LABELS = {
      fullName: 'Full name',
      email: 'Email',
      birthdate: 'Birthdate',
      sex: 'Sex',
      address: 'Address',
      householdNumber: 'Household number',
      contactNumber: 'Contact number',
      philHealthNumber: 'PhilHealth',
      emergencyName: 'Emergency contact name',
      emergencyNumber: 'Emergency contact number',
      serviceId: 'Service',
      patientEmail: 'Patient email',
      notes: 'Notes',
    };
    const issue = parsed.error.issues[0];
    const field = issue?.path?.[issue.path.length - 1];
    const label = FIELD_LABELS[field];
    return res.status(400).json({
      success: false,
      message: issue ? `${label ? `${label}: ` : ''}${issue.message}` : 'Validation failed.',
      errors: parsed.error.flatten().fieldErrors,
    });
  }
  const { serviceId, timePreference, notes, patientEmail, newPatient, allowDuplicate } = parsed.data;

  // Emergency walk-in: always recorded for the clinic's current date
  // (Philippine time, UTC+8), whatever date the client sent. There is no
  // service-day restriction — an emergency can't wait for the service's schedule.
  const day = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

  const service = await Service.findById(serviceId).lean();
  if (!service || !service.active) {
    return res.status(404).json({ success: false, message: 'Service not found.' });
  }

  let patient = null;
  let newUserFields = null;
  let passwordSetup = 'none';
  let emailSent = false;
  if (newPatient) {
    const publicOf = (u) => ({ id: String(u._id), name: u.fullName, email: u.email });
    if (newPatient.email) {
      const existing = await User.findOne({ email: newPatient.email }).lean();
      if (existing) {
        return res.status(409).json({
          success: false,
          code: 'PATIENT_EXISTS',
          message: 'This email is already registered. Use the existing patient instead.',
          candidates: existing.role === 'patient' ? [publicOf(existing)] : [],
        });
      }
    }
    if (!allowDuplicate) {
      const escaped = newPatient.fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const sameName = await User.find({
        role: 'patient',
        fullName: { $regex: '^' + escaped + '$', $options: 'i' },
      })
        .limit(3)
        .lean();
      if (sameName.length) {
        return res.status(409).json({
          success: false,
          code: 'POSSIBLE_DUPLICATE',
          message: 'A patient with this name already exists. Use the existing record to keep their history together.',
          candidates: sameName.map(publicOf),
        });
      }
    }

    // Nobody ever sees this password. It only satisfies the account record; the
    // patient sets a real one through "Forgot password" with an emailed code.
    let throwaway;
    do {
      throwaway = randomBytes(12).toString('hex');
    } while (!isValidPassword(throwaway));
    // No email: the account still needs a unique address, so it gets a
    // placeholder that can never receive mail (and never logs in).
    const email = newPatient.email ?? 'walkin-' + randomBytes(6).toString('hex') + '@no-email.invalid';
    newUserFields = {
      email,
      passwordHash: await hashPassword(throwaway),
      role: 'patient',
      fullName: newPatient.fullName,
      profileComplete: false,
      emailVerified: false,
      ...(newPatient.birthdate ? { birthdate: new Date(newPatient.birthdate + 'T00:00:00') } : {}),
      ...(newPatient.sex ? { sex: newPatient.sex } : {}),
      ...(newPatient.address ? { address: newPatient.address } : {}),
      ...(newPatient.householdNumber ? { householdNumber: newPatient.householdNumber } : {}),
      ...(newPatient.contactNumber ? { contactNumber: newPatient.contactNumber } : {}),
      ...(newPatient.philHealthNumber ? { philHealthNumber: newPatient.philHealthNumber } : {}),
      ...(newPatient.emergencyName ? { emergencyName: newPatient.emergencyName } : {}),
      ...(newPatient.emergencyNumber ? { emergencyNumber: newPatient.emergencyNumber } : {}),
    };
  } else {
    patient = await User.findOne({ email: patientEmail, role: 'patient' });
    if (!patient) {
      return res.status(404).json({ success: false, message: 'No patient found with this email.' });
    }
  }

  // One transaction: the new patient account (if any), the visit and their
  // activity-log entries are saved together or not at all, so a failure can never
  // leave an account with no visit or a visit with no log.
  const created = await runInTransaction(async (session) => {
    let owner = patient;
    if (newUserFields) {
      const [user] = await User.create([newUserFields], { session });
      owner = user;
    }
    const [visit] = await Appointment.create(
      [
        {
          patient: owner._id,
          service: service._id,
          day,
          date: new Date(`${day}T12:00:00.000Z`),
          timePreference,
          notes,
          status: 'confirmed',
          createdBy: req.user.id,
          updatedBy: req.user.id,
        },
      ],
      { session },
    );
    await visit.populate([
      { path: 'patient', select: 'fullName email' },
      { path: 'service', select: 'name' },
      { path: 'updatedBy', select: 'fullName' },
    ]);
    await logAppointment(req, 'appointment.walkin', visit, {
      changes: [
        ['status', '', 'confirmed'],
        ['service', '', service.name],
        ['day', '', day],
        ['timePreference', '', timePreference],
      ],
      detail: newUserFields
        ? 'Emergency walk-in booked for a newly created patient (profile to be completed).'
        : 'Emergency walk-in booked for an existing patient.',
      session,
    });
    if (newUserFields) {
      await logActivity({
        req,
        session,
        action: 'patient.create',
        target: { type: 'patient', id: owner._id, label: owner.fullName },
        detail: 'Patient account created at the front desk.',
        patient: owner._id,
      });
    }
    return { owner, visit };
  });
  patient = created.owner;
  const appt = created.visit;

  // Emails cannot be undone, so they go out only after the transaction has committed.
  if (newPatient?.email) {
    passwordSetup = 'emailed';
    const base = String(env.CLIENT_URL).replace(/\/+$/, '');
    const result = await sendEmail(
      newPatient.email,
      'Set up your HealthCentria account',
      [
        'Hello ' + newPatient.fullName + ',',
        '',
        'The Barangay Health Center registered you at the front desk and created a HealthCentria account for you.',
        'To use it, set your own password:',
        '',
        '1. Open ' + base + '/forgot-password',
        '2. Enter this email address and request a code',
        '3. Enter the 6-digit code we email you and choose your password',
        '',
        "If you didn't visit the health center, you can ignore this email.",
        '',
        '— HealthCentria Barangay Health Center',
      ].join('\n'),
    ).catch(() => null);
    emailSent = Boolean(result?.sent);
  }
  // Walk-ins are already confirmed, so mirror them immediately.
  void syncAppointmentToCalendar(appt).catch(() => {});

  res.status(201).json({
    success: true,
    appointment: present(appt),
    ...(newPatient ? { passwordSetup, emailSent } : {}),
  });
});

/**
 * GET /api/appointments/calendar-link — staff/admin. The dashboard schedule
 * shows "Open in Google Calendar" only when the mirror is configured and on.
 * The calendar ID is not secret, but only people it is shared with can open it.
 */
export const calendarLink = asyncHandler(async (req, res) => {
  const { configured, calendarId, timezone } = getGoogleCalendarViewConfig();
  const enabled = configured ? await isGoogleCalendarSyncEnabled().catch(() => false) : false;
  const available = configured && enabled;
  res.json({
    success: true,
    available,
    url: available
      ? `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(calendarId)}&ctz=${encodeURIComponent(timezone)}&mode=MONTH`
      : '',
  });
});

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
import { isValidServiceDay, todayYMD } from '../utils/service-schedule.js';
import { notifyEmail, notifyUser } from '../utils/notifications.js';

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

async function logAppointment(req, action, appt, { changes = [], detail = '' } = {}) {
  await logActivity({
    req,
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
  notifyEmail(
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
  notifyEmail(
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

  const appt = await Appointment.findOneAndUpdate(
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
    { new: true },
  );
  if (!appt) {
    return appointmentConflict(
      res,
      req.params.id,
      'This visit was already completed or changed by someone else. Reload the queue.',
    );
  }
  await appt.populate([
    { path: 'patient', select: 'fullName email' },
    { path: 'service', select: 'name' },
    { path: 'updatedBy', select: 'fullName' },
  ]);
  await logAppointment(req, 'appointment.complete', appt, {
    changes: clinicalChanges,
    detail: 'Visit marked completed.',
  });
  if (parsed.data.diagnosis || parsed.data.prescription || parsed.data.visitNotes) {
    await logAppointment(req, 'record.update', appt, {
      changes: clinicalChanges.filter((c) => c.field !== 'status'),
      detail: 'Clinical visit record written on completion.',
    });
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
    { _id: req.params.id, status: 'completed' },
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
      'This visit is no longer completed. Reload the patient record.',
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

const phoneSchema = z
  .string()
  .trim()
  .min(7, 'Enter a valid contact number.')
  .regex(/^[\d+][\d\s\-()]{6,}$/, 'Enter a valid contact number.');

const newPatientSchema = z.object({
  fullName: z.string().trim().min(1, 'Full name is required.'),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  birthdate: z
    .string()
    .min(1, 'Birthdate is required.')
    .refine((v) => !Number.isNaN(new Date(`${v}T00:00:00`).getTime()), 'Enter a valid date.')
    .refine((v) => new Date(`${v}T00:00:00`).getTime() <= Date.now(), 'Birthdate cannot be in the future.'),
  sex: z.enum(['Female', 'Male', 'Other', 'Prefer not to say']),
  address: z.string().trim().min(1, 'Address is required.'),
  householdNumber: z.string().trim().min(1, 'Household number is required.'),
  contactNumber: phoneSchema,
  philHealthNumber: z.string().trim().optional().default(''),
  emergencyName: z.string().trim().min(1, 'Emergency contact name is required.'),
  emergencyNumber: phoneSchema,
});

const walkInSchema = z.object({
  serviceId: z.string().min(1, 'Service is required.'),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a valid date.'),
  timePreference: z.enum(['morning', 'afternoon', 'any']).optional().default('any'),
  notes: z.string().trim().max(500, 'Notes must be 500 characters or fewer.').optional().default(''),
  patientEmail: z.string().trim().toLowerCase().email().optional(),
  newPatient: newPatientSchema.optional(),
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
    return res
      .status(400)
      .json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }
  const { serviceId, day, timePreference, notes, patientEmail, newPatient } = parsed.data;

  // Walk-ins are same-day only for v1.
  const today = todayYMD();
  if (day !== today) {
    return res.status(400).json({ success: false, message: 'Walk-ins can only be booked for today.' });
  }

  const service = await Service.findById(serviceId).lean();
  if (!service || !service.active) {
    return res.status(404).json({ success: false, message: 'Service not found.' });
  }
  if (!isValidServiceDay(service, day)) {
    return res.status(400).json({
      success: false,
      message: `This service is not offered on ${day}.`,
    });
  }

  let patient = null;
  let tempPassword = null;
  if (newPatient) {
    const existing = await User.findOne({ email: newPatient.email }).lean();
    if (existing) {
      return res.status(409).json({ success: false, message: 'Email is already registered. Use existing patient instead.' });
    }
    do {
      tempPassword = randomBytes(6).toString('hex');
    } while (!isValidPassword(tempPassword));
    patient = await User.create({
      email: newPatient.email,
      passwordHash: await hashPassword(tempPassword),
      role: 'patient',
      fullName: newPatient.fullName,
      birthdate: new Date(`${newPatient.birthdate}T00:00:00`),
      sex: newPatient.sex,
      address: newPatient.address,
      householdNumber: newPatient.householdNumber,
      contactNumber: newPatient.contactNumber,
      philHealthNumber: newPatient.philHealthNumber ?? '',
      emergencyName: newPatient.emergencyName,
      emergencyNumber: newPatient.emergencyNumber,
    });
  } else {
    patient = await User.findOne({ email: patientEmail, role: 'patient' });
    if (!patient) {
      return res.status(404).json({ success: false, message: 'No patient found with this email.' });
    }
  }

  const clash = await Appointment.findOne({
    patient: patient._id,
    service: service._id,
    day,
    status: { $in: ['pending', 'confirmed'] },
  }).lean();
  if (clash) {
    return res
      .status(409)
      .json({ success: false, message: 'This patient already has a request for this service today.' });
  }

  const appt = await Appointment.create({
    patient: patient._id,
    service: service._id,
    day,
    date: new Date(`${day}T12:00:00.000Z`),
    timePreference,
    notes,
    status: 'confirmed',
    createdBy: req.user.id,
    updatedBy: req.user.id,
  });
  await appt.populate([
    { path: 'patient', select: 'fullName email' },
    { path: 'service', select: 'name' },
    { path: 'updatedBy', select: 'fullName' },
  ]);
  await logAppointment(req, 'appointment.walkin', appt, {
    changes: [
      ['status', '', 'confirmed'],
      ['service', '', service.name],
      ['day', '', day],
      ['timePreference', '', timePreference],
    ],
    detail: newPatient ? 'Walk-in booked for a newly created patient.' : 'Walk-in booked for an existing patient.',
  });
  if (newPatient) {
    await logActivity({
      req,
      action: 'patient.create',
      target: { type: 'patient', id: patient._id, label: patient.fullName },
      detail: 'Patient account created at the front desk.',
      patient: patient._id,
    });
  }
  // Walk-ins are already confirmed, so mirror them immediately.
  void syncAppointmentToCalendar(appt).catch(() => {});

  res.status(201).json({
    success: true,
    appointment: present(appt),
    ...(tempPassword ? { tempPassword } : {}),
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

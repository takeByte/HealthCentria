import mongoose from 'mongoose';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { Appointment } from '../models/appointment.model.js';
import { Service } from '../models/service.model.js';
import { logActivity } from '../services/activity.js';
import { removeAppointmentFromCalendar } from '../services/google-calendar.js';
import { notifyEmail, notifyRoles } from '../utils/notifications.js';
import { addDaysYMD, isValidServiceDay, todayYMD } from '../utils/service-schedule.js';

const bookSchema = z.object({
  serviceId: z.string().min(1, 'Service is required.'),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a valid date.'),
  timePreference: z.enum(['morning', 'afternoon', 'any']).optional().default('any'),
  notes: z.string().trim().max(500, 'Notes must be 500 characters or fewer.').optional().default(''),
});

function requireDB(res) {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({ success: false, message: 'Database is not connected. Try again later.' });
    return false;
  }
  return true;
}

// Patients may cancel until this many hours before the appointment day starts
// (00:00 Philippine time, UTC+8 — appointments store a date only, no clock time).
const CANCEL_CUTOFF_HOURS = 24;

function cancelDeadline(day) {
  return new Date(new Date(`${day}T00:00:00+08:00`).getTime() - CANCEL_CUTOFF_HOURS * 3600 * 1000);
}

function present(a) {
  return {
    id: String(a._id),
    service: a.service && typeof a.service === 'object' ? { id: String(a.service._id), name: a.service.name } : a.service,
    day: a.day,
    timePreference: a.timePreference,
    notes: a.notes,
    status: a.status,
    declineReason: a.declineReason,
    diagnosis: a.diagnosis ?? '',
    prescription: a.prescription ?? '',
    visitNotes: a.visitNotes ?? '',
    cancellableUntil: cancelDeadline(a.day).toISOString(),
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

export const bookAppointment = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const parsed = bookSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }
  const { serviceId, day, timePreference, notes } = parsed.data;

  const service = await Service.findById(serviceId).lean();
  if (!service || !service.active) {
    return res.status(404).json({ success: false, message: 'Service not found.' });
  }

  // 30-day horizon (inclusive).
  const today = todayYMD();
  const maxDay = addDaysYMD(today, 30);
  if (day < today || day > maxDay) {
    return res.status(400).json({ success: false, message: 'Pick a date within the next 30 days.' });
  }

  // Strict day enforcement mirrors the UI calendar.
  if (!isValidServiceDay(service, day)) {
    return res.status(400).json({
      success: false,
      message: `This service is not offered on ${day}. Pick a valid service day.`,
    });
  }

  // Patients may book the same service again on the same day, as long as the
  // service is offered that day (enforced by isValidServiceDay above).

  const appt = await Appointment.create({
    patient: req.user.id,
    service: service._id,
    day,
    date: new Date(`${day}T12:00:00.000Z`),
    timePreference,
    notes,
    createdBy: req.user.id,
  });
  await appt.populate('service', 'name');
  await logActivity({
    req,
    action: 'appointment.book',
    target: { type: 'appointment', id: appt._id, label: `${appt.service.name} on ${appt.day}` },
    changes: [
      ['status', '', 'pending'],
      ['service', '', appt.service.name],
      ['day', '', appt.day],
      ['timePreference', '', appt.timePreference],
    ],
    detail: 'Patient requested an appointment.',
    appointment: appt._id,
    patient: appt.patient,
  });
  // Awaited so the bell exists by the time staff reload the queue; failures never break booking.
  await notifyRoles(['staff', 'admin'], {
    type: 'new-request',
    title: `New request: ${appt.service.name} on ${appt.day}`,
    body: 'A patient requested an appointment that needs review.',
    link: '/staff/appointments',
    keyPrefix: `new-request:${appt._id}`,
  }).catch(() => {});

  res.status(201).json({ success: true, appointment: present(appt.toObject()) });
});

export const myAppointments = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const appointments = await Appointment.find({ patient: req.user.id })
    .populate('service', 'name')
    .sort({ day: -1, createdAt: -1 })
    .lean();
  res.json({ success: true, appointments: appointments.map(present) });
});

export const cancelAppointment = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const before = await Appointment.findOne({ _id: req.params.id, patient: req.user.id }).lean();
  if (!before) return res.status(404).json({ success: false, message: 'Appointment not found.' });
  if (before.status !== 'pending' && before.status !== 'confirmed') {
    return res.status(409).json({
      success: false,
      code: 'APPOINTMENT_CONFLICT',
      message: 'Only pending or confirmed appointments can be cancelled. Reload to see its current status.',
    });
  }
  // Pending and confirmed visits can be cancelled online until the cutoff;
  // after that the front desk has to handle changes.
  if (Date.now() >= cancelDeadline(before.day).getTime()) {
    return res.status(409).json({
      success: false,
      code: 'CANCEL_WINDOW_CLOSED',
      message: `Appointments can only be cancelled online up to ${CANCEL_CUTOFF_HOURS} hours before the appointment day. Please contact the front desk.`,
    });
  }
  // Guard on the status just read so a staff action in between cannot be
  // silently overwritten by the cancel.
  const appt = await Appointment.findOneAndUpdate(
    { _id: req.params.id, patient: req.user.id, status: before.status },
    { $set: { status: 'cancelled' }, $inc: { __v: 1 } },
    { new: true },
  );
  if (!appt) {
    return res.status(409).json({
      success: false,
      code: 'APPOINTMENT_CONFLICT',
      message: 'This appointment changed while you were cancelling it. Reload and try again.',
    });
  }
  const previousStatus = before.status;
  await appt.populate('service', 'name');
  await logActivity({
    req,
    action: 'appointment.cancel',
    target: { type: 'appointment', id: appt._id, label: `${appt.service.name} on ${appt.day}` },
    changes: [['status', previousStatus, 'cancelled']],
    detail: 'Patient cancelled their appointment.',
    appointment: appt._id,
    patient: appt.patient,
  });
  await notifyRoles(['staff', 'admin'], {
    type: 'appointment-cancelled',
    title: `Cancelled: ${appt.service.name} on ${appt.day}`,
    body: 'A patient cancelled an appointment.',
    link: '/staff/appointments',
    keyPrefix: `cancelled:${appt._id}`,
  }).catch(() => {});
  // Remove the mirrored event if one exists. Appointment cancellation succeeds
  // even if Google is unreachable.
  void removeAppointmentFromCalendar(appt).catch(() => {});
  res.json({ success: true, appointment: present(appt.toObject()) });
});

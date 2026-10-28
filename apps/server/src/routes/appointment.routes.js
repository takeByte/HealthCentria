import { Router } from 'express';
import { bookAppointment, cancelAppointment, myAppointments } from '../controllers/appointment.controller.js';
import {
  completeAppointment,
  confirmAppointment,
  declineAppointment,
  lookupPatient,
  queueAppointments,
  walkInAppointment,
} from '../controllers/staff-appointment.controller.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { requireCompleteProfile } from '../middleware/requireCompleteProfile.js';

export const appointmentRouter = Router();

// Patients book and manage their own requests. Booking is the only patient
// action gated by profile completion; viewing and cancelling stay available.
appointmentRouter.post('/', requireAuth, requireRole('patient'), requireCompleteProfile, bookAppointment);
appointmentRouter.get('/mine', requireAuth, requireRole('patient'), myAppointments);
appointmentRouter.patch('/:id/cancel', requireAuth, requireRole('patient'), cancelAppointment);

// Staff/admin triage queue.
appointmentRouter.get('/', requireAuth, requireRole('staff', 'admin'), queueAppointments);
appointmentRouter.get('/lookup-patient', requireAuth, requireRole('staff', 'admin'), lookupPatient);
appointmentRouter.post('/walk-in', requireAuth, requireRole('staff', 'admin'), walkInAppointment);
appointmentRouter.patch('/:id/confirm', requireAuth, requireRole('staff', 'admin'), confirmAppointment);
appointmentRouter.patch('/:id/decline', requireAuth, requireRole('staff', 'admin'), declineAppointment);
appointmentRouter.patch('/:id/complete', requireAuth, requireRole('staff', 'admin'), completeAppointment);

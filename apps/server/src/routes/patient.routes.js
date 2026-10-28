import { Router } from 'express';
import { getPatient, listPatients, updateMyProfile } from '../controllers/patient.controller.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';

export const patientRouter = Router();

// Patients complete their own profile after Google sign-in.
patientRouter.put('/profile', requireAuth, requireRole('patient'), updateMyProfile);

patientRouter.get('/', requireAuth, requireRole('staff', 'admin'), listPatients);
patientRouter.get('/:id', requireAuth, requireRole('staff', 'admin'), getPatient);

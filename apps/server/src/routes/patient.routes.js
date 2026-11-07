import { Router } from 'express';
import {
  getMyProfile,
  getPatient,
  listPatients,
  updateMyProfile,
  updatePatientRecord,
} from '../controllers/patient.controller.js';
import { requireAuth, requirePermission, requireRole } from '../middleware/requireAuth.js';

export const patientRouter = Router();

// Patients view and complete their own profile after Google sign-in.
patientRouter.get('/profile', requireAuth, requireRole('patient'), getMyProfile);
patientRouter.put('/profile', requireAuth, requireRole('patient'), updateMyProfile);

patientRouter.get(
  '/',
  requireAuth,
  requireRole('staff', 'admin'),
  requirePermission('patients.manage'),
  listPatients,
);
patientRouter.get(
  '/:id',
  requireAuth,
  requireRole('staff', 'admin'),
  requirePermission('patients.manage'),
  getPatient,
);
patientRouter.patch(
  '/:id',
  requireAuth,
  requireRole('staff', 'admin'),
  requirePermission('patients.manage'),
  updatePatientRecord,
);

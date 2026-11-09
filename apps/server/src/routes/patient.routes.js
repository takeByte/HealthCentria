import { Router } from 'express';
import {
  deletePatient,
  getMyProfile,
  getPatient,
  listPatients,
  updateMyProfile,
  updatePatientRecord,
} from '../controllers/patient.controller.js';
import { requireAuth, requirePermission, requireRole } from '../middleware/requireAuth.js';
import { requireSuperPin } from '../middleware/requireSuperPin.js';

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
// Admin only, and the superadmin PIN is required: the account is anonymized.
patientRouter.post(
  '/:id/delete',
  requireAuth,
  requireRole('admin'),
  requireSuperPin('Patient account deleted'),
  deletePatient,
);

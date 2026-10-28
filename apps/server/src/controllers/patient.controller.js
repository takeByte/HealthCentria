import mongoose from 'mongoose';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { Appointment } from '../models/appointment.model.js';
import { User } from '../models/user.model.js';
import { presentUser } from '../utils/present-user.js';

const listQuery = z.object({
  search: z.string().trim().max(100).optional().default(''),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

const PROFILE_PHONE_REGEX = /^(?:09\d{9}|\+639\d{9})$/;

function isValidPastBirthdate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return false;
  if (
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() + 1 !== Number(match[2]) ||
    date.getDate() !== Number(match[3])
  ) {
    return false;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date < today;
}

const profileSchema = z.object({
  fullName: z.string().trim().min(1, 'Full name is required.').max(120, 'Full name is too long.'),
  birthdate: z
    .string()
    .trim()
    .min(1, 'Birthdate is required.')
    .refine(isValidPastBirthdate, 'Enter a valid past birthdate.'),
  address: z.string().trim().min(1, 'Address is required.').max(300, 'Address is too long.'),
  barangay: z.string().trim().min(1, 'Barangay is required.').max(120, 'Barangay is too long.'),
  contactNumber: z
    .string()
    .trim()
    .transform((value) => value.replace(/[\s-]/g, ''))
    .refine(
      (value) => PROFILE_PHONE_REGEX.test(value),
      'Enter a valid Philippine contact number (09XXXXXXXXX or +639XXXXXXXXX).',
    ),
});

function requireDB(res) {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({ success: false, message: 'Database is not connected. Try again later.' });
    return false;
  }
  return true;
}

function presentList(u) {
  return {
    id: String(u._id),
    name: u.fullName,
    email: u.email,
    contactNumber: u.contactNumber ?? '',
    householdNumber: u.householdNumber ?? '',
    active: u.active,
    createdAt: u.createdAt,
  };
}

export const listPatients = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: 'Invalid search.' });
  }
  const { search, limit } = parsed.data;
  const filter = { role: 'patient' };
  if (search) {
    const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ fullName: rx }, { email: rx }, { contactNumber: rx }, { householdNumber: rx }];
  }
  const patients = await User.find(filter).sort({ fullName: 1 }).limit(limit).lean();
  res.json({ success: true, patients: patients.map(presentList) });
});

function presentVisit(a) {
  const obj = typeof a.toObject === 'function' ? a.toObject() : a;
  return {
    id: String(obj._id),
    service:
      obj.service && typeof obj.service === 'object'
        ? { id: String(obj.service._id), name: obj.service.name }
        : obj.service,
    day: obj.day,
    status: obj.status,
    diagnosis: obj.diagnosis ?? '',
    prescription: obj.prescription ?? '',
    visitNotes: obj.visitNotes ?? '',
    createdAt: obj.createdAt,
  };
}

export const getPatient = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ success: false, message: 'Patient not found.' });
  }
  const patient = await User.findOne({ _id: req.params.id, role: 'patient' }).lean();
  if (!patient) {
    return res.status(404).json({ success: false, message: 'Patient not found.' });
  }
  const visits = await Appointment.find({ patient: patient._id })
    .populate('service', 'name')
    .sort({ day: -1, createdAt: -1 })
    .lean();
  res.json({
    success: true,
    patient: {
      id: String(patient._id),
      name: patient.fullName,
      email: patient.email,
      birthdate: patient.birthdate,
      sex: patient.sex,
      address: patient.address,
      barangay: patient.barangay ?? '',
      householdNumber: patient.householdNumber,
      contactNumber: patient.contactNumber,
      philHealthNumber: patient.philHealthNumber ?? '',
      emergencyName: patient.emergencyName,
      emergencyNumber: patient.emergencyNumber,
      active: patient.active,
      createdAt: patient.createdAt,
    },
    visits: visits.map(presentVisit),
  });
});

/** PUT /api/patients/profile — patient completes their own profile. */
export const updateMyProfile = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed.',
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  const user = await User.findById(req.user.id);
  if (!user || !user.active) {
    return res.status(401).json({ success: false, message: 'Session is no longer valid. Log in again.' });
  }
  if (user.role !== 'patient') {
    return res.status(403).json({ success: false, message: 'Not allowed for your role.' });
  }

  const data = parsed.data;
  user.fullName = data.fullName;
  user.birthdate = new Date(`${data.birthdate}T00:00:00`);
  user.address = data.address;
  user.barangay = data.barangay;
  user.contactNumber = data.contactNumber;
  // Google does not provide sex, and the completion form intentionally does
  // not ask for it. Keep the schema's complete-patient requirement satisfied.
  if (!user.sex) user.sex = 'Prefer not to say';
  // Only a fully validated request reaches this point.
  user.profileComplete = true;
  await user.save();

  res.json({ success: true, user: presentUser(user) });
});

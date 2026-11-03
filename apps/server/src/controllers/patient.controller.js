import mongoose from 'mongoose';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { Appointment } from '../models/appointment.model.js';
import { User } from '../models/user.model.js';
import { logActivity, snapshotChanges } from '../services/activity.js';
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

const SEX_VALUES = ['Female', 'Male', 'Other', 'Prefer not to say'];

const optionalText = (max, message) => z.string().trim().max(max, message).optional();

/** Staff/admin corrections to a patient chart. Account fields are intentionally absent. */
const staffProfileSchema = z.object({
  fullName: z.string().trim().min(1, 'Full name is required.').max(120, 'Full name is too long.').optional(),
  birthdate: z
    .string()
    .trim()
    .min(1, 'Birthdate is required.')
    .refine(isValidPastBirthdate, 'Enter a valid past birthdate.')
    .optional(),
  sex: z.enum(SEX_VALUES).or(z.literal('')).optional(),
  address: z.string().trim().min(1, 'Address is required.').max(300, 'Address is too long.').optional(),
  barangay: z.string().trim().min(1, 'Barangay is required.').max(120, 'Barangay is too long.').optional(),
  householdNumber: optionalText(60, 'Household number is too long.'),
  contactNumber: z
    .string()
    .trim()
    .transform((value) => value.replace(/[\s-]/g, ''))
    .refine(
      (value) => PROFILE_PHONE_REGEX.test(value),
      'Enter a valid Philippine contact number (09XXXXXXXXX or +639XXXXXXXXX).',
    )
    .optional(),
  philHealthNumber: optionalText(60, 'PhilHealth number is too long.'),
  emergencyName: optionalText(120, 'Emergency contact name is too long.'),
  emergencyNumber: optionalText(60, 'Emergency contact number is too long.'),
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
    updatedAt: u.updatedAt,
  };
}

function presentProfile(u) {
  const birthdate = u.birthdate ? new Date(u.birthdate) : null;
  return {
    id: String(u._id),
    name: u.fullName,
    email: u.email,
    birthdate: birthdate && !Number.isNaN(birthdate.getTime()) ? birthdate.toISOString().slice(0, 10) : '',
    sex: u.sex ?? '',
    address: u.address ?? '',
    barangay: u.barangay ?? '',
    householdNumber: u.householdNumber ?? '',
    contactNumber: u.contactNumber ?? '',
    philHealthNumber: u.philHealthNumber ?? '',
    emergencyName: u.emergencyName ?? '',
    emergencyNumber: u.emergencyNumber ?? '',
    active: u.active,
    authProvider: u.provider ?? 'local',
    profileCompleted: u.profileComplete !== false,
    avatarUrl: u.avatarUrl ?? '',
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    updatedByName:
      u.updatedBy && typeof u.updatedBy === 'object' ? u.updatedBy.fullName ?? '' : '',
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
    updatedAt: obj.updatedAt,
    updatedByName:
      obj.updatedBy && typeof obj.updatedBy === 'object' ? obj.updatedBy.fullName ?? '' : '',
  };
}

export const getPatient = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ success: false, message: 'Patient not found.' });
  }
  const patient = await User.findOne({ _id: req.params.id, role: 'patient' })
    .populate('updatedBy', 'fullName')
    .lean();
  if (!patient) {
    return res.status(404).json({ success: false, message: 'Patient not found.' });
  }
  const visits = await Appointment.find({ patient: patient._id })
    .populate('service', 'name')
    .populate('updatedBy', 'fullName')
    .sort({ day: -1, createdAt: -1 })
    .lean();
  res.json({
    success: true,
    patient: presentProfile(patient),
    visits: visits.map(presentVisit),
  });
});

/** GET /api/patients/profile — the signed-in patient's own chart. */
export const getMyProfile = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const user = await User.findById(req.user.id).lean();
  if (!user || !user.active) {
    return res.status(401).json({ success: false, message: 'Session is no longer valid. Log in again.' });
  }
  if (user.role !== 'patient') {
    return res.status(403).json({ success: false, message: 'Not allowed for your role.' });
  }
  res.json({ success: true, patient: presentProfile(user) });
});

/** PATCH /api/patients/:id — staff/admin corrections to a patient chart. */
export const updatePatientRecord = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ success: false, message: 'Patient not found.' });
  }

  const parsed = staffProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed.',
      errors: parsed.error.flatten().fieldErrors,
    });
  }
  if (Object.keys(parsed.data).length === 0) {
    return res.status(400).json({ success: false, message: 'No changes provided.' });
  }

  const patient = await User.findOne({ _id: req.params.id, role: 'patient' });
  if (!patient) {
    return res.status(404).json({ success: false, message: 'Patient not found.' });
  }

  const data = parsed.data;
  // Snapshot the tracked fields before writing so the log shows real diffs.
  const before = {};
  for (const field of Object.keys(data)) before[field] = patient.get(field);
  if (data.fullName !== undefined) patient.fullName = data.fullName;
  if (data.birthdate !== undefined) patient.birthdate = new Date(`${data.birthdate}T00:00:00`);
  if (data.sex) patient.sex = data.sex;
  if (data.address !== undefined) patient.address = data.address;
  if (data.barangay !== undefined) patient.barangay = data.barangay;
  if (data.householdNumber !== undefined) patient.householdNumber = data.householdNumber;
  if (data.contactNumber !== undefined) patient.contactNumber = data.contactNumber;
  if (data.philHealthNumber !== undefined) patient.philHealthNumber = data.philHealthNumber;
  if (data.emergencyName !== undefined) patient.emergencyName = data.emergencyName;
  if (data.emergencyNumber !== undefined) patient.emergencyNumber = data.emergencyNumber;

  // Preserve legacy complete records; only promote an incomplete chart once
  // staff have supplied every field the booking gate expects.
  if (patient.profileComplete === false) {
    const complete = Boolean(
      patient.fullName?.trim() &&
        patient.birthdate &&
        patient.sex &&
        patient.address?.trim() &&
        patient.barangay?.trim() &&
        patient.contactNumber?.trim(),
    );
    if (complete) patient.profileComplete = true;
  }

  patient.updatedBy = req.user.id;
  await patient.save();
  // Populate so the response carries the editor's name for "Updated by".
  await patient.populate('updatedBy', 'fullName');
  await logActivity({
    req,
    action: 'patient.update',
    target: { type: 'patient', id: patient._id, label: patient.fullName },
    changes: snapshotChanges(before, patient, Object.keys(data)),
    detail: `Patient chart updated: ${Object.keys(data).join(', ')}.`,
    patient: patient._id,
  });

  res.json({ success: true, patient: presentProfile(patient) });
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
  const before = {
    fullName: user.fullName,
    birthdate: user.birthdate,
    address: user.address,
    barangay: user.barangay,
    contactNumber: user.contactNumber,
  };
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

  await logActivity({
    req,
    action: 'patient.update',
    target: { type: 'patient', id: user._id, label: user.fullName },
    changes: snapshotChanges(before, user, Object.keys(before)),
    detail: 'Patient completed their own profile.',
    patient: user._id,
  });

  res.json({ success: true, user: presentUser(user) });
});

import mongoose from 'mongoose';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { Appointment } from '../models/appointment.model.js';
import { CalendarEventLink } from '../models/calendar-event-link.model.js';
import { Notification } from '../models/notification.model.js';
import { User } from '../models/user.model.js';
import { VerificationCode } from '../models/verification-code.model.js';
import { removeAppointmentFromCalendar } from '../services/google-calendar.js';
import { todayYMD } from '../utils/service-schedule.js';
import { logActivity, snapshotChanges } from '../services/activity.js';
import { presentUser } from '../utils/present-user.js';
import { avatarSchema } from '../utils/avatar.js';

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

const optionalText = (max, message) => z.string().trim().max(max, message).optional();

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
  // Optional details the patient can maintain themselves.
  householdNumber: optionalText(60, 'Household number is too long.'),
  emergencyName: optionalText(120, 'Emergency contact name is too long.'),
  emergencyNumber: optionalText(60, 'Emergency contact number is too long.'),
  avatarUrl: avatarSchema.optional(),
});

const SEX_VALUES = ['Female', 'Male', 'Other', 'Prefer not to say'];

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

const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

function medicalList(label) {
  return z
    .array(z.string().trim().min(1, `${label} entries cannot be empty.`).max(120, `A ${label.toLowerCase()} entry is too long.`))
    .max(30, `Too many ${label.toLowerCase()} entries.`);
}

/** Medical profile entered by staff. The whole profile is replaced on each save. */
const medicalSchema = z.object({
  bloodType: z.enum(BLOOD_TYPES).or(z.literal('')),
  allergies: medicalList('Allergy'),
  conditions: medicalList('Condition'),
  medications: medicalList('Medication'),
  immunizations: z
    .array(
      z.object({
        name: z.string().trim().min(1, 'Each vaccine needs a name.').max(120, 'A vaccine name is too long.'),
        date: z
          .string()
          .trim()
          .refine((v) => v === '' || isValidPastBirthdate(v) || v === todayYMD(), 'Enter a valid vaccine date.'),
        note: z.string().trim().max(200, 'A vaccine note is too long.'),
      }),
    )
    .max(50, 'Too many vaccines listed.'),
});

/** Case-insensitive de-duplication that keeps the first spelling. */
function uniqueList(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function presentMedical(u) {
  const m = u.medicalProfile ?? {};
  return {
    bloodType: m.bloodType ?? '',
    allergies: m.allergies ?? [],
    conditions: m.conditions ?? [],
    medications: m.medications ?? [],
    immunizations: (m.immunizations ?? []).map((i) => ({ name: i.name ?? '', date: i.date ?? '', note: i.note ?? '' })),
    recordedAt: m.recordedAt ?? null,
  };
}

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
    medical: presentMedical(u),
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
  const filter = { role: 'patient', deletedAt: null };
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
  const patient = await User.findOne({ _id: req.params.id, role: 'patient', deletedAt: null })
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

  const patient = await User.findOne({ _id: req.params.id, role: 'patient', deletedAt: null });
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

/**
 * PATCH /api/patients/:id/medical — staff/admin replace a patient's medical
 * profile (blood type, allergies, conditions, medications, immunizations).
 * Patients only ever read it. The activity log records which sections changed,
 * never the clinical values themselves.
 */
export const updatePatientMedical = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ success: false, message: 'Patient not found.' });
  }
  const parsed = medicalSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed.',
      errors: parsed.error.flatten().fieldErrors,
    });
  }
  const patient = await User.findOne({ _id: req.params.id, role: 'patient', deletedAt: null });
  if (!patient) {
    return res.status(404).json({ success: false, message: 'Patient not found.' });
  }

  const before = presentMedical(patient);
  const data = parsed.data;
  const next = {
    bloodType: data.bloodType,
    allergies: uniqueList(data.allergies),
    conditions: uniqueList(data.conditions),
    medications: uniqueList(data.medications),
    immunizations: data.immunizations,
  };
  const changed = Object.keys(next).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(next[key]));

  patient.medicalProfile = { ...next, recordedAt: new Date(), recordedBy: req.user.id };
  patient.updatedBy = req.user.id;
  await patient.save();
  await patient.populate('updatedBy', 'fullName');

  if (changed.length) {
    await logActivity({
      req,
      action: 'patient.medical_update',
      target: { type: 'patient', id: patient._id, label: patient.fullName },
      detail: `Medical profile updated: ${changed.join(', ')}.`,
      patient: patient._id,
    });
  }

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
  const hadAvatar = Boolean(user.avatarUrl);
  const before = {
    fullName: user.fullName,
    birthdate: user.birthdate,
    address: user.address,
    barangay: user.barangay,
    contactNumber: user.contactNumber,
    householdNumber: user.householdNumber,
    emergencyName: user.emergencyName,
    emergencyNumber: user.emergencyNumber,
  };
  user.fullName = data.fullName;
  user.birthdate = new Date(`${data.birthdate}T00:00:00`);
  user.address = data.address;
  user.barangay = data.barangay;
  user.contactNumber = data.contactNumber;
  if (data.householdNumber !== undefined) user.householdNumber = data.householdNumber;
  if (data.emergencyName !== undefined) user.emergencyName = data.emergencyName;
  if (data.emergencyNumber !== undefined) user.emergencyNumber = data.emergencyNumber;
  const avatarChanged = data.avatarUrl !== undefined && data.avatarUrl !== (user.avatarUrl ?? '');
  if (data.avatarUrl !== undefined) user.avatarUrl = data.avatarUrl;
  // Google does not provide sex, and the completion form intentionally does
  // not ask for it. Keep the schema's complete-patient requirement satisfied.
  if (!user.sex) user.sex = 'Prefer not to say';
  // Only a fully validated request reaches this point.
  user.profileComplete = true;
  await user.save();

  const changes = snapshotChanges(before, user, Object.keys(before));
  if (avatarChanged) {
    // Keep image data out of the activity log; record only the outcome.
    changes.push(['avatarUrl', hadAvatar ? 'Photo set' : 'No photo', user.avatarUrl ? 'Photo set' : 'No photo']);
  }

  await logActivity({
    req,
    action: 'patient.update',
    target: { type: 'patient', id: user._id, label: user.fullName },
    changes,
    detail: 'Patient updated their own profile.',
    patient: user._id,
  });

  res.json({ success: true, user: presentUser(user) });
});

/**
 * POST /api/patients/:id/delete — admin only, superadmin PIN + email approval (route).
 *
 * The account becomes an anonymous "Deleted patient" placeholder instead of
 * disappearing, so appointments that reference it (and the report counts built
 * from them) stay valid:
 *  - every personal field is wiped, sign-in is blocked, sessions are revoked,
 *    and the email is freed so the person could register again later;
 *  - upcoming pending/confirmed appointments are cancelled;
 *  - every appointment keeps only service, date and status (diagnosis,
 *    prescription, notes and decline reasons are wiped);
 *  - Google Calendar events (which show the name) are removed;
 *  - notifications and pending email codes are deleted.
 * Activity log entries are kept: they are the audit trail.
 */
export const deletePatient = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ success: false, message: 'Patient not found.' });
  }
  const patient = await User.findOne({ _id: req.params.id, role: 'patient', deletedAt: null }).lean();
  if (!patient) {
    return res.status(404).json({ success: false, message: 'Patient not found.' });
  }

  const today = todayYMD();
  const appointments = await Appointment.find({ patient: patient._id }).select('_id status day').lean();
  const upcoming = appointments.filter((a) => ['pending', 'confirmed'].includes(a.status) && a.day >= today);

  // Calendar events carry the patient's name: remove every one that exists
  // (only appointments with a live link, so nothing new is created). Best effort.
  const linked = await CalendarEventLink.find({
    appointment: { $in: appointments.map((a) => a._id) },
    status: { $ne: 'deleted' },
  })
    .select('appointment')
    .lean();
  await Promise.all(linked.map((l) => removeAppointmentFromCalendar(l.appointment).catch(() => null)));

  if (upcoming.length) {
    await Appointment.updateMany(
      { _id: { $in: upcoming.map((a) => a._id) } },
      { $set: { status: 'cancelled', updatedBy: req.user.id } },
    );
  }
  await Appointment.updateMany(
    { patient: patient._id },
    { $set: { diagnosis: '', prescription: '', visitNotes: '', notes: '', declineReason: '' } },
  );

  await Promise.all([
    Notification.deleteMany({ recipient: patient._id }),
    VerificationCode.deleteMany({ email: patient.email }),
  ]);

  // updateOne skips schema validators on purpose: the placeholder has no
  // password, Google id or profile fields, which a normal save would refuse.
  await User.updateOne(
    { _id: patient._id },
    {
      $set: {
        email: `deleted-${patient._id}@deleted.invalid`,
        fullName: 'Deleted patient',
        active: false,
        deletedAt: new Date(),
        profileComplete: false,
        emailVerified: false,
        emailVerifiedAt: null,
        provider: 'local',
        avatarUrl: '',
        barangay: '',
        householdNumber: '',
        philHealthNumber: '',
        emergencyName: '',
        emergencyNumber: '',
        updatedBy: req.user.id,
      },
      $unset: {
        passwordHash: '',
        googleId: '',
        birthdate: '',
        sex: '',
        address: '',
        contactNumber: '',
        medicalProfile: '',
      },
      $inc: { tokenVersion: 1 },
    },
  );

  const kept = appointments.length - upcoming.length;
  await logActivity({
    req,
    action: 'patient.delete',
    target: { type: 'patient', id: patient._id, label: patient.fullName || patient.email },
    detail: `Patient account deleted and anonymized. ${upcoming.length} upcoming appointment(s) cancelled; ${kept} past visit(s) kept for reports without clinical notes.`,
  });

  res.json({ success: true, cancelled: upcoming.length, keptVisits: kept });
});

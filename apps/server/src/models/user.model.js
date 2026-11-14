import mongoose from 'mongoose';
import { PERMISSION_KEYS } from '../utils/permissions.js';

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    // Optional for accounts created through Google sign-in (no local password).
    passwordHash: { type: String, required: function () { return !this.googleId; } },
    // Google account subject id ("sub"). Sparse so local accounts (no value) are
    // excluded from the unique index.
    googleId: { type: String, unique: true, sparse: true, index: true },
    // Auth source for this account. Google-created patients start with "google";
    // linked email/password accounts keep "local" so password login still works.
    provider: { type: String, enum: ['local', 'google'], default: 'local' },
    // Fixed roles for v1 — public registration always creates "patient".
    // Staff/admin accounts are created by an admin (see future staff management).
    role: { type: String, enum: ['patient', 'staff', 'admin'], default: 'patient' },
    // Granular staff capabilities. Admins ignore this list and always have
    // every permission; patients never have any. Undefined on legacy staff
    // records means "unrestricted" — see utils/permissions.js.
    permissions: { type: [String], enum: PERMISSION_KEYS, default: undefined },
    active: { type: Boolean, default: true },
    // Email ownership. Self-registered patients start unverified and see a
    // reminder until they enter the code; staff/admin accounts, Google
    // sign-ins, and seeded demo data are trusted by default. Rows created
    // before this field existed have no value and are treated as verified.
    emailVerified: { type: Boolean, default: true },
    emailVerifiedAt: { type: Date, default: null },
    // Incremented whenever the password changes or an admin forces a reset.
    // The value is embedded in every JWT, so bumping it revokes all sessions.
    tokenVersion: { type: Number, default: 0 },
    fullName: { type: String, required: true, trim: true },
    // Optional Google avatar. Kept separate from the patient's profile fields.
    avatarUrl: { type: String, default: '', trim: true },
    // Patient profile fields are required for patients only — staff/admin
    // accounts are created with just name + email + password (see seed script
    // now, Staff Accounts UI later). Google sign-in creates a patient with an
    // incomplete profile (profileComplete: false) so these stay optional until
    // the patient fills them in.
    profileComplete: { type: Boolean, default: true },
    birthdate: { type: Date, required: function () { return this.requiresPatientProfile(); } },
    sex: {
      type: String,
      required: function () { return this.requiresPatientProfile(); },
      enum: ['Female', 'Male', 'Other', 'Prefer not to say'],
    },
    address: { type: String, required: function () { return this.requiresPatientProfile(); }, trim: true },
    // Required by the Complete Profile form, but intentionally optional at the
    // schema level so older patient records can still be updated safely.
    barangay: { type: String, default: '', trim: true },
    // Household and emergency details are optional: registration no longer
    // asks for them, and staff can fill them in later from the patient record.
    householdNumber: { type: String, default: '', trim: true },
    contactNumber: { type: String, required: function () { return this.requiresPatientProfile(); }, trim: true },
    philHealthNumber: { type: String, trim: true, default: '' },
    emergencyName: { type: String, default: '', trim: true },
    emergencyNumber: { type: String, default: '', trim: true },
    // Optional emails controlled from the patient's Settings. Announcements are
    // opt-in (off by default); appointment updates are on by default. Accounts
    // that never touched Settings have no stored value and get the same
    // defaults (see prefAllows). Security emails (verification and reset
    // codes) ignore these.
    emailPrefs: {
      announcements: { type: Boolean, default: false },
      appointments: { type: Boolean, default: true },
    },
    // Clinical background entered by center staff (patients see it read-only).
    // Wiped when the account is deleted; see deletePatient.
    medicalProfile: {
      bloodType: { type: String, default: '', trim: true },
      allergies: { type: [String], default: [] },
      conditions: { type: [String], default: [] },
      medications: { type: [String], default: [] },
      immunizations: {
        type: [
          {
            _id: false,
            name: { type: String, trim: true },
            // YYYY-MM-DD, or empty when the date is unknown.
            date: { type: String, default: '', trim: true },
            note: { type: String, default: '', trim: true },
          },
        ],
        default: [],
      },
      recordedAt: { type: Date, default: null },
      recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    },
    // Last staff/admin account to edit this chart (patients editing their own
    // profile leave it null). Shown as "Updated by" on the patient record.
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Set when an admin deletes a patient account. The row stays as an
    // anonymous "Deleted patient" placeholder so past visits keep counting in
    // reports; every personal field is wiped and sign-in is impossible.
    deletedAt: { type: Date, default: null, index: true },
  },
  // Admin edits and self-service profile/password changes can race. A stale
  // save raises Mongoose's VersionError, which the API reports as HTTP 409.
  { timestamps: true, optimisticConcurrency: true },
);

// Patient profile fields are optional while a Google-created account is still
// incomplete (profileComplete === false); otherwise patients must supply them.
userSchema.methods.requiresPatientProfile = function () {
  return this.role === 'patient' && this.profileComplete !== false;
};

export const User = mongoose.models.User ?? mongoose.model('User', userSchema);

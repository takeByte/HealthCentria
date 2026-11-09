/**
 * Capability catalog for staff accounts.
 *
 * Admins always have every permission. Staff get exactly what an admin grants
 * them in Staff Accounts. A staff account with no `permissions` array is a
 * legacy record created before this feature existed — treat it as unrestricted
 * so existing accounts keep working after the upgrade.
 */
export const PERMISSIONS = [
  {
    key: 'appointments.manage',
    label: 'Appointments',
    description: 'Review, confirm, decline and complete appointment requests.',
  },
  {
    key: 'walkin.manage',
    label: 'Walk-in',
    description: 'Register patients who arrive without an appointment.',
  },
  {
    key: 'patients.manage',
    label: 'Patients',
    description: 'View and update patient records.',
  },
  {
    key: 'services.manage',
    label: 'Services',
    description: 'Create and update clinic services.',
  },
  {
    key: 'announcements.manage',
    label: 'Announcements',
    description: 'Post and edit announcements.',
  },
  {
    key: 'reports.view',
    label: 'Reports',
    description: 'View and export clinic reports.',
  },
];

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

/** Staff created before permissions existed keep full access. */
export const DEFAULT_STAFF_PERMISSIONS = [...PERMISSION_KEYS];

export function effectivePermissions(user) {
  if (!user) return [];
  if (user.role === 'admin') return [...PERMISSION_KEYS];
  if (user.role !== 'staff') return [];
  if (!Array.isArray(user.permissions)) return [...DEFAULT_STAFF_PERMISSIONS];
  return user.permissions.filter((key) => PERMISSION_KEYS.includes(key));
}

/** True when the user has at least one of the required permissions. */
export function hasPermission(user, ...required) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (!required.length) return true;
  const granted = effectivePermissions(user);
  return required.some((key) => granted.includes(key));
}

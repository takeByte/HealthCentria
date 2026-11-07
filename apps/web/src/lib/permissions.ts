import type { AuthSession } from './auth';

export interface PermissionOption {
  key: string;
  label: string;
  description: string;
}

/**
 * Mirrors apps/server/src/utils/permissions.js. Keep the keys in sync — the
 * API rejects unknown permission keys, so a mismatch shows up immediately.
 */
export const PERMISSION_OPTIONS: PermissionOption[] = [
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

export const PERMISSION_KEYS = PERMISSION_OPTIONS.map((p) => p.key);

export const DEFAULT_STAFF_PERMISSIONS = [...PERMISSION_KEYS];

/**
 * Admins can do everything. Staff need the explicit permission. Sessions saved
 * before permissions existed have no `permissions` array — treat those as full
 * access so existing staff are not locked out until they sign in again.
 */
export function sessionCan(session: AuthSession | null | undefined, permission: string): boolean {
  if (!session) return false;
  if (session.role === 'admin') return true;
  if (session.role !== 'staff') return false;
  if (!Array.isArray(session.permissions)) return true;
  return session.permissions.includes(permission);
}

export function permissionLabel(key: string): string {
  return PERMISSION_OPTIONS.find((p) => p.key === key)?.label ?? key;
}

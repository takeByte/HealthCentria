import {
  Bell,
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  DatabaseBackup,
  FileText,
  History,
  LayoutDashboard,
  Megaphone,
  Settings,
  UserCog,
  UserRound,
  Users,
} from 'lucide-react';
import type { ShellNavItem } from './dashboard-shell';

// Single source of truth for the ops sidebar. Staff and admin share every
// screen — the only difference is the dashboard home and (for admins) the
// Staff Accounts entry. Pages pick via opsNav(session?.role, session?.permissions)
// so the sidebar never flips roles when an admin opens a shared tab.
export const staffNav: ShellNavItem[] = [
  { label: 'Dashboard', to: '/staff/dashboard', icon: LayoutDashboard, group: 'Overview' },
  { label: 'Appointments', to: '/staff/appointments', icon: CalendarCheck, group: 'Clinic' },
  { label: 'Patients', to: '/staff/patients', icon: Users, group: 'Clinic' },
  { label: 'Walk-in', to: '/staff/walk-in', icon: ClipboardList, group: 'Clinic' },
  { label: 'Services', to: '/staff/services', icon: CalendarDays, group: 'Clinic' },
  { label: 'Announcements', to: '/staff/announcements', icon: Megaphone, group: 'Communication' },
  { label: 'Notifications', to: '/staff/notifications', icon: Bell, group: 'Communication' },
  { label: 'Activity', to: '/staff/activity', icon: History, group: 'Insights' },
  { label: 'Reports', to: '/staff/reports', icon: FileText, group: 'Insights' },
  { label: 'My Profile', to: '/staff/profile', icon: UserRound, group: 'Account' },
];

export const adminNav: ShellNavItem[] = [
  { label: 'Dashboard', to: '/admin/dashboard', icon: LayoutDashboard, group: 'Overview' },
  { label: 'Appointments', to: '/staff/appointments', icon: CalendarCheck, group: 'Clinic' },
  { label: 'Patients', to: '/staff/patients', icon: Users, group: 'Clinic' },
  { label: 'Walk-in', to: '/staff/walk-in', icon: ClipboardList, group: 'Clinic' },
  { label: 'Services', to: '/staff/services', icon: CalendarDays, group: 'Clinic' },
  { label: 'Announcements', to: '/staff/announcements', icon: Megaphone, group: 'Communication' },
  { label: 'Notifications', to: '/staff/notifications', icon: Bell, group: 'Communication' },
  { label: 'Activity log', to: '/admin/activity', icon: History, group: 'Insights' },
  { label: 'Reports', to: '/staff/reports', icon: FileText, group: 'Insights' },
  { label: 'Staff Accounts', to: '/admin/staff-accounts', icon: UserCog, group: 'Administration' },
  { label: 'Backups', to: '/admin/backups', icon: DatabaseBackup, group: 'Administration' },
  { label: 'Settings', to: '/admin/settings', icon: Settings, group: 'Administration' },
  { label: 'My Profile', to: '/staff/profile', icon: UserRound, group: 'Account' },
];

/** Which capability unlocks each staff screen. Unlisted screens are always on. */
const STAFF_ROUTE_PERMISSION: Record<string, string> = {
  '/staff/appointments': 'appointments.manage',
  '/staff/patients': 'patients.manage',
  '/staff/walk-in': 'walkin.manage',
  '/staff/services': 'services.manage',
  '/staff/announcements': 'announcements.manage',
  '/staff/reports': 'reports.view',
};

export function opsNav(role?: string, permissions?: string[]): ShellNavItem[] {
  if (role === 'admin') return adminNav;
  // Sessions saved before permissions existed have no list — keep the full nav.
  if (!permissions) return staffNav;
  return staffNav.filter((item) => {
    const required = item.to ? STAFF_ROUTE_PERMISSION[item.to] : undefined;
    return !required || permissions.includes(required);
  });
}

import {
  Bell,
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  FileText,
  LayoutDashboard,
  Megaphone,
  Settings,
  UserCog,
  Users,
} from 'lucide-react';
import type { ShellNavItem } from './dashboard-shell';

// Single source of truth for the ops sidebar. Staff and admin share every
// screen — the only difference is the dashboard home and (for admins) the
// Staff Accounts entry. Pages pick via opsNav(session?.role) so the sidebar
// never flips roles when an admin opens a shared tab.
export const staffNav: ShellNavItem[] = [
  { label: 'Dashboard', to: '/staff/dashboard', icon: LayoutDashboard },
  { label: 'Appointments', to: '/staff/appointments', icon: CalendarCheck },
  { label: 'Patients', to: '/staff/patients', icon: Users },
  { label: 'Walk-in', to: '/staff/walk-in', icon: ClipboardList },
  { label: 'Services', to: '/staff/services', icon: CalendarDays },
  { label: 'Announcements', to: '/staff/announcements', icon: Megaphone },
  { label: 'Notifications', to: '/staff/notifications', icon: Bell },
  { label: 'Reports', to: '/staff/reports', icon: FileText },
];

export const adminNav: ShellNavItem[] = [
  { label: 'Dashboard', to: '/admin/dashboard', icon: LayoutDashboard },
  { label: 'Appointments', to: '/staff/appointments', icon: CalendarCheck },
  { label: 'Patients', to: '/staff/patients', icon: Users },
  { label: 'Walk-in', to: '/staff/walk-in', icon: ClipboardList },
  { label: 'Services', to: '/staff/services', icon: CalendarDays },
  { label: 'Announcements', to: '/staff/announcements', icon: Megaphone },
  { label: 'Notifications', to: '/staff/notifications', icon: Bell },
  { label: 'Reports', to: '/staff/reports', icon: FileText },
  { label: 'Staff Accounts', to: '/admin/staff-accounts', icon: UserCog },
  { label: 'Settings', to: '/admin/settings', icon: Settings },
];

export function opsNav(role?: string): ShellNavItem[] {
  return role === 'admin' ? adminNav : staffNav;
}

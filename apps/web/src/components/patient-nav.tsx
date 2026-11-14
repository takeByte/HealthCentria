import {
  Bell,
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  History,
  LayoutDashboard,
  Megaphone,
  Plus,
  Settings,
  UserRound,
} from 'lucide-react';
import type { ShellNavItem } from './dashboard-shell';

/** Single source of truth for the patient sidebar — every patient page uses this. */
export const patientNav: ShellNavItem[] = [
  { label: 'Dashboard', to: '/app/dashboard', icon: LayoutDashboard, group: 'Overview' },
  { label: 'Services', to: '/app/services', icon: CalendarDays, group: 'Care' },
  { label: 'Book Appointment', to: '/app/appointments/new', icon: Plus, group: 'Care' },
  { label: 'My Appointments', to: '/app/appointments', icon: CalendarCheck, group: 'Care' },
  { label: 'My Records', to: '/app/records', icon: ClipboardList, group: 'Care' },
  { label: 'Activity', to: '/app/activity', icon: History, group: 'Care' },
  { label: 'Announcements', to: '/app/announcements', icon: Megaphone, group: 'Communication' },
  { label: 'Notifications', to: '/app/notifications', icon: Bell, group: 'Communication' },
  { label: 'My Profile', to: '/app/profile', icon: UserRound, group: 'Account' },
  { label: 'Settings', to: '/app/settings', icon: Settings, group: 'Account' },
];

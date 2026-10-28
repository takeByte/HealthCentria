import { getSession } from './auth';

export interface HealthResponse {
  success: boolean;
  message: string;
  uptime: number;
  db: string;
  timestamp: string;
}

export interface ServiceSchedule {
  mode: 'weekly' | 'nth-weekday' | 'as-needed';
  weekdays: number[];
  nthWeek?: number;
  weekday?: number;
}

export interface Service {
  id: string;
  name: string;
  description: string;
  schedule: ServiceSchedule;
  scheduleText: string;
  active: boolean;
}

export interface Appointment {
  id: string;
  service: { id: string; name: string } | string;
  day: string;
  timePreference: 'morning' | 'afternoon' | 'any';
  notes: string;
  status: 'pending' | 'confirmed' | 'declined' | 'completed' | 'cancelled';
  declineReason: string;
  diagnosis: string;
  prescription: string;
  visitNotes: string;
  createdAt: string;
}

export interface StaffAppointment extends Appointment {
  patient: { id: string; name: string; email: string } | string;
}

export class ApiError extends Error {
  status: number;
  errors?: Record<string, string[]>;
  code?: string;
  constructor(status: number, message: string, errors?: Record<string, string[]>, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors;
    this.code = code;
  }
}

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:5000';

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_URL}/api/health`);
  if (!res.ok) throw new Error(`API responded with ${res.status}`);
  return res.json() as Promise<HealthResponse>;
}

async function apiFetch<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getSession()?.token;
  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  let data: { message?: string; errors?: Record<string, string[]>; code?: string } | null = null;
  try {
    data = (await res.json()) as { message?: string; errors?: Record<string, string[]>; code?: string };
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new ApiError(res.status, data?.message ?? `Request failed (${res.status}).`, data?.errors, data?.code);
  }
  return data as T;
}

export function listServices(): Promise<{ services: Service[] }> {
  return apiFetch('/api/services');
}

export interface ServiceInput {
  name: string;
  description?: string;
  schedule: ServiceSchedule;
  active?: boolean;
}

export function createService(input: ServiceInput): Promise<{ service: Service }> {
  return apiFetch('/api/services', { method: 'POST', body: input });
}

export function updateService(id: string, input: Partial<ServiceInput>): Promise<{ service: Service }> {
  return apiFetch(`/api/services/${id}`, { method: 'PATCH', body: input });
}

export function validDates(serviceId: string, days = 30): Promise<{ dates: string[] }> {
  return apiFetch(`/api/services/${serviceId}/valid-dates?days=${days}`);
}

export function bookAppointment(input: {
  serviceId: string;
  day: string;
  timePreference?: string;
  notes?: string;
}): Promise<{ appointment: Appointment }> {
  return apiFetch('/api/appointments', { method: 'POST', body: input });
}

export function myAppointments(): Promise<{ appointments: Appointment[] }> {
  return apiFetch('/api/appointments/mine');
}

export function cancelAppointment(id: string): Promise<{ appointment: Appointment }> {
  return apiFetch(`/api/appointments/${id}/cancel`, { method: 'PATCH' });
}

export interface PatientProfileInput {
  fullName: string;
  birthdate: string;
  address: string;
  barangay: string;
  contactNumber: string;
}

export interface PatientProfileUser {
  id: string;
  name: string;
  email: string;
  role: 'patient' | 'staff' | 'admin';
  authProvider: 'local' | 'google';
  profileCompleted: boolean;
  avatarUrl: string;
}

/** Complete a patient's profile after Google sign-in (or after a partial save). */
export function completePatientProfile(input: PatientProfileInput): Promise<{ success: true; user: PatientProfileUser }> {
  return apiFetch('/api/patients/profile', { method: 'PUT', body: input });
}

export function queueAppointments(filters: {
  status?: string;
  serviceId?: string;
  from?: string;
  to?: string;
} = {}): Promise<{ appointments: StaffAppointment[] }> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.serviceId) params.set('serviceId', filters.serviceId);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  const qs = params.toString();
  return apiFetch(`/api/appointments${qs ? `?${qs}` : ''}`);
}

export function confirmAppointment(id: string): Promise<{ appointment: StaffAppointment }> {
  return apiFetch(`/api/appointments/${id}/confirm`, { method: 'PATCH' });
}

export function declineAppointment(id: string, reason: string): Promise<{ appointment: StaffAppointment }> {
  return apiFetch(`/api/appointments/${id}/decline`, { method: 'PATCH', body: { reason } });
}

export function completeAppointment(
  id: string,
  clinical: { diagnosis?: string; prescription?: string; visitNotes?: string } = {},
): Promise<{ appointment: StaffAppointment }> {
  return apiFetch(`/api/appointments/${id}/complete`, { method: 'PATCH', body: clinical });
}

export type AnnouncementCategory = 'schedule-change' | 'vaccination-day' | 'health-advisory' | 'general';

export interface Announcement {
  id: string;
  title: string;
  body: string;
  category: AnnouncementCategory;
  pinned: boolean;
  publishedAt: string;
}

export const CATEGORY_LABELS: Record<AnnouncementCategory, string> = {
  'schedule-change': 'Schedule Change',
  'vaccination-day': 'Vaccination Day',
  'health-advisory': 'Health Advisory',
  general: 'General',
};

export function listAnnouncements(): Promise<{ announcements: Announcement[] }> {
  return apiFetch('/api/announcements');
}

export function createAnnouncement(input: {
  title: string;
  body: string;
  category: AnnouncementCategory;
  pinned: boolean;
}): Promise<{ announcement: Announcement }> {
  return apiFetch('/api/announcements', { method: 'POST', body: input });
}

export function updateAnnouncement(
  id: string,
  input: Partial<{ title: string; body: string; category: AnnouncementCategory; pinned: boolean; active: boolean }>,
): Promise<{ announcement: Announcement }> {
  return apiFetch(`/api/announcements/${id}`, { method: 'PATCH', body: input });
}

export function deleteAnnouncement(id: string): Promise<{ success: boolean }> {
  return apiFetch(`/api/announcements/${id}`, { method: 'DELETE' });
}

export type NotificationType =
  | 'appointment-confirmed'
  | 'appointment-declined'
  | 'appointment-cancelled'
  | 'new-request'
  | 'new-announcement'
  | 'reminder';

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string;
  read: boolean;
  createdAt: string;
}

export function listNotifications(): Promise<{ unread: number; notifications: NotificationItem[] }> {
  return apiFetch('/api/notifications');
}

export function markNotificationRead(id: string): Promise<{ notification: NotificationItem }> {
  return apiFetch(`/api/notifications/${id}/read`, { method: 'PATCH' });
}

export function markAllNotificationsRead(): Promise<{ success: boolean }> {
  return apiFetch('/api/notifications/read-all', { method: 'POST' });
}

export interface WalkInNewPatient {
  fullName: string;
  email: string;
  birthdate: string;
  sex: 'Female' | 'Male' | 'Other' | 'Prefer not to say';
  address: string;
  householdNumber: string;
  contactNumber: string;
  philHealthNumber?: string;
  emergencyName: string;
  emergencyNumber: string;
}

export function lookupPatient(email: string): Promise<{ patient: { id: string; name: string; email: string } }> {
  return apiFetch(`/api/appointments/lookup-patient?email=${encodeURIComponent(email)}`);
}

export function walkInAppointment(input: {
  serviceId: string;
  day: string;
  timePreference?: string;
  notes?: string;
  patientEmail?: string;
  newPatient?: WalkInNewPatient;
}): Promise<{ appointment: StaffAppointment; tempPassword?: string }> {
  return apiFetch('/api/appointments/walk-in', { method: 'POST', body: input });
}

export interface PatientSummary {
  id: string;
  name: string;
  email: string;
  contactNumber: string;
  householdNumber: string;
  active: boolean;
  createdAt: string;
}

export interface PatientVisit {
  id: string;
  service: { id: string; name: string } | string;
  day: string;
  status: StaffAppointment['status'];
  diagnosis: string;
  prescription: string;
  visitNotes: string;
  createdAt: string;
}

export interface PatientDetail {
  id: string;
  name: string;
  email: string;
  birthdate: string;
  sex: string;
  address: string;
  barangay: string;
  householdNumber: string;
  contactNumber: string;
  philHealthNumber: string;
  emergencyName: string;
  emergencyNumber: string;
  active: boolean;
  createdAt: string;
}

export function listPatients(search = ''): Promise<{ patients: PatientSummary[] }> {
  const qs = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
  return apiFetch(`/api/patients${qs}`);
}

export function getPatient(id: string): Promise<{ patient: PatientDetail; visits: PatientVisit[] }> {
  return apiFetch(`/api/patients/${id}`);
}

export interface VisitsPerServiceRow {
  serviceId: string;
  serviceName: string;
  count: number;
}

export function visitsPerService(days = 30): Promise<{
  from: string;
  to: string;
  days: number;
  total: number;
  rows: VisitsPerServiceRow[];
}> {
  return apiFetch(`/api/reports/visits-per-service?days=${days}`);
}

export function overview(): Promise<{
  today: number;
  pending: number;
  totalPatients: number;
  activeStaff?: number;
}> {
  return apiFetch('/api/reports/overview');
}

export interface StaffAccount {
  id: string;
  name: string;
  email: string;
  role: 'staff' | 'admin';
  active: boolean;
  createdAt: string;
}

export function listStaffAccounts(): Promise<{ accounts: StaffAccount[] }> {
  return apiFetch('/api/staff-accounts');
}

export function createStaffAccount(input: {
  fullName: string;
  email: string;
  password: string;
  role?: 'staff' | 'admin';
}): Promise<{ account: StaffAccount }> {
  return apiFetch('/api/staff-accounts', { method: 'POST', body: input });
}

export function updateStaffAccount(
  id: string,
  input: Partial<{ fullName: string; role: 'staff' | 'admin'; active: boolean; password: string }>,
): Promise<{ account: StaffAccount }> {
  return apiFetch(`/api/staff-accounts/${id}`, { method: 'PATCH', body: input });
}

export interface AuthSettings {
  googleSignInEnabled: boolean;
  /** False when the server has no Google OAuth credentials — the switch then has no effect. */
  googleConfigured: boolean;
  updatedAt: string | null;
}

export interface GoogleIntegrationSettings {
  clientIdMasked: string;
  clientSecretMasked: string;
  source: 'custom' | 'default';
}

export function getGoogleIntegrationSettings(): Promise<{ success: true } & GoogleIntegrationSettings> {
  return apiFetch('/api/admin/settings/google');
}

export function updateGoogleIntegrationSettings(input: {
  clientId?: string;
  clientSecret?: string;
}): Promise<{ success: true } & GoogleIntegrationSettings> {
  return apiFetch('/api/admin/settings/google', { method: 'PUT', body: input });
}

export function resetGoogleIntegrationSettings(): Promise<{ success: true } & GoogleIntegrationSettings> {
  return apiFetch('/api/admin/settings/google', { method: 'DELETE' });
}

/**
 * Public: the login button reads the active client ID at runtime. The client ID
 * is public by design; the secret is never returned by this endpoint.
 */
export async function getGoogleAuthConfig(): Promise<{ clientId: string }> {
  const res = await fetch(`${API_URL}/api/auth/google/config`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Request failed (${res.status}).`);
  return res.json() as Promise<{ clientId: string }>;
}

/**
 * Public, unauthenticated: the login page uses it to hide the Google button
 * while an admin has Google sign-in switched off.
 */
export async function getPublicSettings(): Promise<{ googleSignInEnabled: boolean }> {
  const res = await fetch(`${API_URL}/api/settings/public`);
  if (!res.ok) throw new Error(`Request failed (${res.status}).`);
  return res.json() as Promise<{ googleSignInEnabled: boolean }>;
}

export function getAuthSettings(): Promise<{ settings: AuthSettings }> {
  return apiFetch('/api/settings');
}

export function updateAuthSettings(input: { googleSignInEnabled: boolean }): Promise<{ settings: AuthSettings }> {
  return apiFetch('/api/settings', { method: 'PATCH', body: input });
}

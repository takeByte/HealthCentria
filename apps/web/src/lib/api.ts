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
  createdAt?: string;
  updatedAt?: string;
  updatedByName?: string;
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
  updatedAt?: string;
}

export interface StaffAppointment extends Appointment {
  patient: { id: string; name: string; email: string } | string;
  updatedByName?: string;
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

/** Superadmin PIN header for integration changes. Sent per request, never stored. */
function pinHeader(pin: string): Record<string, string> {
  return { 'X-Super-Pin': pin };
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_URL}/api/health`);
  if (!res.ok) throw new Error(`API responded with ${res.status}`);
  return res.json() as Promise<HealthResponse>;
}

async function apiFetch<T>(
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const token = getSession()?.token;
  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
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

/** Staff/admin: link to the mirrored Google Calendar, only when sync is configured and on. */
export function getCalendarLink(): Promise<{ success: true; available: boolean; url: string }> {
  return apiFetch('/api/appointments/calendar-link');
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
  createdAt?: string;
  updatedAt?: string;
  updatedByName?: string;
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
  updatedAt?: string;
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
  updatedAt?: string;
  updatedByName?: string;
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
  authProvider: 'local' | 'google';
  profileCompleted: boolean;
  avatarUrl: string;
  createdAt: string;
  updatedAt?: string;
  updatedByName?: string;
}

export interface PatientRecordInput {
  fullName?: string;
  birthdate?: string;
  sex?: 'Female' | 'Male' | 'Other' | 'Prefer not to say' | '';
  address?: string;
  barangay?: string;
  householdNumber?: string;
  contactNumber?: string;
  philHealthNumber?: string;
  emergencyName?: string;
  emergencyNumber?: string;
}

export function listPatients(search = ''): Promise<{ patients: PatientSummary[] }> {
  const qs = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
  return apiFetch(`/api/patients${qs}`);
}

export function getPatient(id: string): Promise<{ patient: PatientDetail; visits: PatientVisit[] }> {
  return apiFetch(`/api/patients/${id}`);
}

/** The signed-in patient's own chart. */
export function getMyPatientProfile(): Promise<{ patient: PatientDetail }> {
  return apiFetch('/api/patients/profile');
}

/** Staff/admin corrections to a patient chart. */
/**
 * Admin only, superadmin PIN required. The account is anonymized: personal
 * data and login are removed, upcoming visits cancelled, past visits kept for
 * reports without clinical notes.
 */
export function deletePatientAccount(
  id: string,
  confirmName: string,
  pin: string,
): Promise<{ success: true; cancelled: number; keptVisits: number }> {
  return apiFetch(`/api/patients/${id}/delete`, {
    method: 'POST',
    body: { confirmName },
    headers: pinHeader(pin),
  });
}

export function updatePatientRecord(
  id: string,
  input: PatientRecordInput,
): Promise<{ patient: PatientDetail }> {
  return apiFetch(`/api/patients/${id}`, { method: 'PATCH', body: input });
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

/** Downloads the visits-per-service report as CSV through the authenticated API. */
export interface SheetsExportResult {
  success: true;
  /** Direct link to the new tab. Only people the spreadsheet is shared with can open it. */
  url: string;
  tab: string;
  rows?: number;
}

/** Writes the visits-per-service report to a new tab in the export spreadsheet. */
export function exportVisitsToSheets(days = 30): Promise<SheetsExportResult> {
  return apiFetch(`/api/reports/visits-per-service/sheets?days=${days}`, { method: 'POST' });
}

export async function downloadVisitsCsv(days = 30): Promise<void> {
  const token = getSession()?.token;
  const res = await fetch(`${API_URL}/api/reports/visits-per-service/export?days=${days}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let message = `Export failed (${res.status}).`;
    try {
      const data = (await res.json()) as { message?: string };
      if (data?.message) message = data.message;
    } catch {
      // keep the status-based message
    }
    throw new ApiError(res.status, message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  link.href = url;
  link.download = match?.[1] ?? `healthcentria-visits-${days}-days.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export interface ExportRecipient {
  id: string;
  name: string;
  email: string;
  role: 'staff' | 'admin';
}

export interface ExportRecipientOptions {
  success: true;
  recipients: ExportRecipient[];
  /** SU_EMAIL is set on the server, so the superadmin always gets the link. */
  superadminNotified: boolean;
  driveReady: boolean;
  /** Why Drive can't be used right now ('' when ready). */
  driveMessage: string;
  /** Folder chosen in Admin Settings ('' when Drive isn't ready). */
  driveFolderName: string;
}

/** Active staff and admins that can be picked to receive a PDF's Drive link. */
export function listExportRecipients(): Promise<ExportRecipientOptions> {
  return apiFetch('/api/reports/export-recipients');
}

export interface PdfExportResult {
  fileName: string;
  /** 'off' = the exporter unticked "Upload to Google Drive" (download only). */
  driveStatus: 'uploaded' | 'skipped' | 'failed' | 'off';
  driveLink: string;
  driveMessage: string;
  emailedCount: number;
}

export interface PdfExportOptions {
  /** Staff/admin IDs who get the Drive link by email. Ignored when not uploading. */
  recipients: string[];
  /** False = download only: no Drive upload, no sharing, no emails. */
  uploadToDrive: boolean;
}

/** POSTs, downloads the returned PDF, and reports what happened with Drive and email. */
async function downloadPdf(path: string, { recipients, uploadToDrive }: PdfExportOptions): Promise<PdfExportResult> {
  const token = getSession()?.token;
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ recipients: uploadToDrive ? recipients : [], uploadToDrive }),
  });
  if (!res.ok) {
    let message = `Export failed (${res.status}).`;
    try {
      const data = (await res.json()) as { message?: string };
      if (data?.message) message = data.message;
    } catch {
      // keep the status-based message
    }
    throw new ApiError(res.status, message);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'healthcentria-report.pdf';
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  const status = res.headers.get('X-Drive-Status');
  return {
    fileName,
    driveStatus: status === 'uploaded' || status === 'failed' || status === 'off' ? status : 'skipped',
    driveLink: res.headers.get('X-Drive-Link') ?? '',
    driveMessage: decodeURIComponent(res.headers.get('X-Drive-Message') ?? ''),
    emailedCount: Number(res.headers.get('X-Emailed-Count') ?? 0) || 0,
  };
}

/** Visits-per-service PDF: downloads it and, if chosen, uploads to Drive and emails the link. */
export function exportVisitsPdf(days: number, options: PdfExportOptions): Promise<PdfExportResult> {
  return downloadPdf(`/api/reports/visits-per-service/pdf?days=${days}`, options);
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
  /** Capabilities granted to a staff account. Admins always have all of them. */
  permissions: string[];
  createdAt: string;
  updatedAt?: string;
}

export function listStaffAccounts(): Promise<{ accounts: StaffAccount[] }> {
  return apiFetch('/api/staff-accounts');
}

export function createStaffAccount(input: {
  fullName: string;
  email: string;
  password: string;
  role?: 'staff' | 'admin';
  permissions?: string[];
}): Promise<{ account: StaffAccount }> {
  return apiFetch('/api/staff-accounts', { method: 'POST', body: input });
}

export function updateStaffAccount(
  id: string,
  input: Partial<{
    fullName: string;
    role: 'staff' | 'admin';
    active: boolean;
    permissions: string[];
    password: string;
  }>,
): Promise<{ account: StaffAccount }> {
  return apiFetch(`/api/staff-accounts/${id}`, { method: 'PATCH', body: input });
}

/** The signed-in staff/admin account, as returned by the self-service endpoints. */
export interface MyAccount {
  id: string;
  name: string;
  email: string;
  role: 'staff' | 'admin';
  authProvider: 'local' | 'google';
  permissions: string[];
  avatarUrl?: string;
}

export function updateMyAccount(input: { fullName: string }): Promise<{ user: MyAccount }> {
  return apiFetch('/api/auth/me', { method: 'PATCH', body: input });
}

export function changeMyPassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<{ success: boolean }> {
  return apiFetch('/api/auth/change-password', { method: 'POST', body: input });
}

export interface AuthSettings {
  googleSignInEnabled: boolean;
  recaptchaEnabled: boolean;
  /** Announcement, appointment-update and reminder emails. Security codes ignore it. */
  notificationEmailsEnabled: boolean;
  /** Off blocks new Google Sheets exports; existing tabs stay. */
  googleSheetsEnabled: boolean;
  /** Off stops PDF uploads to Google Drive (and the emailed links). */
  googleDriveEnabled: boolean;
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

export function updateGoogleIntegrationSettings(
  input: {
    clientId?: string;
    clientSecret?: string;
  },
  pin: string,
): Promise<{ success: true } & GoogleIntegrationSettings> {
  return apiFetch('/api/admin/settings/google', { method: 'PUT', body: input, headers: pinHeader(pin) });
}

export function resetGoogleIntegrationSettings(pin: string): Promise<{ success: true } & GoogleIntegrationSettings> {
  return apiFetch('/api/admin/settings/google', { method: 'DELETE', headers: pinHeader(pin) });
}

export interface RecaptchaIntegrationSettings {
  siteKeyMasked: string;
  secretKeyMasked: string;
  source: 'custom' | 'default';
  /** False when neither the database nor .env has both keys. */
  configured: boolean;
}

export function getRecaptchaIntegrationSettings(): Promise<{ success: true } & RecaptchaIntegrationSettings> {
  return apiFetch('/api/admin/settings/recaptcha');
}

export function updateRecaptchaIntegrationSettings(
  input: {
    siteKey?: string;
    secretKey?: string;
    /** A challenge solved with the new site key; the server checks it with the new secret before saving. */
    testToken: string;
  },
  pin: string,
): Promise<{ success: true } & RecaptchaIntegrationSettings> {
  return apiFetch('/api/admin/settings/recaptcha', { method: 'PUT', body: input, headers: pinHeader(pin) });
}

export function resetRecaptchaIntegrationSettings(pin: string): Promise<{ success: true } & RecaptchaIntegrationSettings> {
  return apiFetch('/api/admin/settings/recaptcha', { method: 'DELETE', headers: pinHeader(pin) });
}

export interface EmailIntegrationSettings {
  host: string;
  port: number;
  userMasked: string;
  passwordSet: boolean;
  fromAddress: string;
  source: 'custom' | 'default';
  /** False when neither the database nor .env has usable SMTP values. */
  configured: boolean;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string;
}

export function getEmailIntegrationSettings(): Promise<{ success: true } & EmailIntegrationSettings> {
  return apiFetch('/api/admin/settings/email');
}

export function updateEmailIntegrationSettings(
  input: {
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    fromAddress?: string;
  },
  pin: string,
): Promise<{ success: true } & EmailIntegrationSettings> {
  return apiFetch('/api/admin/settings/email', { method: 'PUT', body: input, headers: pinHeader(pin) });
}

export function resetEmailIntegrationSettings(pin: string): Promise<{ success: true } & EmailIntegrationSettings> {
  return apiFetch('/api/admin/settings/email', { method: 'DELETE', headers: pinHeader(pin) });
}

export function testEmailDelivery(input: { to?: string } = {}): Promise<{
  success: true;
  to: string;
  message: string;
}> {
  return apiFetch('/api/admin/settings/email/test', { method: 'POST', body: input });
}

export interface GoogleCalendarSettings {
  configured: boolean;
  enabled: boolean;
  calendarId: string;
  timezone: string;
  pending: number;
  failed: number;
  synced: number;
  lastSyncedAt: string | null;
  lastError: string;
}

export interface CalendarSyncSummary {
  total: number;
  ok: number;
  failed: number;
  skipped: number;
}

export function getGoogleCalendarSettings(): Promise<{ success: true } & GoogleCalendarSettings> {
  return apiFetch('/api/admin/settings/google-calendar');
}

export function updateGoogleCalendarSettings(
  input: { enabled: boolean },
  pin: string,
): Promise<{ success: true } & GoogleCalendarSettings> {
  return apiFetch('/api/admin/settings/google-calendar', { method: 'PATCH', body: input, headers: pinHeader(pin) });
}

export function testGoogleCalendarConnection(): Promise<{
  success: true;
  calendarId: string;
  timezone: string;
}> {
  return apiFetch('/api/admin/settings/google-calendar/test', { method: 'POST' });
}

export function syncGoogleCalendar(): Promise<{
  success: true;
  retried: CalendarSyncSummary;
  upcoming: CalendarSyncSummary;
  status: GoogleCalendarSettings;
}> {
  return apiFetch('/api/admin/settings/google-calendar/sync', { method: 'POST' });
}

export interface GoogleSheetsSettings {
  /** True when a spreadsheet ID and the service account are both set. */
  configured: boolean;
  spreadsheetId: string;
  spreadsheetUrl: string;
  source: 'custom' | 'default';
  defaultSet: boolean;
  serviceAccountEmail: string;
  serviceAccountConfigured: boolean;
}

export function getGoogleSheetsSettings(): Promise<{ success: true } & GoogleSheetsSettings> {
  return apiFetch('/api/admin/settings/google-sheets');
}

/** Tested (open + add/delete a tab) on the server before it is saved. */
export function updateGoogleSheetsSettings(
  input: { spreadsheetId: string },
  pin: string,
): Promise<{ success: true } & GoogleSheetsSettings> {
  return apiFetch('/api/admin/settings/google-sheets', { method: 'PUT', body: input, headers: pinHeader(pin) });
}

export function resetGoogleSheetsSettings(pin: string): Promise<{ success: true } & GoogleSheetsSettings> {
  return apiFetch('/api/admin/settings/google-sheets', { method: 'DELETE', headers: pinHeader(pin) });
}

export function testGoogleSheetsConnection(): Promise<{ success: true; title: string; url: string }> {
  return apiFetch('/api/admin/settings/google-sheets/test', { method: 'POST' });
}

export interface GoogleDriveSettings {
  /** An OAuth Client ID + secret is set (custom in Settings, or the .env default). */
  clientConfigured: boolean;
  clientIdMasked: string;
  clientSecretMasked: string;
  credentialsSource: 'custom' | 'default';
  connected: boolean;
  /** Google rejected the stored token (e.g. the 7-day limit of a Testing app). */
  needsReconnect: boolean;
  /** Connected before full Drive access was requested: reconnect once to choose a folder. */
  scopeUpgradeNeeded: boolean;
  accountEmail: string;
  connectedAt: string | null;
  folderId: string;
  folderName: string;
  folderUrl: string;
  /** 'custom' = pasted in Settings; 'default' = the .env folder or "HealthCentria Reports". */
  folderSource: 'custom' | 'default';
  lastUploadAt: string | null;
  lastError: string;
  redirectUri: string;
}

export function getGoogleDriveSettings(): Promise<{ success: true } & GoogleDriveSettings> {
  return apiFetch('/api/admin/settings/google-drive');
}

/** Returns Google's consent URL; the page then navigates there. */
export function startGoogleDriveConnect(pin: string): Promise<{ success: true; url: string }> {
  return apiFetch('/api/admin/settings/google-drive/connect', { method: 'POST', headers: pinHeader(pin) });
}

export function disconnectGoogleDrive(pin: string): Promise<{ success: true } & GoogleDriveSettings> {
  return apiFetch('/api/admin/settings/google-drive/connection', { method: 'DELETE', headers: pinHeader(pin) });
}

/** Folder ID or drive.google.com link. The server checks the account can add files there first. */
export function updateGoogleDriveFolder(folder: string, pin: string): Promise<{ success: true } & GoogleDriveSettings> {
  return apiFetch('/api/admin/settings/google-drive/folder', {
    method: 'PUT',
    body: { folder },
    headers: pinHeader(pin),
  });
}

/** Back to the .env folder, or HealthCentria's own "HealthCentria Reports" folder. */
export function resetGoogleDriveFolder(pin: string): Promise<{ success: true } & GoogleDriveSettings> {
  return apiFetch('/api/admin/settings/google-drive/folder', { method: 'DELETE', headers: pinHeader(pin) });
}

export function testGoogleDriveUpload(): Promise<{ success: true; folderName: string; folderUrl: string }> {
  return apiFetch('/api/admin/settings/google-drive/test', { method: 'POST' });
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
export async function getPublicSettings(): Promise<{
  googleSignInEnabled: boolean;
  recaptchaEnabled: boolean;
  /** Public site key; empty when the server has none configured. */
  recaptchaSiteKey: string;
}> {
  const res = await fetch(`${API_URL}/api/settings/public`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Request failed (${res.status}).`);
  return res.json();
}

export function getAuthSettings(): Promise<{ settings: AuthSettings }> {
  return apiFetch('/api/settings');
}

export function updateAuthSettings(
  input: Partial<
    Pick<
      AuthSettings,
      | 'googleSignInEnabled'
      | 'recaptchaEnabled'
      | 'notificationEmailsEnabled'
      | 'googleSheetsEnabled'
      | 'googleDriveEnabled'
    >
  >,
  pin: string,
): Promise<{ settings: AuthSettings }> {
  return apiFetch('/api/settings', { method: 'PATCH', body: input, headers: pinHeader(pin) });
}

/** Records the sign-out server-side before the client drops the token. */
export function logoutRequest(): Promise<{ success: boolean }> {
  return apiFetch('/api/auth/logout', { method: 'POST' });
}

/* ------------------------------------------------------------- activity --- */

export type ActivityCategory =
  | 'auth'
  | 'appointments'
  | 'clinical'
  | 'people'
  | 'content'
  | 'configuration'
  | 'system';

export const ACTIVITY_CATEGORY_LABELS: Record<ActivityCategory, string> = {
  auth: 'Sign-in',
  appointments: 'Appointments',
  clinical: 'Clinical',
  people: 'People',
  content: 'Content',
  configuration: 'Configuration',
  system: 'System',
};

export interface ActivityChange {
  field: string;
  from: string;
  to: string;
}

export interface ActivityEntry {
  id: string;
  action: string;
  category: ActivityCategory;
  actor: { id: string | null; name: string; role: '' | 'patient' | 'staff' | 'admin' };
  target: { type: string; id: string; label: string; role: '' | 'patient' | 'staff' | 'admin' };
  changes: ActivityChange[];
  outcome: 'success' | 'failed';
  ip: string;
  userAgent: string;
  detail: string;
  createdAt: string;
}

export interface ActivityFilters {
  category?: ActivityCategory | 'all';
  action?: string;
  actor?: string;
  targetType?: string;
  targetId?: string;
  outcome?: 'success' | 'failed';
  q?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface ActivityPage {
  entries: ActivityEntry[];
  total: number;
  page: number;
  limit: number;
  pages: number;
  retentionDays: number;
}

function activityQuery(filters: ActivityFilters): string {
  const params = new URLSearchParams();
  if (filters.category && filters.category !== 'all') params.set('category', filters.category);
  if (filters.action) params.set('action', filters.action);
  if (filters.actor) params.set('actor', filters.actor);
  if (filters.targetType) params.set('targetType', filters.targetType);
  if (filters.targetId) params.set('targetId', filters.targetId);
  if (filters.outcome) params.set('outcome', filters.outcome);
  if (filters.q) params.set('q', filters.q);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.limit) params.set('limit', String(filters.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** Admin: the full log. */
export function listActivity(filters: ActivityFilters = {}): Promise<ActivityPage> {
  return apiFetch(`/api/activity${activityQuery(filters)}`);
}

/** Staff: work events plus their own sign-ins. */
export function listMyActivity(filters: ActivityFilters = {}): Promise<ActivityPage> {
  return apiFetch(`/api/activity/mine${activityQuery(filters)}`);
}

/** Patient: only entries about their own record. */
export function listOwnActivity(filters: ActivityFilters = {}): Promise<ActivityPage> {
  return apiFetch(`/api/activity/me${activityQuery(filters)}`);
}

export function activitySummary(): Promise<{
  today: number;
  failedSignIns: number;
  recordsEdited: number;
  stored: number;
}> {
  return apiFetch('/api/activity/summary');
}

export function activityPolicy(): Promise<{
  retentionDays: number;
  cutoff: string;
  oldest: string | null;
}> {
  return apiFetch('/api/activity/policy');
}

export function purgeActivity(): Promise<{
  deleted: number;
  cutoff: string;
  retentionDays: number;
}> {
  return apiFetch('/api/activity/purge', { method: 'POST', body: { confirm: true } });
}

/** Downloads the current filtered view as CSV through the authenticated API. */
/** Admin: activity log PDF for the current filters (max 2,000 rows); optionally uploaded to Drive and emailed. */
export function exportActivityPdf(filters: ActivityFilters, options: PdfExportOptions): Promise<PdfExportResult> {
  return downloadPdf(`/api/activity/export/pdf${activityQuery(filters)}`, options);
}

/** Admin: writes the filtered activity log to a new tab in the export spreadsheet. */
export function exportActivityToSheets(filters: ActivityFilters = {}): Promise<SheetsExportResult> {
  return apiFetch(`/api/activity/export/sheets${activityQuery(filters)}`, { method: 'POST' });
}

export async function downloadActivityCsv(filters: ActivityFilters = {}): Promise<void> {
  const token = getSession()?.token;
  const res = await fetch(`${API_URL}/api/activity/export${activityQuery(filters)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let message = `Export failed (${res.status}).`;
    try {
      const data = (await res.json()) as { message?: string };
      if (data?.message) message = data.message;
    } catch {
      // keep the status-based message
    }
    throw new ApiError(res.status, message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `activity-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:5000';
const SESSION_KEY = 'healthcentria.session';
const PATIENT_REGISTRY_KEY = 'healthcentria.patients';

export const PASSWORD_ERROR_MESSAGE =
  'Password must be at least 8 characters and include at least two of: letters, numbers, special characters.';

export type Role = 'patient' | 'staff' | 'admin';

export interface AuthSession {
  email: string;
  role: Role;
  name?: string;
  authProvider?: 'local' | 'google';
  /** False only for patients who still need to fill in their profile. */
  profileCompleted?: boolean;
  avatarUrl?: string;
  createdAt: string;
  /** JWT from the API. Absent only for pre-backend local fallback sessions. */
  token?: string;
  /** True when no backend auth endpoint exists yet and the session was created locally. */
  localFallback?: boolean;
}

export interface RegisterData {
  fullName: string;
  birthdate: string;
  sex: string;
  address: string;
  householdNumber: string;
  contactNumber: string;
  philHealthNumber: string;
  emergencyName: string;
  emergencyNumber: string;
  email: string;
  password: string;
  confirmPassword: string;
  consent: boolean;
  /** reCAPTCHA v2 token from the widget; verified server-side. */
  captchaToken: string;
}

export class DuplicateEmailError extends Error {
  constructor() {
    super('DUPLICATE_EMAIL');
    this.name = 'DuplicateEmailError';
  }
}

/**
 * A failure the API described in words (CAPTCHA rejected, rate limited, service
 * unavailable). The UI shows this message as-is instead of the generic
 * "invalid credentials" text.
 */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

function apiMessage(data: unknown): string {
  if (data && typeof data === 'object') {
    const message = (data as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return '';
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function isValidPassword(password: string): boolean {
  if ([...password].length < 8) return false;
  const types = [
    /\p{L}/u.test(password),
    /\p{N}/u.test(password),
    /[^\p{L}\p{N}]/u.test(password),
  ];
  return types.filter(Boolean).length >= 2;
}

/** Demo-only role inference for local fallback (backend has no /api/auth yet). */
export function inferLocalRole(email: string): Role {
  const e = email.trim().toLowerCase();
  if (e.startsWith('admin@')) return 'admin';
  if (e.startsWith('staff@')) return 'staff';
  return 'patient';
}

/** Target dashboard per spec §1.2 — unused until those routes exist (see TODO at call sites). */
export function resolveDashboard(role: Role): string {
  if (role === 'admin') return '/admin/dashboard';
  if (role === 'staff') return '/staff/dashboard';
  return '/app/dashboard';
}

/** Patients with an incomplete profile go to the completion form first. */
export function resolvePostAuthPath(session: AuthSession): string {
  if (session.role === 'patient' && session.profileCompleted === false) return '/app/profile/complete';
  return resolveDashboard(session.role);
}

export function needsProfileCompletion(session: AuthSession | null): boolean {
  return Boolean(session && session.role === 'patient' && session.profileCompleted === false);
}

export function getSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as AuthSession) : null;
  } catch {
    return null;
  }
}

export function setSession(session: AuthSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

function readRegistry(): Array<{ email: string }> {
  try {
    const raw = localStorage.getItem(PATIENT_REGISTRY_KEY);
    return raw ? (JSON.parse(raw) as Array<{ email: string }>) : [];
  } catch {
    return [];
  }
}

async function postJson(path: string, body: unknown): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

function sessionFromApi(data: unknown, fallbackEmail: string): AuthSession {
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    const user = (d.user ?? d) as Record<string, unknown>;
    const role =
      user.role === 'admin' || user.role === 'staff' || user.role === 'patient'
        ? user.role
        : inferLocalRole(fallbackEmail);
    const email = typeof user.email === 'string' ? user.email : fallbackEmail;
    const name = typeof user.name === 'string' ? user.name : undefined;
    const token = typeof d.token === 'string' ? d.token : undefined;
    const authProvider = user.authProvider === 'google' ? 'google' : user.authProvider === 'local' ? 'local' : undefined;
    const profileCompleted =
      typeof user.profileCompleted === 'boolean' ? user.profileCompleted : undefined;
    const avatarUrl = typeof user.avatarUrl === 'string' ? user.avatarUrl : undefined;
    return {
      email,
      role,
      name,
      authProvider,
      profileCompleted,
      avatarUrl,
      token,
      createdAt: new Date().toISOString(),
    };
  }
  return {
    email: fallbackEmail,
    role: inferLocalRole(fallbackEmail),
    createdAt: new Date().toISOString(),
  };
}

export async function login(input: {
  email: string;
  password: string;
  captchaToken?: string;
}): Promise<AuthSession> {
  const email = input.email.trim();
  try {
    const { status, data } = await postJson('/api/auth/login', {
      email,
      password: input.password,
      ...(input.captchaToken ? { captchaToken: input.captchaToken } : {}),
    });
    if (status === 200 || status === 201) {
      const session = sessionFromApi(data, email);
      setSession(session);
      return session;
    }
    if (status === 401) {
      // Generic message on purpose — do not reveal whether the email exists.
      throw new Error('INVALID_CREDENTIALS');
    }
    if (status !== 404) {
      // 400 (CAPTCHA / validation), 429 (rate limited) and 503 (verifier or DB
      // down) all explain themselves; show that instead of a generic error.
      throw new AuthError(apiMessage(data) || 'Sign-in failed. Try again.');
    }
    // 404 = this backend has no auth routes yet → local demo fallback below.
  } catch (err) {
    if (err instanceof Error && (err.message === 'INVALID_CREDENTIALS' || err instanceof AuthError)) {
      throw err;
    }
    // Network error or missing /api/auth/* on backend (only /api/health exists) → local demo session.
  }
  const session: AuthSession = {
    email,
    role: inferLocalRole(email),
    createdAt: new Date().toISOString(),
    localFallback: true,
  };
  setSession(session);
  return session;
}

export async function registerPatient(data: RegisterData): Promise<AuthSession> {
  const email = data.email.trim();
  try {
    const { status, data: resData } = await postJson('/api/auth/register', {
      fullName: data.fullName.trim(),
      birthdate: data.birthdate,
      sex: data.sex,
      address: data.address.trim(),
      householdNumber: data.householdNumber.trim(),
      contactNumber: data.contactNumber.trim(),
      philHealthNumber: data.philHealthNumber.trim() || undefined,
      emergencyName: data.emergencyName.trim(),
      emergencyNumber: data.emergencyNumber.trim(),
      email,
      password: data.password,
      consent: data.consent,
      captchaToken: data.captchaToken,
    });
    if (status === 200 || status === 201) {
      const session = sessionFromApi(resData, email);
      setSession(session);
      return session;
    }
    if (status === 409) throw new DuplicateEmailError();
    if (status !== 404) {
      throw new AuthError(apiMessage(resData) || 'Registration failed. Try again.');
    }
    // 404 = backend has no auth routes yet → local fallback below.
  } catch (err) {
    if (err instanceof DuplicateEmailError || err instanceof AuthError) {
      throw err;
    }
    // Network / missing-route → local fallback.
  }
  const registry = readRegistry();
  if (registry.some((r) => r.email.toLowerCase() === email.toLowerCase())) {
    throw new DuplicateEmailError();
  }
  registry.push({ email });
  try {
    localStorage.setItem(PATIENT_REGISTRY_KEY, JSON.stringify(registry));
  } catch {
    // Storage full/blocked — still allow the session so the user isn't trapped.
  }
  const session: AuthSession = {
    email,
    role: 'patient',
    name: data.fullName.trim(),
    createdAt: new Date().toISOString(),
    localFallback: true,
  };
  setSession(session);
  return session;
}

/** Absolute URL that starts the server-side Google consent flow. */
export function googleLoginUrl(clientId?: string): string {
  const url = `${API_URL}/api/auth/google`;
  return clientId ? `${url}?client_id=${encodeURIComponent(clientId)}` : url;
}

/**
 * Full-page redirect to Google — the API handles the callback and returns here.
 * The caller passes the client ID fetched from /api/auth/google/config so the
 * flow always uses the credentials that are active right now.
 */
export function startGoogleLogin(clientId?: string): void {
  window.location.href = googleLoginUrl(clientId);
}

/**
 * Finish a Google sign-in: the API handed us a JWT, exchange it for the user
 * profile and persist a normal session.
 */
export async function completeGoogleLogin(token: string): Promise<AuthSession> {
  const res = await fetch(`${API_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('GOOGLE_LOGIN_FAILED');
  const data = (await res.json()) as {
    user?: {
      email?: string;
      name?: string;
      role?: string;
      authProvider?: string;
      profileCompleted?: boolean;
      avatarUrl?: string;
    };
  };
  const user = data.user ?? {};
  const email = typeof user.email === 'string' ? user.email : '';
  const role: Role =
    user.role === 'admin' || user.role === 'staff' || user.role === 'patient' ? user.role : inferLocalRole(email);
  const session: AuthSession = {
    email,
    role,
    name: typeof user.name === 'string' ? user.name : undefined,
    authProvider: user.authProvider === 'google' ? 'google' : user.authProvider === 'local' ? 'local' : undefined,
    profileCompleted: typeof user.profileCompleted === 'boolean' ? user.profileCompleted : undefined,
    avatarUrl: typeof user.avatarUrl === 'string' ? user.avatarUrl : undefined,
    token,
    createdAt: new Date().toISOString(),
  };
  setSession(session);
  return session;
}

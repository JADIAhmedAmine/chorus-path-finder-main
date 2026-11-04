import { loadChorusConfig, saveChorusConfig } from '@/lib/chorus/storage';

export interface LocalAuthSession {
  email: string;
  firstName: string;
  lastName: string;
  roleCode: string;
  chorusCurrentUserId?: string;
  chorusSupplierId?: string;
  chorusSupplierServiceId?: string;
  chorusBankAccountCode?: string;
  accessToken?: string;
  expiresAt?: string;
  createdAt: string;
}

export const AUTH_SESSION_STORAGE_KEY = 'app.auth.session';

export function getAuthToken(): string | null {
  const session = loadAuthSession();
  if (!session?.accessToken) {
    return null;
  }
  if (session.expiresAt && new Date(session.expiresAt).getTime() < Date.now()) {
    clearAuthSession();
    return null;
  }
  return session.accessToken;
}

export function hasValidAuthSession(): boolean {
  return getAuthToken() !== null;
}

export function canSubmitInvoices(session: LocalAuthSession | null = loadAuthSession()): boolean {
  const roleCode = session?.roleCode?.trim().toUpperCase();
  return roleCode === 'ADMINISTRATEUR' || roleCode === 'GESTIONNAIRE' || roleCode === 'DEPOSANT';
}

export function authHeaders(extra?: HeadersInit): Record<string, string> {
  const headers = new Headers(extra);
  const token = getAuthToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return Object.fromEntries(headers.entries());
}

export function authenticatedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, {
    ...init,
    headers: authHeaders(init?.headers),
  });
}

function trimText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function loadAuthSession(): LocalAuthSession | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as LocalAuthSession;
  } catch {
    return null;
  }
}

export function saveAuthSession(session: LocalAuthSession): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearAuthSession(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
}

export function syncAuthSessionToChorusConfig(session: LocalAuthSession): void {
  const currentConfig = loadChorusConfig();

  const nextConfig = {
    ...currentConfig,
    submissionCurrentUserId: trimText(session.chorusCurrentUserId) ?? currentConfig.submissionCurrentUserId,
    submissionSupplierId: trimText(session.chorusSupplierId) ?? currentConfig.submissionSupplierId,
    submissionSupplierServiceId: trimText(session.chorusSupplierServiceId) ?? currentConfig.submissionSupplierServiceId,
    submissionBankAccountCode: trimText(session.chorusBankAccountCode) ?? currentConfig.submissionBankAccountCode,
  };

  saveChorusConfig(nextConfig);
}

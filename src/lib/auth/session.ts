import { FIXED_CHORUS_SUPPLIER_ID_TEXT } from '@/lib/chorus/constants';
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
  createdAt: string;
}

export const AUTH_SESSION_STORAGE_KEY = 'app.auth.session';

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
    submissionSupplierId: FIXED_CHORUS_SUPPLIER_ID_TEXT,
    submissionSupplierServiceId: trimText(session.chorusSupplierServiceId) ?? currentConfig.submissionSupplierServiceId,
    submissionBankAccountCode: trimText(session.chorusBankAccountCode) ?? currentConfig.submissionBankAccountCode,
  };

  saveChorusConfig(nextConfig);
}

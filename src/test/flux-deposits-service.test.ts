import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FLUX_DEPOSITS_AUTH_ERROR,
  fetchFluxDepositsStats,
} from '@/lib/flux/fluxDepositsService';
import {
  AUTH_SESSION_STORAGE_KEY,
  type LocalAuthSession,
} from '@/lib/auth/session';
import type { ChorusConfig } from '@/types/chorus';

const config = {
  submissionBridgeUrl: '',
  environment: 'qualif',
} as ChorusConfig;

function saveSession(accessToken: string): void {
  const session: LocalAuthSession = {
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    roleCode: 'GESTIONNAIRE',
    accessToken,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    createdAt: new Date().toISOString(),
  };
  window.localStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(session));
}

describe('fluxDepositsService authentication', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('sends the application JWT as a Bearer token', async () => {
    saveSession('jwt-test-token');
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        available: true,
        stats: { total: 1 },
      }), { status: 200 }),
    );

    await fetchFluxDepositsStats(config, {}, fetchMock);

    const requestInit = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(requestInit?.headers);
    expect(headers.get('Authorization')).toBe('Bearer jwt-test-token');
  });

  it('returns a clear error when the session token is absent', async () => {
    const fetchMock = vi.fn<typeof fetch>();

    await expect(fetchFluxDepositsStats(config, {}, fetchMock))
      .rejects.toThrow(FLUX_DEPOSITS_AUTH_ERROR);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps backend 401 responses to the session error', async () => {
    saveSession('expired-server-side-token');
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Token manquant.' }), { status: 401 }),
    );

    await expect(fetchFluxDepositsStats(config, {}, fetchMock))
      .rejects.toThrow(FLUX_DEPOSITS_AUTH_ERROR);
  });
});

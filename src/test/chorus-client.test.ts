import { describe, expect, it, vi } from 'vitest';
import { createChorusConnector, DirectChorusConnector } from '@/lib/chorus/client';
import { getDefaultChorusConfig } from '@/lib/chorus/storage';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

describe('chorus connector', () => {
  it('retrieves an oauth token and calls the connection endpoint with cpro-account', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-123456789' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'ok' }));

    const connector = new DirectChorusConnector({
      ...getDefaultChorusConfig(),
      mode: 'direct',
      enabled: true,
      tokenUrl: 'https://sandbox-oauth.aife.economie.gouv.fr/api/oauth/token',
      apiBaseUrl: 'https://sandbox-api.example.test',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      technicalLogin: 'tech-user',
      technicalPassword: 'tech-pass',
      connectionTestPath: '/health',
      connectionTestMethod: 'GET',
    }, fetchMock);

    const result = await connector.testConnection();

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const tokenCall = fetchMock.mock.calls[0];
    expect(tokenCall?.[0]).toBe('https://sandbox-oauth.aife.economie.gouv.fr/api/oauth/token');
    expect((tokenCall?.[1] as RequestInit).method).toBe('POST');
    expect(String((tokenCall?.[1] as RequestInit).body)).toContain('grant_type=client_credentials');
    expect(String((tokenCall?.[1] as RequestInit).body)).toContain('client_id=client-id');

    const apiCall = fetchMock.mock.calls[1];
    expect(apiCall?.[0]).toBe('https://sandbox-api.example.test/health');
    const headers = (apiCall?.[1] as RequestInit).headers as Record<string, string>;
    expect((apiCall?.[1] as RequestInit).method).toBe('GET');
    expect(headers.Authorization).toBe('Bearer token-123456789');
    expect(headers['cpro-account']).toBe(window.btoa('tech-user:tech-pass'));
  });

  it('uses POST for the connection test when configured', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-post-123456789' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'ok' }));

    const connector = new DirectChorusConnector({
      ...getDefaultChorusConfig(),
      mode: 'direct',
      enabled: true,
      tokenUrl: 'https://sandbox-oauth.aife.economie.gouv.fr/api/oauth/token',
      apiBaseUrl: 'https://sandbox-api.example.test',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      technicalLogin: 'tech-user',
      technicalPassword: 'tech-pass',
      connectionTestPath: '/v1/rechercher/fournisseur',
      connectionTestMethod: 'POST',
    }, fetchMock);

    const result = await connector.testConnection();

    expect(result.ok).toBe(true);
    const apiCall = fetchMock.mock.calls[1];
    expect((apiCall?.[1] as RequestInit).method).toBe('POST');
    expect((apiCall?.[1] as RequestInit).body).toBe('{}');
    const headers = (apiCall?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
  });

  it('uploads files then submits an invoice payload', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-upload-1' }))
      .mockResolvedValueOnce(jsonResponse({ fileId: 'main-file-id' }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-upload-2' }))
      .mockResolvedValueOnce(jsonResponse({ fileId: 'attachment-id' }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-submit' }))
      .mockResolvedValueOnce(jsonResponse({ invoiceId: 'CHORUS-INV-001' }));

    const connector = new DirectChorusConnector({
      ...getDefaultChorusConfig(),
      mode: 'direct',
      enabled: true,
      tokenUrl: 'https://oauth.example.test/token',
      apiBaseUrl: 'https://api.example.test',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      uploadFilePath: '/files/upload',
      submitInvoicePath: '/factures/soumettre',
    }, fetchMock);

    const result = await connector.submitInvoice({
      invoiceData: {
        supplierInvoiceNumber: 'FAC-2026-001',
        publicCustomerId: 'customer-1',
      },
      mainFile: new File(['main'], 'invoice.pdf', { type: 'application/pdf' }),
      attachments: [new File(['att'], 'attachment.xml', { type: 'text/xml' })],
    });

    expect(result.ok).toBe(true);
    expect(result.externalId).toBe('CHORUS-INV-001');
    expect(fetchMock).toHaveBeenCalledTimes(6);

    const uploadCall = fetchMock.mock.calls[1];
    expect(uploadCall?.[0]).toBe('https://api.example.test/files/upload');
    expect((uploadCall?.[1] as RequestInit).body).toBeInstanceOf(FormData);

    const submitCall = fetchMock.mock.calls[5];
    expect(submitCall?.[0]).toBe('https://api.example.test/factures/soumettre');
    const submitPayload = JSON.parse(String((submitCall?.[1] as RequestInit).body));
    expect(submitPayload.mainFileId).toBe('main-file-id');
    expect(submitPayload.attachmentIds).toEqual(['attachment-id']);
    expect(submitPayload.supplierInvoiceNumber).toBe('FAC-2026-001');
  });

  it('uses mock mode when direct mode is not requested', async () => {
    const connector = createChorusConnector({
      ...getDefaultChorusConfig(),
      mode: 'mock',
      enabled: false,
    });
    const result = await connector.testConnection();

    expect(result.ok).toBe(true);
    expect(result.message).toContain('mock');
  });
});

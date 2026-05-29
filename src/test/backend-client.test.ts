import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackendDataClient, loadBackendDataApiConfig } from '@/data/backend-client';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('loadBackendDataApiConfig', () => {
  it('defaults to local test data files when no data backend is configured', () => {
    const config = loadBackendDataApiConfig();

    expect(config.baseUrl).toBe('');
    expect(config.invoicesPath).toBe('/test-data/invoices.json');
    expect(config.invoiceLinesPath).toBe('/test-data/invoice-lines.json');
    expect(config.extractionResultsPath).toBe('/test-data/invoice-extraction-results.json');
  });

  it('keeps the API-style defaults when a data backend is configured', () => {
    vi.stubEnv('VITE_DATA_API_BASE_URL', 'https://backend.example.test/api');

    const config = loadBackendDataApiConfig();

    expect(config.baseUrl).toBe('https://backend.example.test/api');
    expect(config.invoicesPath).toBe('/invoices');
    expect(config.invoiceAttachmentsPath).toBe('/invoice-attachments');
  });
});

describe('BackendDataClient', () => {
  it('keeps Chorus invoice raw payload fields needed by rejection handling', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      invoices: [
        {
          id: 'chorus-123',
          tenantId: 'tenant',
          supplierOrganizationId: 'supplier',
          sourceFormat: 'PDF',
          supplierInvoiceNumber: 'FAC-123',
          invoiceDate: '2026-05-22',
          totalHt: 100,
          totalVat: 20,
          totalTtc: 120,
          statusInternal: 'REJECTED_BUSINESS',
          statusChorus: 'REJETEE',
          rejectionProcessed: false,
          rawPayload: {
            idDemandePaiement: 987654,
            motifRejet: 'ERR_DEST',
          },
          createdAt: '2026-05-22T10:00:00.000Z',
          updatedAt: '2026-05-22T10:00:00.000Z',
        },
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch;

    const client = new BackendDataClient({
      ...loadBackendDataApiConfig(),
      baseUrl: '',
      invoicesPath: '/invoices',
    }, fetchImpl);

    const [invoice] = await client.fetchInvoices();

    expect(invoice.rejectionProcessed).toBe(false);
    expect(invoice.rawPayload).toEqual({
      idDemandePaiement: 987654,
      motifRejet: 'ERR_DEST',
    });
  });
});

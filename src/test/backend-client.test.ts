import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadBackendDataApiConfig } from '@/data/backend-client';

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

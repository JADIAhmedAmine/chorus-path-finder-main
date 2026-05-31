import { describe, it, expect } from 'vitest';
import { mapMetadata } from '@/lib/chorus/fluxDetection';

describe('mapMetadata', () => {
  it('returns null for non-object input', () => {
    expect(mapMetadata(null)).toBeNull();
    expect(mapMetadata('nope')).toBeNull();
  });

  it('maps a Factur-X PDF metadata payload (snake_case → camelCase)', () => {
    const meta = mapMetadata({
      document: {
        filename: 'invoice.pdf',
        extension: '.pdf',
        size_bytes: 182000,
        kind: 'pdf',
        pdf_version: '1.7',
        page_count: 2,
        pdf_a: 'PDF/A-3B',
        producer: 'iText 7',
        created: '2026-05-26',
        attachments: [{ name: 'factur-x.xml', size_bytes: 1382 }],
      },
      xml: {
        source: 'embedded',
        filename: 'factur-x.xml',
        root_element: 'CrossIndustryInvoice',
        namespace: 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
        encoding: 'UTF-8',
      },
      invoice: {
        invoice_number: 'CII-2026-7',
        issue_date: '2026-05-26',
        currency: 'EUR',
        seller_name: 'ACME',
        seller_id: '12345678900012',
        total_ht: 200,
        total_tva: 40,
        total_ttc: 240,
      },
    });

    expect(meta?.document).toMatchObject({
      filename: 'invoice.pdf',
      kind: 'pdf',
      pdfVersion: '1.7',
      pageCount: 2,
      pdfA: 'PDF/A-3B',
      producer: 'iText 7',
    });
    expect(meta?.document.attachments).toEqual([{ name: 'factur-x.xml', sizeBytes: 1382 }]);
    expect(meta?.xml).toMatchObject({ source: 'embedded', rootElement: 'CrossIndustryInvoice' });
    expect(meta?.invoice).toMatchObject({ invoiceNumber: 'CII-2026-7', totalTtc: 240, currency: 'EUR' });
  });

  it('keeps xml and invoice null when absent, and defaults attachments to []', () => {
    const meta = mapMetadata({ document: { filename: 'scan.pdf', kind: 'pdf' }, xml: null, invoice: null });
    expect(meta?.xml).toBeNull();
    expect(meta?.invoice).toBeNull();
    expect(meta?.document.attachments).toEqual([]);
    expect(meta?.document.pageCount).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { extractInvoiceData } from '@/lib/chorus/extraction';
import { publicCustomers, publicServices, suppliers } from '@/data/mock-data';

describe('chorus extraction', () => {
  it('extracts and resolves invoice metadata from a text-based pdf payload', async () => {
    const file = new File([`
      Facture numéro : FAC-2026-001
      Date facture : 15/04/2026
      Fournisseur SIRET : 12345678901234
      Client public SIRET : 13001803200011
      Code service : SE003
      Numéro d'engagement : ENG-2026-42
      Numéro de marché : MA-2026-10
      Bon de commande : BC-2026-55
      Total HT : 12 000,00 EUR
      Total TTC : 14 400,00 EUR
    `], 'invoice.pdf', { type: 'application/pdf' });

    const result = await extractInvoiceData(file, {
      suppliers,
      publicCustomers,
      publicServices,
    });

    expect(result.sourceFormat).toBe('PDF');
    expect(result.fields.supplierInvoiceNumber).toBe('FAC-2026-001');
    expect(result.fields.invoiceDate).toBe('2026-04-15');
    expect(result.fields.supplierOrganizationId).toBe('s1');
    expect(result.fields.publicCustomerId).toBe('pc2');
    expect(result.fields.publicServiceId).toBe('ps3');
    expect(result.fields.engagementNumber).toBe('ENG-2026-42');
    expect(result.fields.marketNumber).toBe('MA-2026-10');
    expect(result.fields.purchaseOrderNumber).toBe('BC-2026-55');
    expect(result.fields.currencyCode).toBe('EUR');
    expect(result.fields.totalAmountHt).toBe(12000);
    expect(result.fields.totalAmountTtc).toBe(14400);
    expect(result.requiresReview).toBe(false);
  }, 10000);

  it('extracts common fields from xml payloads', async () => {
    const file = new File([`
      <Invoice>
        <InvoiceNumber>FAC-XML-2026-01</InvoiceNumber>
        <InvoiceDate>2026-04-15</InvoiceDate>
        <Currency>EUR</Currency>
        <SupplierSiret>98765432109876</SupplierSiret>
        <RecipientSiret>23750007900013</RecipientSiret>
        <ServiceCode>SE004</ServiceCode>
        <EngagementNumber>ENG-XML-01</EngagementNumber>
        <PurchaseOrderNumber>BC-XML-99</PurchaseOrderNumber>
        <TotalHT>42000.00</TotalHT>
        <TotalTTC>50400.00</TotalTTC>
      </Invoice>
    `], 'invoice.xml', { type: 'text/xml' });

    const result = await extractInvoiceData(file, {
      suppliers,
      publicCustomers,
      publicServices,
    });

    expect(result.sourceFormat).toBe('XML');
    expect(result.fields.supplierInvoiceNumber).toBe('FAC-XML-2026-01');
    expect(result.fields.invoiceDate).toBe('2026-04-15');
    expect(result.fields.currencyCode).toBe('EUR');
    expect(result.fields.supplierOrganizationId).toBe('s2');
    expect(result.fields.publicCustomerId).toBe('pc3');
    expect(result.fields.publicServiceId).toBe('ps4');
    expect(result.fields.engagementNumber).toBe('ENG-XML-01');
    expect(result.fields.purchaseOrderNumber).toBe('BC-XML-99');
    expect(result.fields.totalAmountHt).toBe(42000);
    expect(result.fields.totalAmountTtc).toBe(50400);
  }, 10000);
});

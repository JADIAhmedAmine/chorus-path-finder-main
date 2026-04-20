import { describe, expect, it } from 'vitest';
import { extractInvoiceData } from '@/lib/chorus/extraction';
import { publicCustomersFixture, publicServicesFixture, suppliersFixture } from '@/test/fixtures/reference-data';

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
      suppliers: suppliersFixture,
      publicCustomers: publicCustomersFixture,
      publicServices: publicServicesFixture,
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
      suppliers: suppliersFixture,
      publicCustomers: publicCustomersFixture,
      publicServices: publicServicesFixture,
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

  it('does not infer a currency from noisy pdf text without explicit context', async () => {
    const file = new File([`
      %PDF-1.7
      obj 14 0
      stream
      xxfhA9 CHFNoiseToken not a real currency field
      random binary like payload 0101010101
      Total TTC : 244242
      endstream
    `], 'noisy-invoice.pdf', { type: 'application/pdf' });

    const result = await extractInvoiceData(file, {
      suppliers: suppliersFixture,
      publicCustomers: publicCustomersFixture,
      publicServices: publicServicesFixture,
    });

    expect(result.fields.currencyCode).toBeUndefined();
    expect(result.warnings).toContain('Devise non détectée automatiquement.');
    expect(result.requiresReview).toBe(true);
  }, 10000);

  it('parses amounts with apostrophe separators and explicit currency', async () => {
    const file = new File([`
      Facture numéro : FAC-CHF-2026-01
      Date facture : 15/04/2026
      Devise : CHF
      Total TTC : 244'242.00 CHF
    `], 'invoice-chf.pdf', { type: 'application/pdf' });

    const result = await extractInvoiceData(file, {
      suppliers: suppliersFixture,
      publicCustomers: publicCustomersFixture,
      publicServices: publicServicesFixture,
    });

    expect(result.fields.currencyCode).toBe('CHF');
    expect(result.fields.totalAmountTtc).toBe(244242);
  }, 10000);

  it('extracts the key metadata from the Gigalis invoice layout', async () => {
    const file = new File([`
      gigalis
      ID CLIENT N° : 1903
      Facture N° : 2026-003-00565 Le 16/03/2026
      DÉLAI DE RÉGLEMENT Jusqu'au 15/04/2026

      GIP Gigalis
      Hôtel de la Région - 1, rue de la Loire
      44966 NANTES CEDEX 09
      Tel : 02 28 20 06 70
      Courriel : bp-adv@gigalis.fr

      Siret : 254 402 530 00011
      N° TVA fournisseur : FR59254402530
      TVA acquittée sur les débits.

      REGION DES PAYS DE LA LOIRE - SI EPLE
      Comptabilité fournisseurs
      1 RUE DE LA LOIRE
      44966 NANTES CEDEX
      Siret : 234 400 034 00026
      Numéro d'engagement : BC2025/25-007915

      Facture N° 2026-003-00565 du 16/03/2026
      Montant en €
      Total HT 45 903,52
      TVA 20% 9 180,70
      Total TTC 55 084,22
    `], 'gigalis-invoice.pdf', { type: 'application/pdf' });

    const result = await extractInvoiceData(file, {
      suppliers: suppliersFixture,
      publicCustomers: publicCustomersFixture,
      publicServices: publicServicesFixture,
    });

    expect(result.sourceFormat).toBe('PDF');
    expect(result.fields.supplierName).toBe('GIP Gigalis');
    expect(result.fields.supplierInvoiceNumber).toBe('2026-003-00565');
    expect(result.fields.customerReference).toBe('1903');
    expect(result.fields.invoiceDate).toBe('2026-03-16');
    expect(result.fields.dueDate).toBe('2026-04-15');
    expect(result.fields.supplierSiret).toBe('25440253000011');
    expect(result.fields.supplierVatNumber).toBe('FR59254402530');
    expect(result.fields.publicCustomerName).toBe('REGION DES PAYS DE LA LOIRE - SI EPLE');
    expect(result.fields.publicCustomerSiret).toBe('23440003400026');
    expect(result.fields.publicServiceLabel).toBe('Comptabilité fournisseurs');
    expect(result.fields.engagementNumber).toBe('BC2025/25-007915');
    expect(result.fields.currencyCode).toBe('EUR');
    expect(result.fields.totalAmountHt).toBe(45903.52);
    expect(result.fields.totalVat).toBe(9180.7);
    expect(result.fields.totalAmountTtc).toBe(55084.22);
    expect(result.warnings).toContain('Destinataire extrait mais non rapproché des références locales.');
    expect(result.warnings).toContain('Service destinataire extrait mais non rapproché des références locales.');
  }, 10000);
});

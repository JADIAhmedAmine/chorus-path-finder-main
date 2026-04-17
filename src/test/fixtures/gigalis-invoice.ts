import type { LocalInvoiceExtractionResult } from '@/lib/chorus/types';

export const gigalisInvoiceText = `
GIP Gigalis
Hotel de la Region - 1, rue de la Loire
44966 NANTES CEDEX 09
Siret : 254 402 530 00011
N° TVA fournisseur : FR59254402530

ID CLIENT
N° : 1903
Facture N° : 2026-003-00565
Le 16/03/2026
Jusqu'au 15/04/2026

REGION DES PAYS DE LA LOIRE - SI EPLE
Comptabilite fournisseurs
Siret : 234 400 034 00026
Numero d'engagement : BC2025/25-007915

Total HT 45 903,52
TVA 20% 9 180,70
Total TTC 55 084,22
`;

export const gigalisExtractionResult: LocalInvoiceExtractionResult = {
  sourceFormat: 'PDF',
  confidence: 0.93,
  requiresReview: false,
  warnings: [],
  rawText: gigalisInvoiceText,
  rawTextPreview: gigalisInvoiceText.slice(0, 240),
  fields: {
    supplierName: 'GIP Gigalis',
    supplierInvoiceNumber: '2026-003-00565',
    supplierSiret: '25440253000011',
    supplierVatNumber: 'FR59254402530',
    publicCustomerName: 'REGION DES PAYS DE LA LOIRE - SI EPLE',
    publicCustomerSiret: '23440003400026',
    publicCustomerCode: '23440003400026',
    publicServiceLabel: 'Comptabilite fournisseurs',
    engagementNumber: 'BC2025/25-007915',
    customerReference: '1903',
    invoiceDate: '2026-03-16',
    dueDate: '2026-04-15',
    currencyCode: 'EUR',
    totalAmountHt: 45903.52,
    totalVat: 9180.70,
    totalAmountTtc: 55084.22,
  },
};

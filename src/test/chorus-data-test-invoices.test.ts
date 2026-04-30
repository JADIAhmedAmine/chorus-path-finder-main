import { readdir, readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildUploadPdfPayload, validateUploadPdfPayload } from '@/lib/chorus/buildUploadPdfPayload';
import { buildInvoiceSubmissionPayload } from '@/lib/chorus/mappers';
import { createEmptyInvoiceDraft, mergeExtractionIntoDraft } from '@/lib/chorus/normalization';
import { prepareInvoiceSubmission } from '@/lib/chorus/preparation';
import { extractInvoiceData } from '@/lib/chorus/extraction';
import { validateChorusSubmissionPayload } from '@/lib/chorus/validateSubmissionPayload';
import { publicServicesFixture, suppliersFixture } from '@/test/fixtures/reference-data';

interface DataTestInvoiceExpectation {
  fileName: string;
  supplierInvoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  supplierSiret: string;
  publicCustomerCode: string;
  paymentMode: 'CHEQUE' | 'PRELEVEMENT' | 'VIREMENT';
  totalAmountHt: number;
  totalVat: number;
  totalAmountTtc: number;
}

const DATA_TEST_DIR = join(process.cwd(), 'src/test/data_test');
const REAL_DATA_TEST_PDF_PATTERN = /^facture_test_\d{2}_\d+\.pdf$/;
const CHORUS_SUPPLIER_ID = 26359578;
const CHORUS_CURRENT_USER_ID = 331;

const REPRESENTATIVE_REAL_INVOICES: DataTestInvoiceExpectation[] = [
  {
    fileName: 'facture_test_01_00000000380342.pdf',
    supplierInvoiceNumber: 'TEST-2025-00001',
    invoiceDate: '2025-01-23',
    dueDate: '2025-02-22',
    supplierSiret: '25440253000011',
    publicCustomerCode: '00000000380342',
    paymentMode: 'CHEQUE',
    totalAmountHt: 517,
    totalVat: 103.4,
    totalAmountTtc: 620.4,
  },
  {
    fileName: 'facture_test_11_00000000137412.pdf',
    supplierInvoiceNumber: 'TEST-2025-00011',
    invoiceDate: '2025-01-23',
    dueDate: '2025-02-22',
    supplierSiret: '25440253000011',
    publicCustomerCode: '00000000137412',
    paymentMode: 'CHEQUE',
    totalAmountHt: 887,
    totalVat: 177.4,
    totalAmountTtc: 1064.4,
  },
  {
    fileName: 'facture_test_19_00000000136694.pdf',
    supplierInvoiceNumber: 'TEST-2025-00019',
    invoiceDate: '2025-01-23',
    dueDate: '2025-02-22',
    supplierSiret: '25440253000011',
    publicCustomerCode: '00000000136694',
    paymentMode: 'CHEQUE',
    totalAmountHt: 1183,
    totalVat: 236.6,
    totalAmountTtc: 1419.6,
  },
];

async function listRealDataTestPdfNames(): Promise<string[]> {
  const fileNames = await readdir(DATA_TEST_DIR);
  return fileNames
    .filter((fileName) => REAL_DATA_TEST_PDF_PATTERN.test(fileName))
    .sort();
}

async function readDataTestInvoice(fileName: string): Promise<Buffer> {
  return readFile(join(DATA_TEST_DIR, fileName));
}

function expectNoValidationErrors(errors: { message: string }[]) {
  expect(errors.map((error) => error.message)).toEqual([]);
}

describe('data_test invoice samples', () => {
  it('keeps the real PDF invoice corpus available and uploadable as Chorus attachments', async () => {
    const pdfFileNames = await listRealDataTestPdfNames();

    expect(pdfFileNames).toHaveLength(19);
    expect(pdfFileNames).toEqual(expect.arrayContaining(
      REPRESENTATIVE_REAL_INVOICES.map((invoice) => invoice.fileName),
    ));

    for (const fileName of pdfFileNames) {
      const buffer = await readDataTestInvoice(fileName);
      const uploadPayload = buildUploadPdfPayload(buffer.toString('base64'), fileName, 'application/pdf');
      const uploadValidation = validateUploadPdfPayload(uploadPayload);

      expect(buffer.length).toBeGreaterThan(7000);
      expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
      expect(uploadValidation.errors).toEqual([]);
      expect(uploadPayload.pieceJointeNom).toBe(fileName);
      expect(uploadPayload.pieceJointeExtension).toBe('pdf');
      expect(uploadPayload.pieceJointeTypeMime).toBe('application/pdf');
    }
  });

  it.each(REPRESENTATIVE_REAL_INVOICES)('extracts stable core fields from $fileName', async (invoice) => {
    const buffer = await readDataTestInvoice(invoice.fileName);
    const file = new File([buffer], invoice.fileName, { type: 'application/pdf' });

    const extraction = await extractInvoiceData(file, {
      suppliers: suppliersFixture,
      publicCustomers: [],
      publicServices: [],
    });

    expect(extraction.sourceFormat).toBe('PDF');
    expect(extraction.rawText).toContain('GIP Gigalis');
    expect(extraction.fields.supplierInvoiceNumber).toBe(invoice.supplierInvoiceNumber);
    expect(extraction.fields.invoiceDate).toBe(invoice.invoiceDate);
    expect(extraction.fields.dueDate).toBe(invoice.dueDate);
    expect(extraction.fields.supplierSiret).toBe(invoice.supplierSiret);
    expect(extraction.fields.publicCustomerCode).toBe(invoice.publicCustomerCode);
    expect(extraction.fields.paymentMode).toBe(invoice.paymentMode);
    expect(extraction.fields.currencyCode).toBe('EUR');
    expect(extraction.fields.totalAmountHt).toBe(invoice.totalAmountHt);
    expect(extraction.fields.totalVat).toBe(invoice.totalVat);
    expect(extraction.fields.totalAmountTtc).toBe(invoice.totalAmountTtc);

    const draft = mergeExtractionIntoDraft(createEmptyInvoiceDraft(), extraction);
    const preparation = prepareInvoiceSubmission({
      formData: draft,
      extraction,
    });

    expect(preparation.readiness).toBe('ready');
    expectNoValidationErrors(preparation.validation.errors);
    expect(preparation.normalized.publicCustomerCode).toBe(invoice.publicCustomerCode);
    expect(preparation.normalized.supplierSiret).toBe(invoice.supplierSiret);
  }, 15000);

  it('maps multiple VAT rates to Chorus VAT lines and totals', () => {
    const draft = {
      ...createEmptyInvoiceDraft(),
      supplierOrganizationId: 's1',
      supplierInvoiceNumber: 'FAC-MULTI-TVA-2026',
      publicCustomerId: 'pc2',
      publicCustomerCode: '99002',
      publicServiceId: 'ps3',
      publicServiceCode: 'SE003',
      invoiceDate: '2026-05-05',
      currencyCode: 'EUR',
      paymentMode: 'VIREMENT' as const,
      totalAmountHt: '350,00',
      totalAmountTtc: '400,50',
      totalVat: 50.5,
      lineItems: [
        {
          description: 'Livre TVA 5.5',
          reference: 'L-55',
          quantity: 1,
          unit: 'UNITE',
          unitPriceHt: 100,
          totalHt: 100,
          vatRate: 5.5,
        },
        {
          description: 'Repas TVA 10',
          reference: 'L-10',
          quantity: 1,
          unit: 'UNITE',
          unitPriceHt: 50,
          totalHt: 50,
          vatRate: 10,
        },
        {
          description: 'Service TVA 20',
          reference: 'L-20',
          quantity: 2,
          unit: 'UNITE',
          unitPriceHt: 100,
          totalHt: 200,
          vatRate: 20,
        },
      ],
      vatLines: [
        { rate: 5.5, baseHt: 100, taxAmount: 5.5 },
        { rate: 10, baseHt: 50, taxAmount: 5 },
        { rate: 20, baseHt: 200, taxAmount: 40 },
      ],
    };

    const supplier = suppliersFixture.find((item) => item.id === draft.supplierOrganizationId);
    const publicService = publicServicesFixture.find((item) => item.id === draft.publicServiceId);
    const availableServices = publicServicesFixture.filter((item) => item.publicCustomerId === draft.publicCustomerId);

    const payload = buildInvoiceSubmissionPayload(draft, {
      supplier,
      publicService,
      availableServices,
      chorus: {
        idFournisseur: CHORUS_SUPPLIER_ID,
        idUtilisateurCourant: CHORUS_CURRENT_USER_ID,
        codeCadreFacturation: 'A1_FACTURE_FOURNISSEUR',
      },
    });
    const validation = validateChorusSubmissionPayload(payload);

    expectNoValidationErrors(validation.errors);
    expect(payload.lignePoste.map((line) => line.lignePosteTauxTva)).toEqual(['TV8', 'TV10', 'TV12']);
    expect(payload.ligneTva).toEqual([
      expect.objectContaining({
        ligneTvaTaux: 'TV8',
        ligneTvaMontantBaseHtParTaux: 100,
        ligneTvaMontantTvaParTaux: 5.5,
      }),
      expect.objectContaining({
        ligneTvaTaux: 'TV10',
        ligneTvaMontantBaseHtParTaux: 50,
        ligneTvaMontantTvaParTaux: 5,
      }),
      expect.objectContaining({
        ligneTvaTaux: 'TV12',
        ligneTvaMontantBaseHtParTaux: 200,
        ligneTvaMontantTvaParTaux: 40,
      }),
    ]);
    expect(payload.references.typeTva).toBe('TVA_SUR_DEBIT');
    expect(payload.fournisseur.idFournisseur).toBe(CHORUS_SUPPLIER_ID);
    expect(payload.idUtilisateurCourant).toBe(CHORUS_CURRENT_USER_ID);
    expect(payload.montantTotal.montantHtTotal).toBe(350);
    expect(payload.montantTotal.montantTVA).toBe(50.5);
    expect(payload.montantTotal.montantTtcTotal).toBe(400.5);
  });
});

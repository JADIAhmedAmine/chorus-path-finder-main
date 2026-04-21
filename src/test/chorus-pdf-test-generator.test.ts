/**
 * Test Payload Generator for Chorus PDF Upload and Invoice Submission
 * 
 * This test file demonstrates how to generate test payloads for:
 * 1. Main attachment upload to Chorus /ajouter/fichier endpoint
 * 2. Invoice submission with uploaded pieceJointePrincipale in SAISIE_API mode
 * 3. Invoice submission without PDF (SAISIE_API mode)
 */

import { describe, it, expect } from 'vitest';
import { buildUploadPdfPayload, validateUploadPdfPayload, createMockUploadPdfPayload } from '@/lib/chorus/buildUploadPdfPayload';
import { buildChorusSubmissionPayload } from '@/lib/chorus/buildSubmissionPayload';
import { finalizeChorusSubmissionPayloadForPdfDeposit } from '@/lib/chorus/buildSubmissionPayload';
import { validateChorusSubmissionPayload } from '@/lib/chorus/validateSubmissionPayload';
import { createEmptyInvoiceDraft } from '@/lib/chorus/normalization';

describe('Chorus PDF Test Payload Generation', () => {
  /**
   * Test 1: Generate an upload PDF payload
   */
  it('generates a valid upload PDF payload', () => {
    const mockPdfBase64 = createMockUploadPdfPayload('facture-test-2026-001.pdf');
    const validation = validateUploadPdfPayload(mockPdfBase64);

    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
    expect(mockPdfBase64.pieceJointeNom).toBe('facture-test-2026-001.pdf');
    expect(mockPdfBase64.pieceJointeExtension).toBe('pdf');
    expect(mockPdfBase64.pieceJointeTypeMime).toBe('application/pdf');
    expect(mockPdfBase64.pieceJointeFichier).toBeTruthy();
    expect(mockPdfBase64.pieceJointeFichier.length).toBeGreaterThan(100);

    console.log('✓ Upload PDF Payload:', JSON.stringify(mockPdfBase64, null, 2));
  });

  /**
   * Test 2: Generate an invoice submission payload in SAISIE_API mode (no PDF)
   */
  it('generates a valid SAISIE_API submission payload without PDF', () => {
    const invoiceDraft = createEmptyInvoiceDraft();
    invoiceDraft.supplierInvoiceNumber = 'FAC-2026-SAISIE-001';
    invoiceDraft.invoiceDate = '2026-04-17';
    invoiceDraft.currencyCode = 'EUR';
    invoiceDraft.totalAmountHt = '1750.00';
    invoiceDraft.totalAmountTtc = '2100.00';
    invoiceDraft.lineItems = [
      {
        description: 'Frais de prestation - avril 2026',
        totalHt: 1500,
        vatRate: 20,
      },
      {
        description: 'Déplacement forfaitaire',
        totalHt: 250,
        vatRate: 20,
      },
    ];
    invoiceDraft.vatLines = [
      {
        rate: 20,
        baseHt: 1750,
        taxAmount: 350,
      },
    ];

    const payload = buildChorusSubmissionPayload(invoiceDraft, {
      chorus: {
        idUtilisateurCourant: 331,
        idFournisseur: 160,
        idServiceFournisseur: 436,
        codeCoordonneesBancairesFournisseur: 132,
        submissionMode: 'SAISIE_API',
        modePaiement: 'VIREMENT',
      },
      mainFileName: undefined,
    });

    expect(payload.modeDepot).toBe('SAISIE_API');
    expect(payload.pieceJointePrincipale).toHaveLength(0);
    expect(payload.numeroFactureSaisi).toBe('FAC-2026-SAISIE-001');
    expect(payload.montantTotal.montantHtTotal).toBe(1750);
    expect(payload.montantTotal.montantTVA).toBe(350);

    const validation = validateChorusSubmissionPayload(payload);
    expect(validation.valid).toBe(true);

    console.log('✓ SAISIE_API Submission Payload:', JSON.stringify(payload, null, 2));
  });

  /**
   * Test 3: Generate an invoice submission payload in DEPOT_PDF_API mode (with PDF ID)
   */
  it('generates a valid DEPOT_PDF_API submission payload with PDF ID', () => {
    const invoiceDraft = createEmptyInvoiceDraft();
    invoiceDraft.supplierInvoiceNumber = '2026-003-00565';
    invoiceDraft.invoiceDate = '2026-03-16';
    invoiceDraft.currencyCode = 'EUR';
    invoiceDraft.totalAmountHt = '45903.52';
    invoiceDraft.totalAmountTtc = '55084.22';
    invoiceDraft.lineItems = [
      {
        description: 'Services de conseil - Achat 2026-001',
        totalHt: 45903.52,
        vatRate: 20,
      },
    ];
    invoiceDraft.vatLines = [
      {
        rate: 20,
        baseHt: 45903.52,
        taxAmount: 9180.7,
      },
    ];
    invoiceDraft.purchaseOrderNumber = 'BC2025/25-007915';

    // First, build base payload in DEPOT_PDF_API mode
    const payload = buildChorusSubmissionPayload(invoiceDraft, {
      chorus: {
        idUtilisateurCourant: 331,
        idFournisseur: 160,
        idServiceFournisseur: 436,
        codeCoordonneesBancairesFournisseur: 132,
        submissionMode: 'DEPOT_PDF_API',
      },
      mainFileName: 'facture-2026-001-GIGALIS.pdf',
    });

    // Then finalize with the PDF file ID
    const finalPayload = finalizeChorusSubmissionPayloadForPdfDeposit(payload, {
      mainFileId: 'pie-abc123-xyz789',
      mainFileName: 'facture-2026-001-GIGALIS.pdf',
    });

    expect(finalPayload.modeDepot).toBe('DEPOT_PDF_API');
    expect(finalPayload.pieceJointePrincipale).toHaveLength(1);
    expect(finalPayload.pieceJointePrincipale[0]?.pieceJointePrincipaleId).toBe('pie-abc123-xyz789');
    expect(finalPayload.montantTotal.montantHtTotal).toBe(45903.52);

    const validation = validateChorusSubmissionPayload(finalPayload);
    expect(validation.valid).toBe(true);

    console.log('✓ DEPOT_PDF_API Submission Payload:', JSON.stringify(finalPayload, null, 2));
  });

  /**
   * Test 4: Demonstrate payload validation errors
   */
  it('detects and reports payload validation errors', () => {
    // Create an invalid payload (missing montantTotal)
    const invalidPayload = {
      dateFacture: '2026-04-17',
      numeroFactureSaisi: 'FAC-TEST',
      destinataire: { codeDestinataire: '12345678901234' },
      fournisseur: {},
      modeDepot: 'SAISIE_API',
      pieceJointePrincipale: [],
      pieceJointeComplementaire: [],
      cadreDeFacturation: { codeCadreFacturation: 'A1_FACTURE_FOURNISSEUR' },
      references: { deviseFacture: 'EUR' },
      lignePoste: [],
      ligneTva: [],
      montantTotal: {
        montantHtTotal: 0,
        montantTVA: 0,
        montantTtcTotal: 0,
        montantAPayer: 0,
      },
    } as any;

    const validation = validateChorusSubmissionPayload(invalidPayload);
    expect(validation.valid).toBe(false);
    expect(validation.errors.length).toBeGreaterThan(0);

    console.log('✓ Validation Errors:', validation.errors.map(e => `${e.path}: ${e.message}`));
  });

  /**
   * Test 5: End-to-end flow: PDF upload → invoice submission
   */
  it('documents the complete PDF upload to invoice submission flow', () => {
    console.log('\n📋 Complete Workflow Documentation:\n');

    // Step 1: Generate upload PDF payload
    console.log('Step 1: Upload PDF to Chorus');
    const uploadPayload = createMockUploadPdfPayload('facture-2026-001-GIGALIS.pdf');
    console.log('  POST /cpro/transverses/v1/ajouter/fichier');
    console.log('  Body:', JSON.stringify(uploadPayload, null, 4).split('\n').slice(0, 10).join('\n') + '...');
    console.log('  Expected Response: { "pieceJointeId": "pie-abc123..." }\n');

    // Step 2: Use the returned ID in invoice submission
    console.log('Step 2: Extract pieceJointeId from response');
    const pieceJointeId = 'pie-abc123-xyz789';
    console.log(`  Extracted ID: ${pieceJointeId}\n`);

    // Step 3: Generate invoice submission payload
    console.log('Step 3: Submit invoice with PDF reference');
    const invoiceDraft = createEmptyInvoiceDraft();
    invoiceDraft.supplierInvoiceNumber = '2026-003-00565';
    invoiceDraft.invoiceDate = '2026-03-16';
    invoiceDraft.totalAmountHt = '45903.52';
    invoiceDraft.totalAmountTtc = '55084.22';
    invoiceDraft.lineItems = [{ description: 'Services', totalHt: 45903.52, vatRate: 20 }];
    invoiceDraft.vatLines = [{ rate: 20, baseHt: 45903.52, taxAmount: 9180.7 }];

    const payload = buildChorusSubmissionPayload(invoiceDraft, {
      chorus: {
        idUtilisateurCourant: 331,
        idFournisseur: 160,
        idServiceFournisseur: 436,
        submissionMode: 'DEPOT_PDF_API',
      },
      mainFileName: 'facture-2026-001-GIGALIS.pdf',
    });

    const finalPayload = finalizeChorusSubmissionPayloadForPdfDeposit(payload, {
      mainFileId: pieceJointeId,
      mainFileName: 'facture-2026-001-GIGALIS.pdf',
    });

    console.log('  POST /cpro/factures/v1/soumettre');
    console.log('  Key fields in payload:');
    console.log(`    - modeDepot: "${finalPayload.modeDepot}"`);
    console.log(`    - pieceJointePrincipaleId: "${finalPayload.pieceJointePrincipale[0]?.pieceJointePrincipaleId}"`);
    console.log(`    - montantTotal.montantTtcTotal: ${finalPayload.montantTotal.montantTtcTotal}`);
    console.log(`    - numeroFactureSaisi: "${finalPayload.numeroFactureSaisi}"\n`);

    const validation = validateChorusSubmissionPayload(finalPayload);
    expect(validation.valid).toBe(true);
    console.log('✓ Payload validation: PASS');
  });
});

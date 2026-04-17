# Chorus Pro PDF Upload & Invoice Submission - Testing Guide

This document explains how to use the newly added test infrastructure for Chorus Pro PDF upload and invoice submission workflows.

## What Was Added

### 1. **Payload Builders** (`src/lib/chorus/`)

- **`buildUploadPdfPayload.ts`** - Helper functions for constructing PDF upload payloads
  - `buildUploadPdfPayload()` - Main builder function
  - `validateUploadPdfPayload()` - Validates upload payload structure
  - `createMockUploadPdfPayload()` - Creates test payload with minimal PDF

- **`validatePdfTestPayload.ts`** - Validation helpers for test scenarios
  - `validateTestUploadPdfPayload()` - Validates upload readiness
  - `validateTestPdfSubmissionPayload()` - Validates DEPOT_PDF_API submissions
  - `validateTestSaisieApiPayload()` - Validates SAISIE_API submissions

### 2. **Sample JSON Payloads** (`src/lib/chorus/payloads/`)

Three example JSON files for different scenarios:

- **`uploadPdf.sample.json`** - PDF upload payload structure
  - Shows required fields: `fichierFacture`, `formatDepot`, `nomFichier`
  - Documents how to use Base64-encoded PDF content

- **`submitInvoicePdf.sample.json`** - Invoice submission with PDF (DEPOT_PDF_API)
  - Complete realistic example with GIP Gigalis data
  - Shows how to reference uploaded PDF via `pieceJointePrincipaleId`
  - Documents all required fields and their sources

- **`submitInvoiceSaisieApi.sample.json`** - Invoice submission without PDF (SAISIE_API)
  - Isolated test without file dependencies
  - Useful for testing business logic independently

### 3. **Test Fixtures** (`src/test/fixtures/`)

- **`chorus-pdf-workflows.ts`** - Reusable test data
  - Mock PDF Base64 content
  - Pre-built payload fixtures for both modes
  - Helper functions for creating payload variants
  - Multi-line and multi-VAT test cases

### 4. **Test Suite** (`src/test/`)

- **`chorus-pdf-test-generator.test.ts`** - Comprehensive test examples
  - Generate upload PDF payloads
  - Generate SAISIE_API submissions
  - Generate DEPOT_PDF_API submissions
  - Demonstrate end-to-end workflow

### 5. **Documentation** (`docs/`)

- **`soapui-chorus-tests.md`** - Step-by-step SOAPUI testing guide
  - How to set up SOAPUI projects and properties
  - How to configure OAuth2 authentication
  - How to create test cases for each workflow
  - Troubleshooting common issues

## Quick Start

### 1. Running Tests Locally

```bash
# Run all Chorus PDF tests
npm run test -- chorus-pdf-test-generator

# Run tests in watch mode
npm run test:watch -- chorus-pdf-test-generator
```

The test file will output generated payloads to the console.

### 2. Using the Builders in Your Code

```typescript
import { buildUploadPdfPayload, validateUploadPdfPayload } from '@/lib/chorus/buildUploadPdfPayload';

// Create an upload payload
const payload = buildUploadPdfPayload(
  base64PdfContent,
  'facture-2026-001.pdf',
  false // not signed
);

// Validate before sending
const validation = validateUploadPdfPayload(payload);
if (!validation.valid) {
  console.error('Invalid payload:', validation.errors);
}
```

### 3. Using Test Fixtures

```typescript
import {
  uploadPdfPayloadFixture,
  submitInvoicePdfPayloadFixture,
  submitInvoiceSaisieApiPayloadFixture,
  createUploadPayloadWithFileId,
  createMultiLineInvoice,
} from '@/test/fixtures/chorus-pdf-workflows';

// Use a fixture in your test
test('submit invoice with PDF', () => {
  const payload = createUploadPayloadWithFileId('pie-custom-id-123');
  expect(payload.pieceJointePrincipale[0].pieceJointePrincipaleId).toBe('pie-custom-id-123');
});
```

### 4. Testing in SOAPUI

Follow the detailed guide in [docs/soapui-chorus-tests.md](./soapui-chorus-tests.md):

1. Create a new SOAPUI project
2. Configure project properties (OAuth2 credentials, API URLs)
3. Create test cases using the provided payloads
4. Run the complete workflow:
   - Get OAuth2 token
   - Upload PDF
   - Submit invoice with PDF
   - Submit invoice without PDF (isolated test)

## File Structure

```
.
├── src/
│   ├── lib/chorus/
│   │   ├── buildUploadPdfPayload.ts      ← PDF upload builder
│   │   ├── validatePdfTestPayload.ts     ← Validation helpers
│   │   ├── payloads/
│   │   │   ├── uploadPdf.sample.json
│   │   │   ├── submitInvoicePdf.sample.json
│   │   │   └── submitInvoiceSaisieApi.sample.json
│   │   └── (existing Chorus infrastructure)
│   └── test/
│       ├── fixtures/
│       │   └── chorus-pdf-workflows.ts   ← Test fixtures
│       └── chorus-pdf-test-generator.test.ts ← Test examples
└── docs/
    ├── soapui-chorus-tests.md           ← SOAPUI guide
    └── CHORUS_PDF_TESTING_README.md     ← This file
```

## Key Workflows

### Workflow 1: Upload PDF

```
POST /cpro/factures/v1/deposer/pdf
{
  "fichierFacture": "JVBERi0x...",  // Base64 PDF content
  "formatDepot": "PDF_NON_SIGNE",
  "nomFichier": "facture.pdf"
}

Response:
{
  "pieceJointeId": "pie-abc123...",
  "status": "success"
}
```

Extract `pieceJointeId` for use in step 2.

### Workflow 2: Submit Invoice with PDF

```
POST /cpro/factures/v1/soumettre
{
  "modeDepot": "DEPOT_PDF_API",
  "pieceJointePrincipale": [
    {
      "pieceJointePrincipaleId": "pie-abc123...",  // From upload
      "pieceJointePrincipaleDesignation": "..."
    }
  ],
  "dateFacture": "2026-03-16",
  "numeroFactureSaisi": "FAC-2026-001",
  "montantTotal": { ... },
  "destinataire": { ... },
  "fournisseur": { ... },
  "lignePoste": [ ... ],
  "ligneTva": [ ... ],
  "references": { ... }
}
```

### Workflow 3: Submit Invoice without PDF (Isolated Testing)

```
POST /cpro/factures/v1/soumettre
{
  "modeDepot": "SAISIE_API",
  "pieceJointePrincipale": [],  // Empty array
  "dateFacture": "2026-04-17",
  "numeroFactureSaisi": "FAC-2026-SAISIE-001",
  // ... rest of fields same as workflow 2
}
```

## Common Tasks

### Task 1: Generate Upload PDF Payload

```typescript
import { buildUploadPdfPayload } from '@/lib/chorus/buildUploadPdfPayload';

const pdfBase64 = fs.readFileSync('facture.pdf', { encoding: 'base64' });
const payload = buildUploadPdfPayload(pdfBase64, 'facture-test.pdf', false);
console.log(JSON.stringify(payload, null, 2));
```

### Task 2: Validate an Invoice Before Submission

```typescript
import { validateTestPdfSubmissionPayload } from '@/lib/chorus/validatePdfTestPayload';
import { submitInvoicePdfPayloadFixture } from '@/test/fixtures/chorus-pdf-workflows';

const result = validateTestPdfSubmissionPayload(submitInvoicePdfPayloadFixture);
if (!result.valid) {
  result.errors.forEach(e => console.error(`${e.field}: ${e.message}`));
}
```

### Task 3: Create Custom Invoice for Testing

```typescript
import { createMultiLineInvoice } from '@/test/fixtures/chorus-pdf-workflows';

const invoice = createMultiLineInvoice();
// Modify as needed
invoice.numeroFactureSaisi = 'YOUR-INVOICE-123';
invoice.destinataire.codeDestinataire = 'YOUR-SIRET';
```

### Task 4: Test Amount Validation

```typescript
import { amountValidationTestCases } from '@/test/fixtures/chorus-pdf-workflows';

amountValidationTestCases.forEach(tc => {
  if (tc.valid) {
    expect(tc.ht + tc.vat).toBeCloseTo(tc.ttc, 2);
  }
});
```

## API Reference

### buildUploadPdfPayload(pdfBase64, fileName, isSigned?)

Creates an upload payload for the /deposer/pdf endpoint.

```typescript
buildUploadPdfPayload(
  'JVBERi0x...',      // Base64 PDF content (required)
  'facture.pdf',      // Filename (required)
  false               // Is signed PDF? (optional, default: false)
): UploadPdfPayload
```

### validateUploadPdfPayload(payload)

Validates an upload PDF payload structure.

```typescript
validateUploadPdfPayload(payload): {
  valid: boolean;
  errors: string[];
}
```

### validateTestPdfSubmissionPayload(payload)

Validates a DEPOT_PDF_API submission is ready for testing.

```typescript
validateTestPdfSubmissionPayload(payload): ValidationResult
// ValidationResult has: valid, errors[], warnings[]
```

### validateTestSaisieApiPayload(payload)

Validates a SAISIE_API submission is ready for testing.

```typescript
validateTestSaisieApiPayload(payload): ValidationResult
```

## Important Notes

### IDs Must Come from Context

These fields **cannot be invented** and must come from your Chorus configuration:
- `idFournisseur` - Supplier ID from Chorus
- `idUtilisateurCourant` - Current user ID from Chorus
- `idServiceFournisseur` - Supplier service ID from Chorus
- `codeCoordonneesBancairesFournisseur` - Banking code from Chorus

### Amount Calculations Must Match

Always ensure: `montantTtcTotal = montantHtTotal + montantTVA`

Tolerance is typically ±0.05 for floating-point arithmetic.

### PDF Mode Requires File ID

For `DEPOT_PDF_API` mode:
- First upload the PDF to get `pieceJointeId`
- Then reference this ID in the submission payload
- The ID comes from the upload response, not from the PDF itself

### SAISIE_API Has No Attachments

For `SAISIE_API` mode:
- `pieceJointePrincipale` must be an empty array `[]`
- `pieceJointeComplementaire` must be an empty array `[]`
- All invoice data must be provided as structured fields

## Troubleshooting

### "montantTtcTotal != montantHtTotal + montantTVA"

**Issue:** Amount validation failed

**Solution:** Recalculate amounts. Use fixtures as reference:
```
TTC = HT + VAT
55084.22 = 45903.52 + 9180.7 ✓
```

### "pieceJointePrincipaleId not found" or "PDF ID mismatch"

**Issue:** File ID from upload doesn't match submission

**Solution:**
1. Verify upload succeeded and returned an ID
2. Extract the ID from the response
3. Use the exact ID (including any prefixes/suffixes) in submission

### "Base64 string appears truncated"

**Issue:** PDF upload fails with invalid format

**Solution:** Ensure Base64 encoding:
```bash
# Linux/macOS
base64 -w 0 facture.pdf > facture.b64

# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('facture.pdf')) | Out-File facture.b64
```

## Next Steps

1. **Local Testing:** Run `npm run test -- chorus-pdf-test-generator`
2. **SOAPUI Testing:** Follow [soapui-chorus-tests.md](./soapui-chorus-tests.md)
3. **Integration:** Use builders and fixtures in your application code
4. **Validation:** Always validate payloads before sending to Chorus

## References

- [Chorus Pro Official API Documentation](https://portail.chorus.economie.gouv.fr/api-documentation)
- [buildUploadPdfPayload.ts](../src/lib/chorus/buildUploadPdfPayload.ts)
- [validatePdfTestPayload.ts](../src/lib/chorus/validatePdfTestPayload.ts)
- [chorus-pdf-workflows.ts](../src/test/fixtures/chorus-pdf-workflows.ts)
- [chorus-pdf-test-generator.test.ts](../src/test/chorus-pdf-test-generator.test.ts)

---

**Last Updated:** April 17, 2026  
**Status:** Complete and Ready for Testing  
**Compatibility:** Node.js 18+, TypeScript 5.0+

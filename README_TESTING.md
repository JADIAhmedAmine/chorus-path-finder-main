# Chorus Pro PDF Testing - Navigation Guide

Welcome! This guide helps you navigate the complete PDF testing infrastructure added to the project.

## 🚀 Quick Start (5 minutes)

1. **Read this file first** ← You are here!
2. Read [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md) for complete overview
3. Run tests: `npm run test -- chorus-pdf-test-generator`
4. Choose your testing method (Local or SOAPUI)

## 📁 Project Structure

### Code Files (TypeScript)

**Builders & Validators:**
- [`src/lib/chorus/buildUploadPdfPayload.ts`](./src/lib/chorus/buildUploadPdfPayload.ts)
  - `buildUploadPdfPayload()` - Create PDF upload payloads
  - `validateUploadPdfPayload()` - Validate upload structure
  - `createMockUploadPdfPayload()` - Generate test payloads

- [`src/lib/chorus/validatePdfTestPayload.ts`](./src/lib/chorus/validatePdfTestPayload.ts)
  - `validateTestUploadPdfPayload()` - Check upload readiness
  - `validateTestPdfSubmissionPayload()` - Validate DEPOT_PDF_API submissions
  - `validateTestSaisieApiPayload()` - Validate SAISIE_API submissions

**Test Files:**
- [`src/test/chorus-pdf-test-generator.test.ts`](./src/test/chorus-pdf-test-generator.test.ts)
  - 5 comprehensive test cases
  - Real payload generation examples
  - Error handling demonstrations
  - End-to-end workflow docs

- [`src/test/fixtures/chorus-pdf-workflows.ts`](./src/test/fixtures/chorus-pdf-workflows.ts)
  - Mock PDF data
  - Pre-built payload fixtures
  - Helper functions for test variants
  - Amount validation test cases

### JSON Samples

- [`src/lib/chorus/payloads/uploadPdf.sample.json`](./src/lib/chorus/payloads/uploadPdf.sample.json)
  - Example upload payload
  - Field descriptions
  - Usage notes

- [`src/lib/chorus/payloads/submitInvoicePdf.sample.json`](./src/lib/chorus/payloads/submitInvoicePdf.sample.json)
  - DEPOT_PDF_API submission example
  - Complete field reference
  - Step-by-step usage guide

- [`src/lib/chorus/payloads/submitInvoiceSaisieApi.sample.json`](./src/lib/chorus/payloads/submitInvoiceSaisieApi.sample.json)
  - SAISIE_API submission example
  - Isolated testing scenario
  - Key differences from PDF mode

### Documentation

**Start Here:**
- [`IMPLEMENTATION_SUMMARY.md`](./IMPLEMENTATION_SUMMARY.md) ← **START HERE**
  - Complete overview of what was added
  - All key features
  - Testing instructions
  - Deliverables checklist

**For Quick Start:**
- [`docs/CHORUS_PDF_TESTING_README.md`](./docs/CHORUS_PDF_TESTING_README.md)
  - Quick start guide
  - Common tasks with code examples
  - API reference
  - Troubleshooting FAQ

**For SOAPUI Testing:**
- [`docs/soapui-chorus-tests.md`](./docs/soapui-chorus-tests.md)
  - Step-by-step SOAPUI setup guide
  - 4 complete test case definitions
  - OAuth2 configuration
  - Common issues and solutions

**This File:**
- [`README_TESTING.md`](./README_TESTING.md) ← This navigation guide

**Structure Reference:**
- [`STRUCTURE_ADDED.txt`](./STRUCTURE_ADDED.txt)
  - Visual breakdown of all files
  - Size and line counts
  - Feature summary

## 🧪 Testing Methods

### Method 1: Local Testing (Fastest)

Run the Vitest test suite:

```bash
# Run once
npm run test -- chorus-pdf-test-generator

# Run in watch mode for development
npm run test:watch -- chorus-pdf-test-generator
```

Output will show:
- Generated payloads as JSON
- Validation results
- Test outcomes
- End-to-end workflow demonstrations

**Best for:** Development, quick validation, unit testing

### Method 2: SOAPUI Testing (Integration)

Follow the complete guide in [`docs/soapui-chorus-tests.md`](./docs/soapui-chorus-tests.md)

Steps:
1. Create SOAPUI project
2. Configure properties (OAuth2, API URLs)
3. Create 4 test cases (provided in guide)
4. Run against Chorus sandbox

**Best for:** Integration testing, API validation, full workflow testing

### Method 3: Code Integration (Production)

Use the builders in your application:

```typescript
import { buildUploadPdfPayload } from '@/lib/chorus/buildUploadPdfPayload';
import { submitInvoicePdfPayloadFixture } from '@/test/fixtures/chorus-pdf-workflows';

// In your code
const uploadPayload = buildUploadPdfPayload(base64Pdf, 'invoice.pdf', false);
const fixture = submitInvoicePdfPayloadFixture;
```

**Best for:** Production use, application integration

## 📚 Documentation Roadmap

### For First-Time Users

1. Read: [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md) (10 min)
   - Overview of what was implemented
   - High-level feature summary
   - Testing instructions

2. Review: [docs/CHORUS_PDF_TESTING_README.md](./docs/CHORUS_PDF_TESTING_README.md) (10 min)
   - Quick start guide
   - Code examples
   - API reference

3. Choose testing method:
   - **Local:** Run `npm run test -- chorus-pdf-test-generator`
   - **SOAPUI:** Follow [docs/soapui-chorus-tests.md](./docs/soapui-chorus-tests.md)

### For Developers Integrating Code

1. Review: [src/lib/chorus/buildUploadPdfPayload.ts](./src/lib/chorus/buildUploadPdfPayload.ts)
2. Review: [src/lib/chorus/validatePdfTestPayload.ts](./src/lib/chorus/validatePdfTestPayload.ts)
3. Check: [src/test/fixtures/chorus-pdf-workflows.ts](./src/test/fixtures/chorus-pdf-workflows.ts)
4. Reference: [docs/CHORUS_PDF_TESTING_README.md](./docs/CHORUS_PDF_TESTING_README.md) for API details

### For SOAPUI Testing

1. Follow: [docs/soapui-chorus-tests.md](./docs/soapui-chorus-tests.md)
2. Reference: JSON samples in `src/lib/chorus/payloads/`
3. Use: Provided test case definitions from guide

## 🔑 Key Files by Use Case

### I want to...

**Generate an upload PDF payload**
→ Use: [`buildUploadPdfPayload.ts`](./src/lib/chorus/buildUploadPdfPayload.ts)
→ Read: [Quick Start Guide](./docs/CHORUS_PDF_TESTING_README.md#task-1-generate-upload-pdf-payload)

**Validate an invoice before submission**
→ Use: [`validatePdfTestPayload.ts`](./src/lib/chorus/validatePdfTestPayload.ts)
→ Read: [API Reference](./docs/CHORUS_PDF_TESTING_README.md#api-reference)

**Test in SOAPUI**
→ Read: [`soapui-chorus-tests.md`](./docs/soapui-chorus-tests.md)
→ Reference: JSON samples in `payloads/` folder

**Understand the implementation**
→ Read: [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md)

**See example test data**
→ Check: [`chorus-pdf-workflows.ts`](./src/test/fixtures/chorus-pdf-workflows.ts)

**Review test cases**
→ Read: [`chorus-pdf-test-generator.test.ts`](./src/test/chorus-pdf-test-generator.test.ts)

**View sample payloads**
→ Browse: `src/lib/chorus/payloads/` folder

## 🎯 Three Core Workflows

### 1️⃣ PDF Upload
```
POST /cpro/factures/v1/deposer/pdf
Input:  Base64 PDF + filename
Output: pieceJointeId (for step 2)
```
→ Builder: `buildUploadPdfPayload()`  
→ Validator: `validateUploadPdfPayload()`  
→ Sample: [`uploadPdf.sample.json`](./src/lib/chorus/payloads/uploadPdf.sample.json)

### 2️⃣ Submit with PDF (DEPOT_PDF_API)
```
POST /cpro/factures/v1/soumettre
Input:  Invoice data + PDF file ID from step 1
Output: Invoice ID (confirmation)
```
→ Builder: `buildChorusSubmissionPayload()`  
→ Finalizer: `finalizeChorusSubmissionPayloadForPdfDeposit()`  
→ Validator: `validateTestPdfSubmissionPayload()`  
→ Sample: [`submitInvoicePdf.sample.json`](./src/lib/chorus/payloads/submitInvoicePdf.sample.json)

### 3️⃣ Submit without PDF (SAISIE_API)
```
POST /cpro/factures/v1/soumettre
Input:  Invoice data only (no PDF)
Output: Invoice ID (confirmation)
```
→ Builder: `buildChorusSubmissionPayload()`  
→ Validator: `validateTestSaisieApiPayload()`  
→ Sample: [`submitInvoiceSaisieApi.sample.json`](./src/lib/chorus/payloads/submitInvoiceSaisieApi.sample.json)

## 🔗 Quick Links

| Resource | Purpose | Time |
|----------|---------|------|
| [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md) | Complete overview | 10 min |
| [docs/CHORUS_PDF_TESTING_README.md](./docs/CHORUS_PDF_TESTING_README.md) | Quick start & API ref | 15 min |
| [docs/soapui-chorus-tests.md](./docs/soapui-chorus-tests.md) | SOAPUI guide | 20 min |
| [src/lib/chorus/buildUploadPdfPayload.ts](./src/lib/chorus/buildUploadPdfPayload.ts) | Source code | 5 min |
| [src/lib/chorus/validatePdfTestPayload.ts](./src/lib/chorus/validatePdfTestPayload.ts) | Source code | 5 min |
| [src/test/chorus-pdf-test-generator.test.ts](./src/test/chorus-pdf-test-generator.test.ts) | Test examples | 10 min |
| [src/test/fixtures/chorus-pdf-workflows.ts](./src/test/fixtures/chorus-pdf-workflows.ts) | Test data | 5 min |

## ✅ Verification Checklist

After implementation, verify:

- [ ] Read IMPLEMENTATION_SUMMARY.md
- [ ] Reviewed docs/CHORUS_PDF_TESTING_README.md
- [ ] Ran `npm run test -- chorus-pdf-test-generator` successfully
- [ ] Reviewed at least one example in src/test/fixtures/
- [ ] Checked SOAPUI guide for integration testing
- [ ] Identified use case that matches your needs

## 🆘 Need Help?

1. **Understanding the implementation**
   → Read: [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md)

2. **API questions**
   → Read: [docs/CHORUS_PDF_TESTING_README.md#api-reference](./docs/CHORUS_PDF_TESTING_README.md)

3. **SOAPUI questions**
   → Read: [docs/soapui-chorus-tests.md](./docs/soapui-chorus-tests.md)

4. **Code examples**
   → Check: [src/test/chorus-pdf-test-generator.test.ts](./src/test/chorus-pdf-test-generator.test.ts)

5. **Troubleshooting**
   → Read: [docs/CHORUS_PDF_TESTING_README.md#troubleshooting](./docs/CHORUS_PDF_TESTING_README.md)

## 📞 Next Steps

1. **Right now:** Read [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md)
2. **Next:** Run `npm run test -- chorus-pdf-test-generator`
3. **Then:** Choose your testing method (Local or SOAPUI)
4. **Finally:** Integrate into your workflow

---

**Implementation Status:** ✅ Complete  
**Last Updated:** April 17, 2026  
**All Files:** 12 total | ~9000 lines of code + documentation
{     "numeroFactureSaisi": "10851046",
     "dateFacture": "2025-11-05",
	"cadreDeFacturation": {
    "codeCadreFacturation": "A1_FACTURE_FOURNISSEUR"
  },
  "destinataire": {
    "codeDestinataire": "00000000113495"
  },
  "fournisseur": {
    "idFournisseur": 26359578
  },
 
  "lignePoste": [
    {
      "lignePosteDenomination": "Licence",
      "lignePosteMontantRemiseHT": 0,
      "lignePosteMontantUnitaireHT": 16.6667,
      "lignePosteNumero": 1,
      "lignePosteQuantite": 1,
      "lignePosteReference": "votil_licence",
      "lignePosteTauxTvaManuel": 20,
      "lignePosteUnite": "licence"
    }
  ],
  "ligneTva": [
    {
      "ligneTvaMontantBaseHtParTaux": 16.6667,
      "ligneTvaMontantTvaParTaux": 3.3333,
      "ligneTvaTauxManuel": 20
    }
  ],
  "modeDepot": "DEPOT_PDF_SIGNE_API",
  "montantTotal": {
    "montantAPayer": 20,
    "montantHtTotal": 16.6667,
    "montantRemiseGlobaleTTC": 0,
    "montantTVA": 3.3333,
    "montantTtcTotal": 20
  },
  "pieceJointePrincipale": [
    {
      "pieceJointePrincipaleDesignation": "GCU_MSG_01_000",
      "pieceJointePrincipaleId": 10851046
    }
  ],
  "references": {
    "deviseFacture": "EUR",
    "modePaiement": "VIREMENT",
    "typeFacture": "FACTURE",
    "typeTva": "TVA_SUR_ENCAISSEMENT"
  }
}
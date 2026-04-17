# SOAPUI Testing Guide for Chorus Pro Invoice API

This guide explains how to set up and run tests in SOAPUI for the complete Chorus Pro invoice workflow, including PDF upload and invoice submission.

## Prerequisites

- SOAPUI Pro or Community Edition (v5.7+)
- Valid Chorus Pro sandbox credentials (OAuth2 token)
- Bearer token and technical account credentials (cproAccount header)
- A test PDF file (invoice)
- Base64 encoding tool or script

## Environment Setup

### 1. Create a New Project

In SOAPUI:
1. File → New SOAP Project
2. Name: `Chorus Invoice API Tests`
3. Accept default settings

### 2. Configure Project Properties

Right-click the project → Show Project View → Manage Properties tab

Add the following project-level properties:

| Property Name | Example Value | Description |
|---|---|---|
| CHORUS_API_BASE_URL | https://sandbox-api.chorus-pro.gouv.fr | Chorus API base URL |
| CHORUS_TOKEN_URL | https://sandbox-oauth.chorus-pro.gouv.fr/oauth/token | OAuth2 token endpoint |
| CHORUS_CLIENT_ID | your-client-id | OAuth2 client ID |
| CHORUS_CLIENT_SECRET | your-client-secret | OAuth2 client secret |
| CHORUS_TECHNICAL_LOGIN | your-technical-login | Technical account login |
| CHORUS_TECHNICAL_PASSWORD | your-technical-password | Technical account password |
| CHORUS_BEARER_TOKEN | (auto-generated) | Will be populated by token endpoint |
| CPRO_ACCOUNT_HEADER | (auto-generated) | Base64(login:password) for cpro-account header |
| INVOICE_PDF_BASE64 | (to be filled) | Base64-encoded PDF content |
| UPLOADED_FILE_ID | (auto-populated) | ID returned from PDF upload |

### 3. Prepare PDF

#### Convert PDF to Base64

Linux/macOS:
```bash
base64 -w 0 /path/to/facture.pdf > facture.b64
cat facture.b64
```

Windows PowerShell:
```powershell
$pdf = [System.IO.File]::ReadAllBytes('C:\path\to\facture.pdf')
$base64 = [System.Convert]::ToBase64String($pdf)
$base64 | Out-File -Path 'facture.b64'
```

#### Store in Project

In SOAPUI: Right-click project → Manage Properties → Paste Base64 in INVOICE_PDF_BASE64

## Test Cases Setup

### Test Case 1: Get OAuth2 Token

**Endpoint:** POST ${CHORUS_TOKEN_URL}

**Headers:**
```
Content-Type: application/x-www-form-urlencoded
```

**Body:**
```
grant_type=client_credentials
client_id=${CHORUS_CLIENT_ID}
client_secret=${CHORUS_CLIENT_SECRET}
scope=openid
```

**Expected Response:** { "access_token": "...", "token_type": "Bearer", "expires_in": 3600 }

**Script to save token:**
```groovy
import groovy.json.JsonSlurper
def response = messageExchange.response.contentAsString
def json = new JsonSlurper().parseText(response)
testRunner.testCase.testSuite.project.setPropertyValue('CHORUS_BEARER_TOKEN', json.access_token)
```

### Test Case 2: Upload PDF

**Endpoint:** POST ${CHORUS_API_BASE_URL}/cpro/factures/v1/deposer/pdf

**Headers:**
```
Authorization: Bearer ${CHORUS_BEARER_TOKEN}
cpro-account: ${CPRO_ACCOUNT_HEADER}
Content-Type: application/json; charset=UTF-8
```

**Body:**
```json
{
  "fichierFacture": "${INVOICE_PDF_BASE64}",
  "formatDepot": "PDF_NON_SIGNE",
  "nomFichier": "facture-test-2026-001.pdf"
}
```

**Expected Response:** { "pieceJointeId": "pie-...", "status": "success" }

**Script to extract file ID:**
```groovy
import groovy.json.JsonSlurper
def response = messageExchange.response.contentAsString
def json = new JsonSlurper().parseText(response)
def fileId = json.pieceJointeId ?: json.id
testRunner.testCase.testSuite.project.setPropertyValue('UPLOADED_FILE_ID', fileId)
log.info "File uploaded. ID: " + fileId
```

### Test Case 3: Submit Invoice with PDF (DEPOT_PDF_API)

**Endpoint:** POST ${CHORUS_API_BASE_URL}/cpro/factures/v1/soumettre

**Headers:**
```
Authorization: Bearer ${CHORUS_BEARER_TOKEN}
cpro-account: ${CPRO_ACCOUNT_HEADER}
Content-Type: application/json; charset=UTF-8
```

**Body:**
```json
{
  "cadreDeFacturation": {
    "codeCadreFacturation": "A1_FACTURE_FOURNISSEUR"
  },
  "dateFacture": "2026-03-16",
  "destinataire": {
    "codeDestinataire": "23440003400026",
    "codeServiceExecutant": "SE-PDL"
  },
  "fournisseur": {
    "idFournisseur": 160,
    "idServiceFournisseur": 436,
    "codeCoordonneesBancairesFournisseur": 132
  },
  "idUtilisateurCourant": 331,
  "lignePoste": [
    {
      "lignePosteDenomination": "Services - Achat 2026-001",
      "lignePosteMontantHT": 45903.52,
      "lignePosteTauxTVA": 20.0
    }
  ],
  "ligneTva": [
    {
      "ligneTvaBaseHT": 45903.52,
      "ligneTvaMontant": 9180.7,
      "ligneTvaTaux": 20.0
    }
  ],
  "modeDepot": "DEPOT_PDF_API",
  "montantTotal": {
    "montantAPayer": 55084.22,
    "montantHtTotal": 45903.52,
    "montantRemiseGlobaleTTC": 0,
    "montantTVA": 9180.7,
    "montantTtcTotal": 55084.22,
    "motifRemiseGlobaleTTC": ""
  },
  "numeroFactureSaisi": "2026-003-00565",
  "pieceJointeComplementaire": [],
  "pieceJointePrincipale": [
    {
      "pieceJointePrincipaleDesignation": "Facture principale",
      "pieceJointePrincipaleId": "${UPLOADED_FILE_ID}"
    }
  ],
  "references": {
    "deviseFacture": "EUR",
    "modePaiement": "CHEQUE",
    "numeroBonCommande": "BC2025/25-007915",
    "typeFacture": "FACTURE",
    "typeTva": "TVA_SUR_DEBIT"
  }
}
```

### Test Case 4: Submit Invoice without PDF (SAISIE_API)

**Endpoint:** POST ${CHORUS_API_BASE_URL}/cpro/factures/v1/soumettre

**Headers:** Same as Test Case 3

**Body - Key Differences:**
```json
{
  "modeDepot": "SAISIE_API",
  "pieceJointePrincipale": [],
  "numeroFactureSaisi": "FAC-2026-SAISIE-001",
  "dateFacture": "2026-04-17",
  "montantTotal": {
    "montantHtTotal": 1750.0,
    "montantTVA": 350.0,
    "montantTtcTotal": 2100.0,
    "montantAPayer": 2100.0
  },
  "lignePoste": [
    {
      "lignePosteDenomination": "Frais de prestation",
      "lignePosteMontantHT": 1500.0,
      "lignePosteTauxTVA": 20.0
    }
  ],
  "ligneTva": [
    {
      "ligneTvaBaseHT": 1750.0,
      "ligneTvaMontant": 350.0,
      "ligneTvaTaux": 20.0
    }
  ]
}
```

## Common Issues and Solutions

### Issue: 401 Unauthorized

**Causes:**
- Token expired
- Invalid credentials
- Missing cpro-account header

**Solutions:**
- Re-run Get Token test
- Verify CHORUS_TECHNICAL_LOGIN and CHORUS_TECHNICAL_PASSWORD
- Check cpro-account header is Base64-encoded correctly

### Issue: 400 Bad Request on Upload

**Causes:**
- Base64 truncated
- Invalid filename
- Wrong formatDepot value

**Solutions:**
- Verify Base64 has no line breaks
- Ensure filename ends with .pdf
- Use PDF_NON_SIGNE or PDF_SIGNE only

### Issue: Amount Validation Errors

**Causes:**
- montantTtcTotal != montantHtTotal + montantTVA

**Solution:**
```
TTC = HT + VAT
55084.22 = 45903.52 + 9180.7 ✓
```

### Issue: Invalid pieceJointePrincipaleId

**Causes:**
- File ID not extracted from upload response
- UPLOADED_FILE_ID property not set

**Solution:**
- Verify upload test succeeded
- Check extraction script in upload test

## Running Tests

1. Right-click Test Suite → Run
2. Monitor progress in Results panel
3. Check logs for detailed output
4. Verify response status codes

## Reference

For payload samples and helper functions, see:
- [uploadPdf.sample.json](../src/lib/chorus/payloads/uploadPdf.sample.json)
- [submitInvoicePdf.sample.json](../src/lib/chorus/payloads/submitInvoicePdf.sample.json)
- [submitInvoiceSaisieApi.sample.json](../src/lib/chorus/payloads/submitInvoiceSaisieApi.sample.json)
- [buildUploadPdfPayload.ts](../src/lib/chorus/buildUploadPdfPayload.ts)

---

Document Version: 1.0 | April 2026

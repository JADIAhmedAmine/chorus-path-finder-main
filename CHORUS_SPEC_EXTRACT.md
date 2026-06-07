# Chorus Pro — Spec Extract (Dossier de Spécifications Externes, Annexe Services API)

> **Generated:** 2026-06-07 · **Source parsed:** official PDF **V5.00** (454 pp.) — and cross-checked with
> **V4.14-bis** (562 pp.) — from communaute.chorus-pro.gouv.fr. Public documents, downloaded once and
> text-extracted locally (PyMuPDF). Section numbers (e.g. *2.1.1.1*) are the spec's own.
> This file **resolves the prior "à vérifier S7" markers** with confirmed facts. Page/section refs included.
>
> Sources:
> - V5.00: `https://communaute.chorus-pro.gouv.fr/wp-content/uploads/2020/04/Specifications_Externes_Annexe_Services_API_V5.00.pdf`
> - V4.14-bis: `https://communaute.chorus-pro.gouv.fr/wp-content/uploads/2019/12/Specifications_Externes_Annexe_Services_API_V4.14-bis.pdf`

## ⚠️ Corrections to earlier docs (now authoritative)

| Item | Earlier (from web page) | **Confirmed (spec V5.00)** |
|------|--------------------------|-----------------------------|
| **Flux deposit size** | "≤ 120 MB" | **`deposerFluxFacture` flux ≤ 10 Mo non compressé / 30 Mo compressé** (§2.1.1.1). Error **20001**. |
| 120 Mo meaning | (mis-attributed to flux) | **`telechargerGroupeFacture`**: downloaded dossier ≤ **120 Mo**, error **413** (§2.1.1.24). |
| PDF deposit | n/a | **`deposerPDFFacture` PDF ≤ 10 Mo**, error **413** (§2.1.1.3). |

## 1. Confirmed flux methods (factures émises / flux domain)

| Method | Purpose | Key constraints (spec) |
|--------|---------|------------------------|
| `deposerFluxFacture` | Deposit XML or PDF/A3 flux | ≤ 10 Mo (uncompressed) / 30 Mo (compressed); input `formatFlux`, `syntaxeFlux`, `avecSignature`; output `numeroFluxDepot`, `dateDepot`, `syntaxeFlux` |
| `deposerPDFFacture` | Deposit PDF → OCR | ≤ 10 Mo; `formatDepot` ∈ {PDF_NON_SIGNE, PDF_SIGNE_PADES, PDF_SIGNE_XADES}; → status `INTERPRETEE_OCR` → `soumettreFacture` |
| `soumettreFacture` | Submit interpreted/structured invoice | output `numeroFacture` (alphanumeric, specials `- _ / +`) |
| `consulterCR` | Consult flux deposit info + PDF compte rendu | input `numeroFluxDepot`; output `etatCourantFlux`, `codeInterfaceFlux`, `fichierCR` (base64 PDF) |
| `consulterCRDetaille` | Detailed integration state + errors | output adds `listeErreurTechnique[]`, `listeErreurDP[]` (see §4) |
| `recupererFormatFlux` | List flux formats | `formatFlux` enum (§3) |
| `recupererSyntaxeFlux` | List flux syntaxes | input `formatFlux`; output `syntaxeFlux` enum (§3) |

Other confirmed services (non-exhaustive, from the spec's method index): `completerFacture`,
`recyclerFacture`, `traiterFactureRecue`, `traiterFactureAValider`, `traiterFacturesRejetees`,
`corrigerValideurFacture`, `recupererMotifsRefusFactureAValider`, `rechercherFactureParFournisseur`,
`consulterHistoriqueFacture`, `consulterFactureParRecipiendaire`, `telechargerGroupeFacture`,
`telechargerPieceJointe`, `ajouterFichierDansSysteme`, `rechercherDestinataire`,
`rechercherServicesStructure`, `consulterInformationSIRET`, `rechercherEngagementJuridique`,
`consulterStructure`, `recupererTauxTVA`/`recupererDevises`/`recupererModeReglements` (reference data).

## 2. Flux lifecycle — `etatCourantFlux` (official French labels) [§ ConsulterCR output]

| # | État (FR, official) | Description (spec) | Tone |
|---|----------------------|--------------------|------|
| 1 | **Reçu** | Le flux a été reçu par Chorus Pro | info |
| 2 | **Traité SE CPP** | Le fichier est arrivé dans le système d'échange Chorus Pro | info |
| 3 | **En attente de traitement** | Le flux est en liste d'attente | neutral |
| 4 | **En cours de traitement** | Le flux est en cours de traitement | info |
| 5 | **Incidenté** | Flux non traité par le système d'échange ; il faut reprendre le flux intégralement | warning |
| 6 | **Rejeté** | Le flux a été traité mais rejeté car il comporte des anomalies | error |
| 7 | **En attente de retraitement** | Le flux a été bloqué ; il attend une reprise manuelle | warning |
| 8 | **Intégré** | Le flux a été traité et tout a été intégré dans Chorus Pro | success |
| 9 | **Intégré partiellement** | Rejet partiel : seules les factures correctes sont intégrées | warning/success |

> Note: the English doc's "Warning" = the French **"Incidenté"**. App code may map these to its own
> `status_local`; align labels on this official set.

## 3. Format & syntax enumerations (confirmed)

**`formatFlux`** (2 values): `IN_DP_E1_STRUCT`, `IN_DP_E2_MIXTE`.

**`syntaxeFlux`** (6 values listed in ConsulterCR; deposerFluxFacture mentions "7 valeurs" by version):
`IN_DP_E1_UBL_INVOICE`, `IN_DP_E1_CII_16B`, `IN_DP_E2_UBL_INVOICE_MIN`, `IN_DP_E2_CII_MIN_16B`,
`IN_DP_E2_CII_FACTURX`, `IN_DP_E2_CPP_FACTURE_MIN`.
→ Maps to **UBL Invoice, CII (UN/CEFACT 16B), Factur-X (CII), and CPP minimal** profiles. (CII16B
structured/minimal + Factur-X were added in spec V3.4bis.)

**`formatDepot`** (deposerPDFFacture, 3 values): `PDF_NON_SIGNE`, `PDF_SIGNE_PADES`, `PDF_SIGNE_XADES`.

## 4. Error model

### 4.1 `deposerFluxFacture` — error table (§2.1.1.1)
| Code | Description | Message |
|------|-------------|---------|
| 20000 | Le service de contrôle anti-virus a rejeté le fichier | GDP_MSG_11.036 |
| **20001** | La taille du fichier doit être ≤ taille maximale autorisée lors d'un dépôt | GDP_MSG_11.022 |
| 20002 | Le service de contrôle de l'extension du fichier a rejeté le fichier | GDP_MSG_11.025 |
| 20004 | L'utilisateur n'a pas les habilitations nécessaires | GDP_MSG_11.021 |
| 20005 | Le format des données en entrée n'est pas conforme au format attendu par les traitements EDI | GDP_MSG_11.020 |
| 20006 | Une erreur s'est produite lors du chargement du fichier dans le système | GDP_MSG_11.023 |
| 20007 | L'encodage du fichier n'est pas conforme à la norme (base64) | TRA_MSG_00.020 |

> **Important nuance:** error code numbers are **scoped per service** — e.g. for **`consulterCRDetaille`**,
> `20000` = "Vous n'êtes pas habilité sur l'espace Suivi des flux…", `20001` = **"Flux introuvable"**.
> Do **not** treat a numeric code globally; always pair it with the calling method.

### 4.2 `consulterCRDetaille` — detailed integration errors (output)
- `etatCourantDepotFlux`, `dateHeureEtatCourantFlux`, `codeInterfaceDepotFlux`, `nomFichier`.
- **`listeErreurTechnique[]`**: `natureErreur`, `codeErreur` (integer), `libelleErreur` — flux-level
  (irrecevabilité) technical errors.
- **`listeErreurDP[]`** (rejet at the demande de paiement / invoice level): `identifiantFournisseur`,
  `identifiantDestinataire`, `numeroDP`, `libelleErreurDP` (free-text motif).

→ This is the **CR motif source for guided correction (P3-1)**: surface `libelleErreur` /
`libelleErreurDP` per flux/DP, with the calling-method-scoped error code.

### 4.3 Other confirmed deposit/download codes
- `deposerPDFFacture`: PDF > 10 Mo → **413**.
- `telechargerGroupeFacture`: dossier > 120 Mo → **413**.
- Validation refusal motifs come from `recupererMotifsRefusFactureAValider` (separate enumerated list).

## 5. Impact on the backlog (now unblocked / refined)

- **P2-3 (CR object):** `consulterCR` (state + base64 PDF CR) and `consulterCRDetaille`
  (`listeErreurTechnique` + `listeErreurDP`) are the exact contracts to model.
- **P3-1 (error→remedy):** map `libelleErreur` / `libelleErreurDP` + method-scoped code → plain-language
  remedy; seed the catalog with the `deposerFluxFacture` 20000–20007 table above.
- **Validation (P2-5):** enforce `formatFlux`/`syntaxeFlux`/`formatDepot` enums and the **10/30 Mo** limit
  client-side before deposit (avoid 20001/20002/20007/413 round-trips).
- **Correction in code:** wherever "120 MB flux" appears, it must read **10 Mo / 30 Mo** for `deposerFluxFacture`.

## 6. Still not parsed / out of scope here (à vérifier)
- Full per-method I/O for the ~80+ services (only flux/CR/deposit detailed here).
- OAuth2 token **lifetime** (image-based OAuth2 fiche pratique — see `OAUTH2_CONNECTION_NOTES.md`).
- Production **quotas/rate limits** (PISTE dashboard).

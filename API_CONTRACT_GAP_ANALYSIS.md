# API Contract Gap Analysis — Chorus Pro / PISTE vs Chorus Pilot

> **Generated:** 2026-06-07 · **Phase 0**
> Compares **confirmed official contract facts** against **what the app already wires**, and lists
> what remains uncertain. Source ids → official docs (S) / repository (R). **No endpoint invented.**

## 1. Certainty legend
- ✅ **Confirmed** (official doc and/or repo)
- 🟨 **Partial** (named but schema/details not parsed)
- ❓ **À vérifier** (needs S7/S13 PDF or PISTE account)

## 2. Contract coverage matrix

| Capability | Official contract | App coverage | Gap / certainty |
|------------|-------------------|--------------|-----------------|
| OAuth2 token | ✅ `client_credentials` + `scope=openid` [S11] | ✅ `/api/chorus/oauth-token`, presets [R1] | Token **lifetime/refresh** ❓ |
| Required headers | ✅ Authorization + Content-Type UTF-8 + `cpro-account` [S11] | ✅ built server-side [R2] | None material |
| Deposit flux | ✅ `deposerFluxFacture`, ≤ 10 Mo non compressé / 30 Mo compressé [S8] | ✅ `/v1/deposer/flux`, `/api/chorus/flux/deposer`, G2B [R2,R3] | Request/response schema 🟨 [S7] |
| Deposit PDF (OCR) | ✅ `deposerPDFFacture` → `INTERPRETEE_OCR` [S9] | ✅ `/v1/deposer/pdf`, pdf-to-flux [R2] | OCR field map 🟨 |
| Submit invoice | ✅ `soumettreFacture` [S9] | ✅ `/v1/soumettre`, `/api/chorus/submit` [R2] | Payload schema 🟨 [S7] |
| Consult CR | ✅ `consulterCR` + `consulterCRDetaille` [S6/S13] | ✅ client + single/batch refresh bridge; state/error summary persisted in `chorus_flux_deposits` | Error → remedy catalog not implemented (P3-1) |
| Formats/syntaxes | ✅ `recuperer/formatflux|syntaxeflux` [R2] | ✅ `/api/chorus/flux/formats|syntaxes` [R2] | None material |
| Reference data | 🟨 tauxtva/devises/cadrefacturation/modedepot/... [R2] | 🟨 used in validation | Field-level schema 🟨 [S7] |
| Annuaire search | ✅ `rechercher/destinataire|serviceexecutant` [R2] | ✅ References + G2B validate [R2,R4] | Obligation rules detail ❓ |
| Invoice search | ✅ search by SIRET/VAT/framework/number/amount [S5] | ✅ `/api/chorus/invoices/supplier/search` [R2] | Pagination/params 🟨 |
| Invoice history | 🟨 lifecycle statuses [R5] | ✅ `/api/chorus/invoices/history` [R2] | Status source-of-truth ❓ |
| Reception (received invoices) | 🟨 traiter une facture [S9] | ✅ `/api/chorus/invoices/*`, ReceptionProcessing [R2] | Consult/complete schema 🟨 |
| Recycle / correct | 🟨 redeposit after reject [S6] | ✅ `/api/chorus/recycle`, `/validator/correct` [R2] | Exact correction contract ❓ |
| Transverses | 🟨 cross-cutting services [R2] | 🟨 partial | Path list ❓ [S7] |
| User account | ✅ `utilisateurs/consulter/compte`, rattachements [R2] | ✅ wired [R2] | Qualif-only caveat in code [R2] |

## 3. Material gaps to close (priority order)

1. **CR motif catalog → user remedies** 🟨 structure parsed and raw motifs persisted (V5.00):
   seed from `deposerFluxFacture` 20000–20007 + `consulterCRDetaille`
   `listeErreurTechnique` / `listeErreurDP`; plain-language fixes remain P3-1.
2. **Per-method request/response schemas** 🟨 — lock from S7/S13 to avoid `400`s.
3. **Token lifetime / refresh** ❓ — confirm in S4 PDF; implement refresh-on-401 regardless.
4. **Reference-data field schemas** 🟨 — for robust pre-deposit validation (TVA/devises/cadre).
5. **Production hosts (AIFE/RIE)** ❓ — confirm prod equivalents if RIE is in scope [S11].
6. **Rate limits / quotas** ❓ — not public; confirm on PISTE dashboard before bulk features.

## 4. What is genuinely "not visible publicly"
- The **PISTE catalog per-API list & technical pages** require authentication (only general platform
  description is public) [S2 + re-check 2026-06-07]. → catalog **metadata** public, **per-API detail**
  not. (Do not mark the whole platform inaccessible.)
- Production **quotas** and some prod host variants.

## 5. What is solid enough to build on now
- OAuth2 flow + headers + sandbox/prod app hosts ✅
- Core deposit/submit/CR/search endpoint **names & paths** ✅; CR refresh is wired locally
- Formats + 10 Mo / 30 Mo compressé limit ✅
- Flux states + invoice status classification ✅ ([CHORUS_FLOW_STATUSES.md])

> **Recommendation:** Phase-1 build can proceed on the ✅ items. Schedule a focused **S7/S13 PDF parse**
> to convert 🟨/❓ into ✅ before hardening error handling and reference-data validation.

## Sources
S2 PISTE catalog · S5 Rechercher factures · S6 Monitoring flows · S7/S13 Spéc. Externes (PARSED V5.00 → CHORUS_SPEC_EXTRACT.md) ·
S8 Submit flow · S9 Traiter facture · S11 Help for API developers OAuth2 · S12 Périmètre et prérequis ·
R1–R6 repository.

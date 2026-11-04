# API → Product Module Mapping — Chorus Pilot

> **Generated:** 2026-06-07 · **Skill:** api-doc-mapper
> Maps confirmed Chorus Pro / PISTE APIs (and this app's bridge) to product modules. Source ids
> refer to `context_sources.json`. Uncertain links are marked **[à vérifier]**.

## Mapping table

| Product module | Chorus Pro / PISTE APIs | App bridge | Status | Source |
|----------------|-------------------------|-----------|--------|--------|
| **Onboarding / connection** | PISTE OAuth2 token; `utilisateurs/consulter/compte`; `monCompte/recuperer/rattachements` | `/api/chorus/oauth-token` | Partially built (config + login) | R1, R2 |
| **Entity / account configuration** | `recuperer/structures/actives/fournisseur` | `/api/chorus/structures/active-destinataire` | Available to wire | R2 |
| **Organization / entity directory (annuaire)** | `rechercher/destinataire`, `rechercher/serviceexecutant`; `siret/info` | `/api/chorus/siret/info`, `/api/g2b/annuaire/validate-recipient`, `/api/chorus/annuaire/sync` | Built (References + G2B validate) | R2, R4 |
| **Invoice emission (create/submit)** | `deposer/pdf`, `soumettre` | `/api/chorus/submit` | Built | R2, S9 |
| **Dépôt de flux** | `deposer/flux` (deposerFluxFacture, ≤ 10 Mo non compressé / 30 Mo compressé) | `/api/chorus/flux/deposer`, `/api/g2b/flux/deposit` | Built (FluxDepositPage, G2B) | R2, R3, S8 |
| **Syntax / format validation** | `recuperer/formatflux`, `recuperer/syntaxeflux` | `/api/chorus/flux/detect`, `/flux/formats`, `/flux/syntaxes` | Built | R2 |
| **Business validation (pre-deposit)** | reference data: `recuperer/tauxtva`, `devises`, `cadrefacturation`; annuaire | `/api/chorus/flux/business-validate`, `/api/g2b/flux/business-validate` | Built | R2, R4 |
| **PDF → flux extraction** | `deposer/pdf` (OCR route) | `/api/chorus/pdf-to-flux/*` | Built (PdfToFluxPage) | R2, S9 |
| **Invoice reception** | reception/consult services (transverses) | `/api/chorus/invoices/*` | Built (ReceptionProcessing) | R2, S9 |
| **Status tracking (cycle de vie)** | `consulterCR`; invoice search/history | `/api/chorus/invoices/history`, `/api/g2b/flux/{uid}/status|poll` | Built | R3, R5, S6 |
| **Rejection / suspension correction** | `consulterCR` (motifs); recycle/resubmit | `/api/chorus/recycle`, `/api/chorus/validator/correct` | Partially built (EmissionRejections) | R2, S6 |
| **Reporting / statistics** | derived from invoice search results | (computed client-side) | Partial (Dashboard) — **flux-level stats not persisted [à vérifier]** | R5 |
| **Audit / logging** | n/a (app-side) | app monitoring | Built (Monitoring) | R2 |
| **Administration / configuration** | env presets, keys | settings/storage | Built (SettingsPage) | R1 |

## Reference-data services (enable validation UX)

These "recuperer/*" services are the backbone of **pre-deposit business validation** (the highest-value
module): VAT rates, currencies, billing frameworks, deposit modes, payment modes, bank details,
formats and syntaxes — all confirmed in repo [R2]. Pulling them live keeps the app aligned with
Chorus Pro without hard-coding rules.

## Lifecycle objects

- **Flux** (technical): 9 monitoring states via `consulterCR` [S6].
- **Invoice** (business): 60+ status codes mapped to success/warning/error/info in
  `src/lib/status-utils.ts` [R5]; portal-facing subset Brouillon/Rejetée/À recycler/Suspendue [S5].
- **Flux ↔ Invoice**: one flux → N invoices; complete vs partial rejection [S6].

## Gaps / not visible publicly

- Per-API scopes and full error catalogs → **[S7 PDF, à lire]**.
- No public "flux deposit history" endpoint surfaced → flux-level KPIs require app-side persistence.

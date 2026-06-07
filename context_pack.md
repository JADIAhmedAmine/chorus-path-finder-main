# Context Pack — Chorus Pro / PISTE ecosystem (for Chorus Pilot)

> **Generated:** 2026-06-07 · **Skill:** context-builder
> **⚠️ Objective inference:** The referenced `chorus_research_prompt.txt` was **not found** in the
> project. The objective was inferred from the codebase: *Chorus Pilot — a SaaS to pilot the
> deposit, validation, tracking and correction of electronic invoices / flux exchanged with
> Chorus Pro via PISTE for the French public sector (B2G)*. **Please confirm.**
> **Integrity:** confirmed facts cite a source id (S = official web source, R = repository source,
> see `context_sources.json`). Anything uncertain is marked **[à vérifier]**.

---

## 1. Executive summary

Chorus Pro is the mandatory French government platform (operated by **AIFE** — Agence pour
l'Informatique Financière de l'État) for **electronic invoicing to the public sector (B2G)**.
Suppliers and their operators submit invoices either through the portal, EDI, or **API**. Since
**January 2020, the API gateway is PISTE** (`piste.gouv.fr`), which fronts the Chorus Pro APIs
with **OAuth2** authentication [S4][R1].

A submission is carried as a **flux** (a structured file that may contain one or more invoices).
Chorus Pro returns a **compte rendu (CR)** describing technical receivability and business
integration, then drives each invoice through a rich **lifecycle of statuses** until payment [S6][R5].

**Chorus Pilot** sits on top of this ecosystem. Its value is **not** re-implementing Chorus Pro,
but giving non-technical users a guided, well-explained cockpit: deposit, pre-deposit validation
(format/SIRET/TVA/amounts/recipient), flux tracking, CR reading, rejection/suspension correction,
directory checks, and linkage between flux and invoices.

---

## 2. Official source map

| ID | Source | URL | What it confirms |
|----|--------|-----|------------------|
| S1 | PISTE portal | https://piste.gouv.fr/ | PISTE is the State API gateway; replaced legacy AIFE platform 01/2020 |
| S2 | PISTE API catalog | https://piste.gouv.fr/en/api-catalog | Catalog exists but list is JS-rendered/auth-gated → **not visible publicly** |
| S3 | Communauté — Documentation API | https://communaute.chorus-pro.gouv.fr/documentation/api/ | API service domains |
| S4 | Fiche pratique OAuth2 | https://communaute.chorus-pro.gouv.fr/documentation/fiche-pratique-reussir-son-raccordement-chorus-pro-en-mode-api-oauth2/ | OAuth2 raccordement since 01/2020 (details in PDF) |
| S5 | Rechercher factures | https://communaute.chorus-pro.gouv.fr/documentation/rechercher-une-ou-plusieurs-factures/ | Search criteria, invoice statuses, exports |
| S6 | Monitoring flows (CR) | https://communaute.chorus-pro.gouv.fr/documentation/monitoring-flows/?lang=en | `consulterCR`, 9 flow states, flux↔invoices |
| S7 | Spéc. Externes Annexe Services API (PDF) | https://communaute.chorus-pro.gouv.fr/wp-content/uploads/2019/12/Specifications_Externes_Annexe_Services_API_V4.14-bis.pdf | Authoritative API method catalog (**recommended deep read**) |
| S8 | Submit flow invoice | https://communaute.chorus-pro.gouv.fr/submit-flow-invoice/?lang=en | `deposerFluxFacture`: XML or PDF/A3, ≤ 10 Mo non compressé / 30 Mo compressé |
| S9 | Traiter une facture | https://communaute.chorus-pro.gouv.fr/documentation/traiter-une-facture/ | Recipient-side processing |
| R1–R6 | Repository | `src/lib/chorus/*`, `src/lib/g2b/*`, `src/lib/status-utils.ts` | Concrete endpoints, base URLs, status codes used by this app |

---

## 3. Domain actors

- **AIFE** — operator of Chorus Pro (DGFiP / Ministère de l'Économie). Defines flux formats, CR, statuses.
- **PISTE** — the State API gateway in front of Chorus Pro (OAuth2, rate limiting, app keys) [S1][R1].
- **Supplier (fournisseur)** — issues invoices to public entities; needs a Chorus Pro account.
- **Operator / éditeur (EDI / API)** — software like Chorus Pilot that deposits flux on behalf of suppliers (the "G2B" / Gateway-to-Business interface) [R3].
- **Public recipient (destinataire public)** — State, local authorities, public hospitals; identified by **SIRET + service exécutant** and possibly an **engagement juridique** [R4].
- **Validators (MOA/MOE)** — internal validation circuits on the recipient side, visible through statuses [R5].

---

## 4. Business processes

### 4.1 Flux deposit (emission)
1. Build/obtain a structured invoice file (UBL, CII, Factur-X / PDF/A-3) [R2].
2. Deposit via `deposerFluxFacture` (XML or PDF/A3, **≤ 10 Mo non compressé / 30 Mo compressé**) [S8].
3. Chorus Pro checks **technical receivability** of the flux, then **business integration** of each invoice [S6].
4. Read the **compte rendu (CR)** via `consulterCR` [S6][R6].
5. Track each invoice's lifecycle status until payment [S5][R5].

### 4.2 PDF route
`deposerPDFFacture` deposits a PDF, triggers OCR → status `INTERPRETEE_OCR`, then the invoice is
submitted via `soumettreFacture` [WebSearch/S9]. Chorus Pilot mirrors this with a guided
"PDF → flux" extraction that is **reviewed by the user before deposit** [repo: PdfToFluxPage].

### 4.3 Flux lifecycle (technical) — 9 states [S6]
Received · Processed SE CPP · Waiting for processing · In progress · Warning · Rejected ·
Waiting for reprocessing · Integrated · Partially integrated.
A flux carries **1..N invoices**; rejection can be **complete** (resubmit whole flux) or **partial**
(resubmit only erroneous invoices) [S6].

### 4.4 Invoice lifecycle (business)
Portal-level statuses include **Brouillon, Rejetée, À recycler, Suspendue** [S5]. The full machine
status set (60+ codes — e.g. `DEPOSEE`, `MISE_A_DISPOSITION`, `SUSPENDUE`, `REJETEE`, `A_RECYCLER`,
`MANDATEE`, `MISE_EN_PAIEMENT`, `COMPTABILISEE`…) and their success/warning/error/info classification
are encoded in `src/lib/status-utils.ts` [R5].

### 4.5 Directory (annuaire)
Before deposit, confirm the recipient via the **annuaire des structures publiques**: SIRET, active
flag, **service exécutant**, and obligations (**service code required**, **engagement required**,
service-or-engagement required, MOA-only) [R4]. App routes: `rechercher/destinataire`,
`rechercher/serviceexecutant` [R2].

---

## 5. API / technical map (summary — full detail in `api_*` files)

- **Gateway:** PISTE. **Auth:** OAuth2 bearer (PISTE) **+** Chorus Pro `cpro-account` (base64 `login:password`) header [R1][S4].
- **Sandbox base:** `https://sandbox-api.piste.gouv.fr/cpro/factures` · token `https://sandbox-oauth.piste.gouv.fr/api/oauth/token` [R1].
- **Production base:** `https://api.piste.gouv.fr/cpro/factures` · token `https://oauth.piste.gouv.fr/api/oauth/token` [R1].
- **Key endpoints (factures domain):** `/v1/deposer/flux`, `/v1/deposer/pdf`, `/v1/soumettre`, `/v1/consulterCR` [R6], `/v1/recuperer/formatflux`, `/v1/recuperer/syntaxeflux`, `/v1/rechercher/destinataire`, `/v1/rechercher/serviceexecutant`, `/v1/recuperer/tauxtva`, `/v1/recuperer/devises`, `/v1/recuperer/cadrefacturation` … [R2].
- **G2B operator interface (this app's backend bridge):** detect / business-validate / deposit / status / poll; code interfaces `FSO3110A`, `FSO3117A`, `FSO3300A`, `FSO6000A` [R3].

---

## 6. Regulatory timeline

- **2017** — Chorus Pro mandatory for largest companies (B2G).
- **2020-01** — PISTE becomes the API gateway for Chorus Pro [S4].
- **2017→2020** — phased B2G obligation down to micro-enterprises.
- **B2B e-invoicing reform (réforme de la facture électronique)** — phased obligation for domestic B2B with **PDP (Plateformes de Dématérialisation Partenaires)** and an annuaire/PPF. **[à vérifier — dates have shifted; confirm the current official calendar before relying on it].**

---

## 7. Product implications (for Chorus Pilot)

- **Guidance over raw data:** users need to *understand* flux/CR/statuses, not just see them → pedagogical cards & pipeline (already started in the Flux hub).
- **Pre-deposit validation reduces rejects:** SIRET/TVA/amount/number/recipient/service/engagement/format checks before deposit are the highest-value module [S5][R4].
- **Flux ↔ invoice linkage:** a flux holds N invoices with independent lifecycles → unified tracking is a differentiator [S6].
- **Directory-first UX:** confirming recipient obligations before deposit prevents a whole class of rejects [R4].
- **No new Chorus Pro rules invented:** all business text must cite PISTE / Chorus Pro-AIFE; uncertain rules marked "à vérifier".

---

## 8. Risks and constraints

- **PISTE catalog not publicly extractable** (JS/auth) → endpoint-level certainty relies on the
  Communauté PDFs [S7] and the repo [R2]. Some specifics remain **[à vérifier]**.
- **OAuth2 fine detail (grant type, scopes)** lives in a PDF not parsed here → **[à vérifier in S4 PDF]**.
- **Two-level auth** (PISTE token + Chorus Pro account) increases onboarding friction → onboarding UX matters.
- **10 Mo / 30 Mo compressé flux limit** [S8] and format conformance are hard constraints.
- **Regulatory dates** for B2B reform are volatile → never present as fixed without re-checking.
- **Status semantics** are numerous and circuit-dependent (MOA/MOE) → label carefully [R5].

---

## 9. Glossary

| Term | Meaning |
|------|---------|
| **AIFE** | State agency operating Chorus Pro |
| **PISTE** | State API gateway in front of Chorus Pro (OAuth2) |
| **Flux** | Structured file exchanged with Chorus Pro; carries 1..N invoices |
| **Flux entrant** | Invoice sent by supplier/operator to Chorus Pro |
| **Flux pivot** | Normalised data Chorus Pro transmits to the public recipient |
| **Flux retour** | Lifecycle statuses returned to supplier/operator |
| **Compte rendu (CR)** | Technical/business report of flux/invoice integration (`consulterCR`) |
| **G2B** | Gateway-to-Business: operator/EDI interface to deposit flux |
| **Engagement juridique** | Legal commitment number sometimes required by a recipient |
| **Service exécutant** | Recipient sub-service code |
| **Cadre de facturation** | Billing framework / invoice typology code |
| **MOA / MOE** | Validation circuits on the recipient side (statuses) |

---

## 10. Recommended next steps

1. **Confirm the objective** (since `chorus_research_prompt.txt` was missing).
2. **Deep-read the Spécifications Externes Annexe Services API PDF** [S7] to lock endpoint/parameter/error tables.
3. **Parse the OAuth2 fiche pratique PDF** [S4] to confirm grant type & scopes.
4. Re-verify the **B2B e-invoicing calendar** from the official source before any roadmap commitment.
5. Use `api_*` and product strategy files (this batch) to scope the MVP.

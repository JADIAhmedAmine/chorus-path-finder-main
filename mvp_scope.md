# MVP Scope — Chorus Pilot

> **Generated:** 2026-06-07 · **Skill:** product-strategy-mapper
> Scoped against confirmed APIs (`api_*`) and what already exists in the repo. Goal: a guided,
> rejection-reducing B2G invoicing cockpit. Source ids → `context_sources.json`.

## MVP thesis

> **Deposit fewer rejects, understand every status, recover fast** — with official, sourced guidance.

The MVP is **not** a Chorus Pro clone. It is the **guidance + prevention + linkage** layer on top of
confirmed Chorus Pro APIs.

## In scope (MVP)

| # | Module | Why in MVP | API basis | Repo status |
|---|--------|-----------|-----------|-------------|
| 1 | **Flux hub / cockpit** (`/flux`) | Single entry, orientation | derived | ✅ started |
| 2 | **Deposit flux** (XML/Factur-X) | Core action | `deposer/flux` [S8] | ✅ |
| 3 | **Format/syntax detection** | Prevent format rejects | `recuperer/formatflux`,`syntaxeflux` [R2] | ✅ |
| 4 | **Pre-deposit business validation** | Highest reject-reduction | `recuperer/tauxtva|devises|cadrefacturation` + annuaire [R2,R4] | ✅ partial |
| 5 | **Directory check** (recipient + service + engagement) | Prevent recipient rejects | `rechercher/destinataire|serviceexecutant` [R2,R4] | ✅ |
| 6 | **CR reading** (compte rendu) | Understand outcome | `consulterCR` [S6] | ⚠️ wire/clarify |
| 7 | **Invoice lifecycle tracking** | Visibility to payment | invoice search/history + `status-utils` [R5] | ✅ |
| 8 | **Rejection/suspension guided correction** | Recovery | `consulterCR` motifs + recycle [R2,S6] | ✅ partial |
| 9 | **PDF → flux (reviewed)** | Onboard PDF-only suppliers | `deposer/pdf` OCR [S9] | ✅ |
| 10 | **Pedagogy + official sources** | Trust & adoption | docs [S3–S9] | ✅ started |

## Out of scope (post-MVP)

- B2B / PDP-PPF reform support — **[à vérifier calendar]**.
- Advanced analytics & benchmarking.
- Multi-tenant operator console at scale.
- Automated bulk reconciliation across thousands of flux.
- Public flux-deposit history service (needs app-side persistence first).

## MVP acceptance criteria

1. A user can deposit a valid flux and **see the CR** with a plain-language outcome.
2. **Pre-deposit validation** blocks/warns on SIRET, TVA, amount, number, recipient, service/engagement, format.
3. Every shown status has a **plain explanation + recommended action**, sourced.
4. A reject/suspension yields a **clear next step**.
5. Directory check confirms recipient obligations **before** deposit.
6. All business text cites **PISTE / Chorus Pro-AIFE**; uncertain items marked "à vérifier".

## Key MVP assumptions to verify

- OAuth2 grant type/scopes (S4 PDF).
- Full reject/error catalog (S7 PDF).
- 10 Mo / 30 Mo compressé limit & accepted format/syntax matrix per environment (live `recuperer/*`).
- B2B reform timing (official source).

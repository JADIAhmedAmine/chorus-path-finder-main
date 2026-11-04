# Beta Scope — Chorus Pilot / InvoicePilot

> **Generated:** 2026-06-07 · Defines what the **beta** must do (and explicitly not do). Derived from
> `GAP_ANALYSIS.md`, `IMPLEMENTATION_BACKLOG.md`, `mvp_scope.md`. Realistic over perfect.

## 1. Beta thesis
A finance/AP user (supplier to the public sector) can **connect, deposit a flux, understand the compte
rendu and statuses, recover from a reject/suspension, and track invoices to payment** — guided, with
official sources cited.

## 2. In scope (must-have)

| Area | Beta requirement | Backlog |
|------|------------------|---------|
| Stabilisation | Build/boot/login/health all green | P0-1…P0-8 |
| Unified invoice UX | One card, one badge, one click model, émission/réception | P1-1…P1-7 |
| Flux cockpit | Real flux KPIs from persisted deposits | P2-1 |
| Connection | OAuth2 working + token refresh; env switch | P2-2, P2-4 |
| Compte rendu | CR readable per flux/invoice | P2-3 |
| Deposit | Flux + PDF→flux deposit with pre-deposit validation | (exists) + P2-5 |
| Guided correction | Error explanation + correct + redeposit | P3-1, P3-2, P3-3, P3-5 |
| Tracking | Invoice lifecycle statuses + history | (exists) |
| Onboarding | Wizard to first successful deposit | P4-2 |
| Admin | Roles + settings + entity config | P4-3, P4-4, P4-8 |
| Data out | CSV exports + basic stats | P4-6, P4-7 |
| Guidance | In-app help + official sources | P1-5, P4-9 |
| Ops | Security baseline, logging, backups, deploy, runbook | P5-1, P5-2/3, P5-5, P5-6, P5-8 |

## 3. Out of scope (post-beta)
- B2B / PDP-PPF reform support — **[à vérifier calendar]** (impots.gouv.fr).
- Advanced analytics/benchmarking; multi-tenant operator console at scale.
- Automated bulk reconciliation across thousands of flux.
- DB-backed audit migration (JSONL acceptable for beta) — optional.
- Fine-grained rate limiting (basic protection only in beta) — P5-4 is P3.

## 4. Beta acceptance criteria
1. **Stabilised:** `tsc` clean, `vite build` ok, migrations to head, compose healthy, auth/roles enforced.
2. **Unified UX:** every invoice surface uses the shared card/badge; statuses consistent.
3. **Real cockpit:** `/flux` shows actual deposit counts, errors, last deposit, success rate.
4. **Connection resilient:** expired token auto-refreshes; sandbox↔prod switch is explicit.
5. **CR readable:** after deposit, user sees receivability + per-invoice outcome in plain language.
6. **Recovery loop:** a reject/suspension yields a clear next step that can lead to a successful redeposit.
7. **Onboarding:** a new tenant reaches a first successful sandbox deposit via the wizard.
8. **Sourced guidance:** all business text cites PISTE / Chorus Pro-AIFE; uncertain rules "à vérifier".
9. **Ops baseline:** secrets server-side, structured logs, a tested DB restore, a deploy doc + runbook.

## 5. Known constraints carried into beta
- Flux deposit **≤ 10 Mo non compressé / 30 Mo compressé**; formats UBL/CII/Factur-X (read live) [OFFICIAL_API_CONTRACTS.md].
- **Qualification before production** [S12].
- CR motif catalog + per-method schemas pending **S7 PDF parse** → some explanations generic until then.
- PISTE production **quotas** unknown → conservative usage in beta.

## 6. Beta exit → GA candidates
- B2B/PDP readiness, advanced analytics, operator console, full rate limiting, DB audit, SSO.

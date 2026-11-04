# Product Roadmap — Chorus Pilot / InvoicePilot → Beta

> **Generated:** 2026-06-07 · Product-facing view. Sequencing & per-task detail live in
> `ROADMAP_TECHNICAL.md` and `IMPLEMENTATION_BACKLOG.md`. Scope in `BETA_SCOPE.md`.
> North star: **deposit fewer rejects, understand every status, recover fast — with sourced guidance.**

## Phase 0 — Stabilisation *(P0, ~1–2 wks)*
**Goal:** a green, reproducible baseline before adding value.
**User value:** the app builds, runs, and behaves predictably; no broken flows.
- Fix known frontend type errors; verify `vite build`.
- Verify backend tests, Docker compose up, Alembic migrations, auth/roles, health endpoints, env vars.
**Milestone:** "It builds, boots, logs in, and the health checks are green."

## Phase 1 — UX facture unifiée *(P1, ~2–4 wks)*
**Goal:** one coherent way to see and act on any invoice (émission or réception).
**User value:** users stop re-learning each screen; statuses & actions are consistent everywhere.
- Common `InvoiceCard` / `InvoiceListItem`; émission/réception distinction.
- Harmonized statuses & badges (single source = `status-utils.ts`).
- Contextual business actions; integrated guidance; dynamic click behavior.
- Consistent pages: traitées / rejetées / suspendues / à traiter.
**Milestone:** "Any invoice looks and acts the same across the app."

## Phase 2 — Couverture Chorus Pro / PISTE *(P1–P2, ~2–4 wks)*
**Goal:** close the API coverage gaps and make the flux cockpit real.
**User value:** real flux KPIs, reliable connection, visible compte rendu.
- **Expose flux deposit history (read endpoint) and wire the hub KPIs.**
- OAuth2 token refresh-on-401; sandbox/prod config UX.
- Surface `consulterCR` as a first-class object; annuaire polish.
**Milestone:** "The Flux hub shows real numbers and the CR is readable."

## Phase 3 — Correction guidée *(P1–P2, ~3–5 wks)*
**Goal:** turn rejects/suspensions into a guided fix.
**User value:** a non-technical user can understand a rejection and recover without support.
- Chorus error → plain-language explanation (extend the explainer).
- Guided XML/UBL/CII correction + redeposit; audit trail of corrections.
- Rejection & suspension management end-to-end.
**Milestone:** "A reject becomes a clear next step that leads to a successful redeposit."

## Phase 4 — Couche produit bêta *(P2, ~3–5 wks)*
**Goal:** the product wrapper that makes it usable by a real team.
**User value:** onboard, configure, operate, and report without hand-holding.
- Dashboard polish (+ flux KPIs); onboarding wizard; entity configuration.
- Roles UX; logs; statistics; exports; admin settings; in-app user guide.
**Milestone:** "A new customer can self-onboard and operate to first successful deposit."

## Phase 5 — Production readiness *(P2–P3, ~2–4 wks)*
**Goal:** safe to run for real customers.
**User value:** reliability, security, support.
- Security review; monitoring; structured logging; rate limits; DB backups.
- Deployment hardening (compose.prod + nginx); documentation; runbook.
**Milestone:** "We can deploy, observe, recover, and support the beta."

## Cross-cutting principles
- All business text **sourced** (PISTE / Chorus Pro-AIFE); uncertain rules marked "à vérifier".
- Respect API constraints (**10 Mo / 30 Mo compressé** flux, formats, qualification-before-prod) [see `OFFICIAL_API_CONTRACTS.md`].
- Secrets server-side only; never log `cpro-account`/tokens.
- Ship a **realistic beta**, not a perfect product: prioritize the deposit→CR→correction→payment loop.

## Beta definition of done (summary)
1. Stabilized baseline (Phase 0). 2. Unified invoice UX (Phase 1). 3. Real flux cockpit + CR (Phase 2).
4. Guided correction loop (Phase 3). 5. Onboarding + admin + exports (Phase 4). 6. Prod-ready ops (Phase 5).

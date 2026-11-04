# Implementation Backlog — Chorus Pilot → Beta

> **Generated:** 2026-06-07 · Canonical per-task list. Each task carries: objectif · valeur utilisateur ·
> fichiers · FE/BE/DB tasks · dépendances API · complexité (low/med/high) · risque (low/med/high) ·
> priorité (P0–P3) · critères d'acceptation. File paths are real repo paths. APIs are confirmed
> (see `OFFICIAL_API_CONTRACTS.md` / `API_TO_FEATURE_MAPPING.md`); uncertainties marked **[à vérifier]**.

---

## PHASE 0 — Stabilisation (P0)

### P0-1 · Fix frontend type errors
- **Objectif:** clean `tsc` (40 pre-existing errors in untouched files: reception cards, storage, InvoiceNotifications, tests).
- **Valeur:** reliable builds, no hidden runtime bugs.
- **Fichiers:** `src/components/chorus/*`, `src/lib/chorus/storage.ts`, `src/pages/InvoiceNotifications.tsx`, `src/pages/ReceptionProcessing.tsx`, `src/test/*`.
- **FE:** resolve type mismatches (ReceptionConsult union, SyncRunSummary props, predicates). **BE:** none. **DB:** none.
- **Dépendances API:** none. **Complexité:** med · **Risque:** low · **Priorité:** P0.
- **Acceptation:** `tsc -p tsconfig.app.json --noEmit` → 0 errors.

### P0-2 · Verify frontend build
- **Objectif:** `vite build` passes and produces `dist/`.
- **Valeur:** deployable artifact.
- **Fichiers:** `vite.config.ts`, `package.json`.
- **FE:** run build in CI; fix bundling issues. **Complexité:** low · **Risque:** low · **Priorité:** P0.
- **Acceptation:** `npm run build` exits 0; app loads from `dist/`.

### P0-3 · Verify backend tests
- **Objectif:** backend test suite + frontend vitest pass.
- **Fichiers:** `tests/`, `src/test/*`, `vitest.config.ts`.
- **BE:** run pytest (if present) / scripts; **FE:** `npm run test`. **Complexité:** med · **Risque:** med · **Priorité:** P0.
- **Acceptation:** test commands green or known-skips documented.

### P0-4 · Verify Docker compose
- **Objectif:** `docker compose up` brings postgres + api + frontend + nginx healthy.
- **Fichiers:** `docker-compose.yml`, `Dockerfile.backend`, `Dockerfile.frontend`, `docker/nginx/default.conf`.
- **BE/infra:** validate healthchecks (`/health`, `pg_isready`), env wiring (`DATABASE_URL`). **Complexité:** med · **Risque:** med · **Priorité:** P0.
- **Acceptation:** all services healthy; frontend reaches api; api reaches db.

### P0-5 · Verify Alembic migrations
- **Objectif:** clean upgrade head on a fresh DB; single head.
- **Fichiers:** `alembic/`, `alembic/versions/*` (incl. `e7a4bd3e24d6_merge_alembic_heads.py`).
- **BE/DB:** `alembic upgrade head`; confirm merged heads resolve. **Complexité:** low · **Risque:** med · **Priorité:** P0.
- **Acceptation:** fresh DB migrates to head with no error; `alembic heads` shows one.

### P0-6 · Verify auth / roles
- **Objectif:** login + role gates work (DEPOSANT/GESTIONNAIRE/ADMINISTRATEUR/AUDITEUR).
- **Fichiers:** `chorus_python/auth.py`, `config/auth-users.json`, `src/lib/auth/session.ts`.
- **BE:** confirm `require_auth/require_admin/require_submit_permission`. **FE:** session/role gating in `App.tsx`/sidebar. **Complexité:** low · **Risque:** med · **Priorité:** P0.
- **Acceptation:** unauthorized → 401/redirect; submit gated to SUBMIT_ROLES; admin-only routes gated.

### P0-7 · Verify health endpoints
- **Objectif:** `/health` (api) and `/api/g2b/health` reachable; used by container healthcheck.
- **Fichiers:** `scripts/chorus_submit_server.py`, `chorus_python/g2b_routes_flux.py`.
- **Acceptation:** 200 + minimal payload; Docker healthcheck green. **Complexité:** low · **Risque:** low · **Priorité:** P0.

### P0-8 · Verify environment variables
- **Objectif:** document & validate required env (huge `.env.example`).
- **Fichiers:** `.env.example`, `chorus_python/config.py`, `chorus_python/g2b_config.py`, `src/lib/chorus/storage.ts`.
- **BE:** fail-fast on missing critical vars; **FE:** `VITE_*` documented. **Complexité:** low · **Risque:** med · **Priorité:** P0.
- **Acceptation:** a `.env` checklist; app refuses to boot with missing critical secrets (clear message).

---

## PHASE 1 — UX facture unifiée (P1)

### P1-1 · Common InvoiceCard / InvoiceListItem
- **Objectif:** one reusable card+row used by every invoice surface.
- **Valeur:** consistency; faster future changes.
- **Fichiers:** new `src/components/invoice/InvoiceCard.tsx` + `InvoiceListItem.tsx`; refactor `src/pages/InvoiceList.tsx`, `InvoicesToProcess.tsx`, `EmissionRejections.tsx`, `ReceptionProcessing.tsx`; reuse `src/components/flux/InvoiceSummaryCard.tsx`.
- **FE:** build components from `Invoice` type; adopt in pages. **BE/DB:** none.
- **Dépendances API:** `/api/db/invoices`. **Complexité:** high · **Risque:** med · **Priorité:** P1.
- **Acceptation:** all invoice lists render the shared component; visual + behavior parity; no regression.

### P1-2 · Émission / réception distinction
- **Objectif:** a clear direction indicator everywhere.
- **Fichiers:** `InvoiceCard`, `src/lib/chorus/invoiceRecords.ts`, reception classification in `rawPayload`.
- **FE:** derive direction (emission vs reception) reliably; badge. **Complexité:** med · **Risque:** med · **Priorité:** P1.
- **Acceptation:** every invoice shows correct direction; reception vs emission never confused.

### P1-3 · Harmonized statuses & badges
- **Objectif:** single status source + one badge component.
- **Fichiers:** `src/lib/status-utils.ts` (source), unify `src/components/common/StatusBadge.tsx`, `src/components/chorus/ChorusStatusBadge.tsx`, `InvoiceStatusBadge.tsx`.
- **FE:** consolidate to one badge using `getChorusRawStatusConfig`; deprecate duplicates. **Complexité:** med · **Risque:** med · **Priorité:** P1.
- **Acceptation:** one badge component; identical color/label for a given status across pages.

### P1-4 · Business actions on cards
- **Objectif:** contextual actions (Voir détail / Corriger / Suivre / Compléter / Voir facture).
- **Fichiers:** `InvoiceCard`, `src/components/chorus/InvoiceActionGuide.tsx`, `actionableInvoices.ts`.
- **FE:** action set derived from status; **BE:** reuse recycle/complete/correct endpoints.
- **Dépendances API:** `{RECYCLE_PATH}`, `{RECEPTION_COMPLETE_PATH}`, `{CORRECT_VALIDATOR_PATH}`. **Complexité:** med · **Risque:** med · **Priorité:** P1.
- **Acceptation:** actions match status semantics; disabled when not applicable.

### P1-5 · Integrated guidance
- **Objectif:** reuse `ProcessExplanationCard` consistently on invoice pages.
- **Fichiers:** `src/components/flux/ProcessExplanationCard.tsx`, `src/lib/flux/content.ts`, invoice pages.
- **FE:** add page-level explanation where missing. **Complexité:** low · **Risque:** low · **Priorité:** P1.
- **Acceptation:** every Chorus page has a sourced explanation card.

### P1-6 · Dynamic click behavior
- **Objectif:** consistent click model (row → detail; explicit action buttons for actions).
- **Fichiers:** `InvoiceListItem`, list pages, `src/pages/InvoiceDetail.tsx`, `ChorusInvoiceDetail.tsx`.
- **FE:** unify navigation; keyboard accessible. **Complexité:** med · **Risque:** low · **Priorité:** P1.
- **Acceptation:** clicking a row opens detail everywhere; actions never trigger accidental navigation.

### P1-7 · Consistent processed/rejected/suspended/to-process pages
- **Objectif:** these four pages share layout, filters, and card.
- **Fichiers:** `ReceptionProcessing.tsx` (+`ProcessedReceptionInvoices`), `EmissionRejections.tsx`, `InvoicesToProcess.tsx`.
- **FE:** adopt shared components + filters. **Complexité:** med · **Risque:** med · **Priorité:** P1.
- **Acceptation:** consistent UX; same card/badge/actions; filters behave identically.

---

## PHASE 2 — Couverture Chorus Pro / PISTE (P1–P2)

### P2-1 · GET flux deposits (list + stats) — **top gap** · ✅ IMPLEMENTED (2026-06-07)
- **Objectif:** expose persisted flux deposits for the hub.
- **Valeur:** real "flux déposés / flux en erreur / dernier dépôt / taux de succès".
- **Fichiers:** `chorus_python/chorus_flux_routes.py`, `chorus_python/db/repositories.py`, `db/api.py`, new FE `src/lib/flux/fluxDepositsService.ts`, wire `src/pages/FluxHub.tsx`.
- **BE:** add `GET /api/chorus/flux/deposits` (paginated) + `GET .../deposits/stats` reading `chorus_flux_deposits` (`status_local`, `code_retour`, `date_depot`, `numero_flux_depot`, `created_at`), tenant-scoped, `require_auth`. **DB:** reuse existing table/indexes (no migration needed). **FE:** replace hub placeholders with real KPIs + `FluxSummaryCard` list.
- **Dépendances API:** none external (reads local DB). **Complexité:** med · **Risque:** low · **Priorité:** P1.
- **Acceptation:** hub shows real counts; deposits list paginates; tenant isolation enforced.

### P2-2 · OAuth2 token refresh-on-401
- **Objectif:** transparent token renewal.
- **Fichiers:** `chorus_python/client.py`, `scripts/chorus_submit_server.py` (OAUTH_TOKEN_PATH), `src/lib/chorus/client.ts`.
- **BE:** cache token per env; refresh on expiry/401 then retry once. **Dépendances API:** `/api/oauth/token` (client_credentials, scope openid) [S11]. **Complexité:** med · **Risque:** med · **Priorité:** P1.
- **Acceptation:** expired token auto-renews; no user-visible 401 on valid creds. Token lifetime **[à vérifier S4]**.

### P2-3 · Surface compte rendu (`consulterCR`) as a first-class object · ✅ IMPLEMENTED (2026-06-07)
- **Objectif:** make the CR readable per flux/invoice.
- **Fichiers:** `chorus_python/chorus_cr.py`, `chorus_flux_client.py`, `chorus_flux_routes.py`,
  `db/entities.py`, `db/repositories.py`, migration `20260607_0005`, `FluxHub.tsx`,
  `fluxDepositsService.ts`.
- **BE:** `consulterCRDetaille` + fallback `consulterCR`; normalize the 9 official states,
  `listeErreurTechnique` and `listeErreurDP`; persist CR summary; expose single/batch refresh endpoints;
  stats prioritize persisted `etat_courant_flux`.
- **FE minimal:** discreet batch “Actualiser les CR” action with loading/error states and KPI refresh.
- **Dépendances API:** `/v1/consulterCR`, `/v1/consulterCRDetaille` [S6/S13].
- **Acceptation:** CR data is persisted and returned per deposit; hub KPIs can be refreshed without a real
  Chorus call in tests. Rich per-invoice CR detail/remedy UX is intentionally deferred to P3-1.

### P2-4 · Sandbox/prod config UX
- **Objectif:** clear environment switch + status indicator.
- **Fichiers:** `src/pages/SettingsPage.tsx`, `src/lib/chorus/storage.ts` (presets), sidebar env badge.
- **FE:** environment selector + validation; **BE:** none. **Complexité:** low · **Risque:** med · **Priorité:** P2.
- **Acceptation:** switching env updates token/API base; prod requires explicit confirmation.

### P2-5 · Annuaire polish
- **Objectif:** tighten recipient obligation checks before deposit.
- **Fichiers:** `chorus_python/g2b_routes_annuaire.py`, `src/pages/References.tsx`, `src/lib/g2b/g2bAnnuaireApi.ts`.
- **FE/BE:** clearer service/engagement requirements surfacing. **Dépendances API:** `validate-recipient`, `rechercher/serviceexecutant`. **Complexité:** low · **Risque:** low · **Priorité:** P2.
- **Acceptation:** deposit warns/block when required service/engagement missing.

---

## PHASE 3 — Correction guidée (P1–P2)

### P3-0 · Règle métier « À recycler » · ✅ CORRIGÉ (2026-06-07)
- **Objectif:** distinguer strictement rejet, suspension, recyclage et facture intégrée.
- **Fichiers:** `chorus_python/recycle_policy.py`, `chorus_python/service.py`, `scripts/chorus_submit_server.py`, `src/pages/ChorusInvoiceDetail.tsx`, `src/lib/chorus/invoiceStatusGuide.ts`, `src/lib/chorus/submissionState.ts`.
- **Règles:** `REJETEE` → nouvelle facture corrigée avec nouveau numéro ; `SUSPENDUE` → complément/commentaire/pièce jointe ; `A_RECYCLER` → SIRET destinataire, code service et engagement/bon de commande uniquement ; `INTEGREE` → lecture seule.
- **BE:** liste blanche stricte avant `/factures/v1/recycler`; rejet des montants, TVA, lignes, fournisseur, numéro de facture et métadonnées libres. **FE:** formulaire limité aux données d’acheminement; retrait de `A_RECYCLER` de la soumission générique.
- **Acceptation:** les trois corrections d’acheminement sont acceptées; montant, TVA et numéro de facture sont refusés avant tout appel Chorus.

### P3-1 · Chorus error → plain explanation
- **Objectif:** every reject/suspension motif gets a human explanation + remedy.
- **Fichiers:** `chorus_python/g2b_error_explainer.py`, `chorus_python/errors.py`, `src/lib/chorus/invoiceStatusGuide.ts`, `status-utils.ts`.
- **BE:** extend explainer with CR motif catalog; **FE:** show explanation + recommended action. **Dépendances API:** `consulterCR` motifs [S7 — **à parser**]. **Complexité:** high · **Risque:** med · **Priorité:** P1.
- **Acceptation:** known motifs render a clear remedy; unknown → safe generic guidance + source link.

### P3-2 · Guided XML/UBL/CII correction
- **Objectif:** fix structured data before redeposit.
- **Fichiers:** `chorus_python/chorus_flux_routes.py` (`prepare-correction`), `chorus_python/chorus_ubl_generator.py`, FE `src/pages/PdfToFluxPage.tsx` / new correction view.
- **FE/BE:** field-level correction + regenerate XML + re-validate. **Dépendances API:** `recuperer/*` reference data, `deposer/flux`. **Complexité:** high · **Risque:** high · **Priorité:** P2.
- **Acceptation:** user corrects flagged fields, regenerates a conformant flux, re-validates before deposit.

### P3-3 · Redeposit / recyclage flow
- **Objectif:** proposer deux parcours distincts sans confondre rejet et recyclage.
- **Fichiers:** `{RECYCLE_PATH}` handler, `src/pages/EmissionRejections.tsx`.
- **FE/BE:** `REJETEE` → nouvelle facture avec nouveau numéro puis nouveau dépôt; `A_RECYCLER` → correction d’acheminement via `recycler` sur la facture existante. **Dépendances API:** recycle + `deposer/flux`. **Complexité:** med · **Risque:** med · **Priorité:** P2.
- **Acceptation:** chaque statut emprunte son parcours dédié; le nouveau flux d’une facture rejetée est suivi sans transformer une facture à recycler en nouvelle facture.

### P3-4 · Audit trail of corrections
- **Objectif:** record who corrected/redeposited what.
- **Fichiers:** `chorus_python/audit.py`, `config/audit-log.jsonl` (or DB-backed), `src/pages/AuditPage.tsx`, `Monitoring.tsx`.
- **BE/DB:** append structured events; optionally a DB table. **Complexité:** med · **Risque:** low · **Priorité:** P2.
- **Acceptation:** every correction/redeposit produces an auditable, queryable event.

### P3-5 · Rejection & suspension management
- **Objectif:** unified workqueue for rejects + suspensions.
- **Fichiers:** `EmissionRejections.tsx`, `ReceptionProcessing.tsx`, `CompleteSuspendedInvoiceCard.tsx`.
- **FE:** consolidated actionable queue. **Dépendances API:** `RECEPTION_COMPLETE`, recycle. **Complexité:** med · **Risque:** med · **Priorité:** P1.
- **Acceptation:** a single place lists everything needing action with the right next step.

---

## PHASE 4 — Couche produit bêta (P2)

### P4-1 · Dashboard polish + flux KPIs
- **Objectif:** add flux-level KPIs to the dashboard.
- **Fichiers:** `src/pages/Dashboard.tsx`, `chorus_python/db/api.py` (`dashboard/summary`), reuse P2-1.
- **FE/BE:** include deposit stats. **Complexité:** low · **Risque:** low · **Priorité:** P2.
- **Acceptation:** dashboard shows deposits + reject rate alongside invoice KPIs.

### P4-2 · Onboarding wizard
- **Objectif:** guide a new tenant from zero to first deposit.
- **Fichiers:** new `src/pages/Onboarding.tsx`, `SettingsPage.tsx`, `chorus_python/auth.py`/config.
- **FE/BE:** steps — PISTE app (case-sensitive name) + Chorus structure + technical user + env test. **Dépendances API:** oauth token, `consulter/compte` [S12]. **Complexité:** high · **Risque:** med · **Priorité:** P2.
- **Acceptation:** wizard verifies credentials in sandbox and reaches a first successful test call.

### P4-3 · Entity configuration
- **Objectif:** manage supplier structures & defaults.
- **Fichiers:** `SettingsPage.tsx`, `recuperer/structures` route, `src/lib/references/*`.
- **FE/BE:** select/persist active supplier structure & defaults. **Complexité:** med · **Risque:** low · **Priorité:** P2.
- **Acceptation:** configured structure is used by deposits/searches.

### P4-4 · Roles UX (admin)
- **Objectif:** manage users/roles in-app (admin).
- **Fichiers:** `chorus_python/auth.py`, `config/auth-users.json` (or DB), new admin screen.
- **FE/BE:** CRUD users + roles (admin only). **Complexité:** med · **Risque:** med · **Priorité:** P2.
- **Acceptation:** admin manages users/roles; gates enforced server-side.

### P4-5 · Logs · P4-6 Statistics · P4-7 Exports · P4-8 Admin settings
- **Objectif:** operational visibility + data out + configuration.
- **Fichiers:** `Monitoring.tsx`, `AuditPage.tsx`, `Dashboard.tsx` (CSV export already in `InvoiceList.tsx`), `SettingsPage.tsx`.
- **FE/BE:** structured logs view; stats; CSV/Excel exports; admin config. **Complexité:** med · **Risque:** low · **Priorité:** P2.
- **Acceptation:** logs/stats visible; exports download; settings persist.

### P4-9 · In-app user guide
- **Objectif:** contextual help + glossary, sourced.
- **Fichiers:** reuse `ProcessExplanationCard`, `OfficialSourcesBox`, `src/lib/flux/content.ts`, new `docs/USER_GUIDE.md`.
- **FE:** help center page. **Complexité:** low · **Risque:** low · **Priorité:** P3.
- **Acceptation:** users find guidance for each step with official source links.

---

## PHASE 5 — Production readiness (P2–P3)

### P5-1 · Security hardening
- **Objectif:** safe secrets, headers, CORS, input validation.
- **Fichiers:** `scripts/chorus_submit_server.py` (middleware), `chorus_python/config.py`, nginx conf.
- **BE:** CORS allowlist, security headers, no secret logging, validate uploads. **Complexité:** med · **Risque:** high · **Priorité:** P2.
- **Acceptation:** security checklist passes; no secret in logs; CORS restricted.

### P5-2 Monitoring · P5-3 Logging
- **Objectif:** observe health/errors.
- **Fichiers:** server middleware, `Monitoring.tsx`, infra.
- **BE/infra:** structured JSON logs, error tracking, uptime/health dashboards. **Complexité:** med · **Risque:** med · **Priorité:** P2.
- **Acceptation:** errors/latency observable; alerts on health failures.

### P5-4 · Rate limits
- **Objectif:** protect gateway quotas & app.
- **Fichiers:** nginx / API middleware.
- **BE/infra:** per-route/tenant throttling; respect PISTE quotas **[à vérifier]**. **Complexité:** med · **Risque:** med · **Priorité:** P3.
- **Acceptation:** abusive bursts throttled; PISTE quota not exceeded.

### P5-5 Backups · P5-6 Deployment · P5-7 Docs · P5-8 Runbook
- **Objectif:** recover, deploy, operate.
- **Fichiers:** `docker-compose.prod.yml`, `docker/nginx/default.conf`, `README.md`, new `docs/RUNBOOK.md`, pg backup scripts.
- **Infra:** automated pg backups + restore test; prod deploy guide; incident runbook. **Complexité:** med · **Risque:** high · **Priorité:** P2.
- **Acceptation:** documented deploy; tested restore; runbook covers top incidents.

---

## Quick index (priority × phase)

| Phase | P0 | P1 | P2 | P3 |
|-------|----|----|----|----|
| 0 Stabilisation | P0-1…P0-8 | | | |
| 1 UX unifiée | | P1-1…P1-7 | | |
| 2 Couverture API | | P2-1, P2-2 | P2-3, P2-4, P2-5 | |
| 3 Correction guidée | | P3-1, P3-5 | P3-2, P3-3, P3-4 | |
| 4 Couche bêta | | | P4-1…P4-8 | P4-9 |
| 5 Prod readiness | | | P5-1, P5-2, P5-3, P5-5, P5-6, P5-7, P5-8 | P5-4 |

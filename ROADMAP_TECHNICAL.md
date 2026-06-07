# Technical Roadmap — Chorus Pilot → Beta

> **Generated:** 2026-06-07 · Sequencing, dependencies, and milestones. Full per-task detail (objectif,
> valeur, fichiers, FE/BE/DB, API deps, complexité, risque, priorité, acceptation) lives in
> `IMPLEMENTATION_BACKLOG.md` (task IDs `P{phase}-{n}` referenced here). Stack: React/Vite/TS +
> FastAPI + PostgreSQL/SQLAlchemy/Alembic + Docker/nginx.

## Dependency graph (high level)

```
P0 (stabilise) ──┬─> P1 (unified invoice UX) ──┬─> P3 (guided correction)
                 │                              │
                 └─> P2 (API coverage) ─────────┴─> P4 (beta layer) ──> P5 (prod readiness)
P2-1 (flux deposits read) ──> P4-1 (dashboard flux KPIs)
P2-3 (consulterCR object) ──> P3-1 (error explanations)
S7 PDF parse ──> P2-3, P3-1 (motif catalog)   [external research dependency]
```

## Phase 0 — Stabilisation *(P0)*
- **Tasks:** P0-1 (tsc), P0-2 (build), P0-3 (tests), P0-4 (compose), P0-5 (migrations), P0-6 (auth/roles), P0-7 (health), P0-8 (env).
- **Tech focus:** `tsconfig.app.json` errors; `vite build`; `alembic upgrade head` (merged heads); container healthchecks (`/health`, `pg_isready`).
- **Exit/milestone:** green build + boot + login + health; reproducible `docker compose up`.
- **Risk:** medium (migrations/tests unknown until run).

## Phase 1 — UX facture unifiée *(P1)*
- **Tasks:** P1-1 (InvoiceCard/ListItem), P1-2 (direction), P1-3 (status/badges), P1-4 (actions), P1-5 (guidance), P1-6 (click model), P1-7 (page consistency).
- **Tech focus:** new `src/components/invoice/*`; collapse `StatusBadge`/`ChorusStatusBadge`/`InvoiceStatusBadge` onto `status-utils.ts`; adopt across `InvoiceList`, `InvoicesToProcess`, `EmissionRejections`, `ReceptionProcessing`.
- **Depends on:** P0. **Milestone:** one card + one badge + one click model everywhere.
- **Risk:** medium (broad refactor across pages) → do behind the shared component, page by page.

## Phase 2 — Couverture Chorus Pro / PISTE *(P1–P2)*
- **Tasks:** P2-1 (flux deposits read — **unblocks hub KPIs**), P2-2 (token refresh), P2-3 (consulterCR object), P2-4 (env UX), P2-5 (annuaire polish).
- **Tech focus:** new `GET /api/chorus/flux/deposits` + `/stats` over `chorus_flux_deposits` (no migration); `client.py` token cache/refresh; CR normalization.
- **Depends on:** P0; P2-1 independent of P1. **External:** S7 PDF parse for motif catalog (feeds P2-3/P3-1).
- **Milestone:** Flux hub shows real numbers; CR readable; auth resilient.
- **Risk:** medium (CR schema not fully parsed → `[à vérifier S7]`).

## Phase 3 — Correction guidée *(P1–P2)*
- **Tasks:** P3-1 (error→explanation), P3-2 (XML/UBL/CII correction), P3-3 (redeposit), P3-4 (audit), P3-5 (reject/suspension queue).
- **Tech focus:** extend `g2b_error_explainer.py`/`errors.py`/`invoiceStatusGuide.ts`; `prepare-correction` + `chorus_ubl_generator.py`; `{RECYCLE_PATH}` flow; audit events.
- **Depends on:** P1 (unified UI), P2-3 (CR object). **Milestone:** reject → guided fix → successful redeposit.
- **Risk:** high (structured XML correction; motif coverage depends on S7).

## Phase 4 — Couche produit bêta *(P2)*
- **Tasks:** P4-1 (dashboard+flux KPIs), P4-2 (onboarding wizard), P4-3 (entity config), P4-4 (roles UX), P4-5/6/7/8 (logs/stats/exports/admin), P4-9 (user guide).
- **Tech focus:** onboarding verifies PISTE app (case-sensitive) + Chorus technical user [S12]; admin user/role management; exports.
- **Depends on:** P2-1 (KPIs), P0-6 (roles). **Milestone:** self-serve onboarding to first deposit.
- **Risk:** medium.

## Phase 5 — Production readiness *(P2–P3)*
- **Tasks:** P5-1 (security), P5-2/3 (monitoring/logging), P5-4 (rate limits), P5-5 (backups), P5-6 (deploy), P5-7 (docs), P5-8 (runbook).
- **Tech focus:** CORS/security headers in server middleware; structured logs; pg backup+restore test; `docker-compose.prod.yml` + nginx hardening; runbook.
- **Depends on:** P4. **Milestone:** deployable, observable, recoverable beta.
- **Risk:** high (security + ops are release-blocking).

## External / research dependencies
- **S7/S13 spec PDF parse** → CR motif catalog, per-method schemas, error tables (feeds P2-3, P3-1, P3-2).
- **S4 OAuth2 PDF** → token lifetime/refresh confirmation (feeds P2-2).
- **PISTE dashboard** → production quotas/rate limits (feeds P5-4).

## Suggested execution order (critical path)
`P0 → P1-1/P1-3 → P2-1 → P3-1/P3-5 → P3-2/P3-3 → P4-2/P4-1 → P5-1/P5-6`
(others parallelizable: P2-2, P2-4, P2-5, P4-3..8 as capacity allows.)

# Gap Analysis — current state vs Chorus Pilot beta

> **Generated:** 2026-06-07 · Grounded in the real repo + Phase-0 research (`OFFICIAL_API_CONTRACTS.md`,
> `CHORUS_FLOW_STATUSES.md`, `CHORUS_ERROR_HANDLING.md`, `API_CONTRACT_GAP_ANALYSIS.md`).
> Legend — ✅ exists · 🟨 partial · ❌ missing · ❓ uncertain (à vérifier).

## 1. Architecture (as built)

| Layer | Stack | Evidence |
|-------|-------|----------|
| Frontend | React 18 + Vite + TS + Tailwind + shadcn/ui + React Query | `package.json`, `src/` |
| Backend | FastAPI (`scripts/chorus_submit_server.py`, "Chorus Path Finder API v2.0", port 8008) | server file |
| DB | PostgreSQL 16 + SQLAlchemy 2.0 + Alembic | `chorus_python/db/`, `alembic/` |
| Auth | JWT (pyjwt) + bcrypt, config-file users, roles | `chorus_python/auth.py`, `config/auth-users.json` |
| Infra | Docker (api/frontend/postgres) + nginx | `docker-compose*.yml`, `docker/nginx/` |
| Scheduler | apscheduler (sync runs) | `chorus_python/db/scheduler.py` |

## 2. Backend coverage (confirmed routes)

✅ **Strong already:** auth (`/api/auth/*`), DB read + sync (`/api/db/*`, `/sync/*`, `/dashboard/summary`),
flux detect/validate/deposit/formats/syntaxes/guide/prepare-correction (`/api/chorus/flux/*`),
PDF→flux extract/generate/validate/deposer (`/api/chorus/pdf-to-flux/*`), G2B flux + annuaire
(`/api/g2b/*`), reception consult/process/complete/download, invoice history/download, SIRET info,
active recipient structures, sync annuaire, **submit / recycle / correct-validator**, OAuth token bridge.

🟨 **Partial / to surface:** `consulterCR` is referenced but the **compte rendu is not yet a first-class
UI object**; `prepare-correction` exists but the guided XML/UBL/CII correction UX is thin.

❌ **Missing endpoints:**
- **GET flux deposits (list + stats)** — deposits ARE persisted (`chorus_flux_deposits` via
  `record_flux_deposit` in `chorus_python/chorus_flux_routes.py`) but **no read endpoint exists** →
  the hub's "flux déposés / flux en erreur / dernier dépôt" cannot be wired. **This is the #1 backend gap.**

## 3. Frontend coverage

✅ Dashboard, InvoiceList, reception/emission pages, deposit pages, PDF→flux, References (annuaire),
rejections, new Flux hub (`/flux`) + reusable Flux components.

🟨 **Inconsistencies to unify (Phase 1):**
- Three status badges coexist: `StatusBadge`, `ChorusStatusBadge`, `InvoiceStatusBadge`, plus the new
  `InvoiceSummaryCard`/`FluxSummaryCard`. → harmonize on `status-utils.ts` as the single source.
- No single `InvoiceCard` / `InvoiceListItem` reused across emission/reception/rejections/suspended.
- Click behavior differs per page (row → detail vs action).

❌ **Hub KPIs flux-level** show "Pas encore de données disponibles" → blocked on the missing GET endpoint.

## 4. Data model

✅ Entities: `Tenant, Supplier, PublicCustomer, PublicService, Invoice, InvoiceLine, SyncRun,
ChorusFluxDeposit` (`chorus_python/db/entities.py`). 6 Alembic migrations incl. a merged head.

🟨 `ChorusFluxDeposit` has the fields needed for KPIs (`status_local`, `code_retour`, `date_depot`,
`numero_flux_depot`, `created_at`) but is **write-only** today.
❓ Audit log is a JSONL file (`config/audit-log.jsonl`) + `audit.py` — consider DB-backed audit for beta.

## 5. Official-contract gaps (from Phase 0)

| Item | Status |
|------|--------|
| OAuth2 (`client_credentials`, `scope=openid`, headers, `cpro-account`) | ✅ confirmed [S11/S4] |
| Sandbox/prod app hosts | ✅ [R1] |
| Deposit ≤ 10 Mo non compressé / 30 Mo compressé, formats UBL/CII/Factur-X | ✅ [S8] |
| Flux 9 states + invoice 60+ status classification | ✅ [S6/R5] |
| Token lifetime / refresh | ❓ [S4 PDF] → implement refresh-on-401 anyway |
| CR motif → remedy catalog | ❓ [S7 PDF not parsed] |
| Per-method request/response/error schemas | 🟨 [S7] |

## 6. Non-functional gaps (Phase 5)

❌/🟨 production security review, structured logging/monitoring, rate limiting, DB backups, runbook,
secrets management, CORS hardening, deployment doc. (Compose + nginx exist; prod hardening is the work.)

## 7. Top gaps to reach beta (ranked)

1. **GET flux deposits (list+stats) + wire hub KPIs** — P1, unblocks the flux cockpit. (BE+DB+FE)
2. **Unify invoice/flux UI** (one card, one status source, dynamic click) — P1. (FE)
3. **CR as first-class object + motif→remedy mapping** — P1/P2. (BE+FE, needs S7 parse)
4. **Guided correction depth** (XML/UBL/CII + redeposit) — P2. (FE+BE)
5. **Onboarding wizard** (PISTE app + Chorus technical user) — P2. (FE+BE)
6. **Stabilization** (40 frontend type errors, build, tests, migrations) — P0. (FE+BE)
7. **Production readiness** — P2/P3.

See `IMPLEMENTATION_BACKLOG.md` for per-task detail and `ROADMAP_TECHNICAL.md` for sequencing.

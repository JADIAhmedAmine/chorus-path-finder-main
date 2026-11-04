# Backend Refactor Plan — Chorus Pilot

> **Generated:** 2026-06-07 · FastAPI + SQLAlchemy 2.0 + Alembic + PostgreSQL. Real file paths.
> Focus: expose persisted flux deposits, harden auth/CR/errors, and modularise the monolithic server.

## 1. Current state (observed)
- App entry: `scripts/chorus_submit_server.py` — `FastAPI("Chorus Path Finder API", v2.0)`, port 8008,
  `/health`, http middleware, includes routers (auth, flux, pdf-to-flux, g2b flux, g2b annuaire, db).
- This server file is **large (~2800+ lines)** and hosts many `@app.post(...)` handlers directly
  (submit, recycle, correct-validator, reception consult/process/complete, downloads, history, SIRET,
  structures, annuaire sync, oauth-token).
- Routers: `chorus_python/chorus_flux_routes.py`, `chorus_pdf_to_flux_routes.py`, `g2b_routes_flux.py`,
  `g2b_routes_annuaire.py`, `auth.py`, `db/api.py`.
- Persistence: `chorus_python/db/` (`entities.py`, `repositories.py`, `api.py`, `session.py`, `sync.py`,
  `scheduler.py`). Flux deposits written via `record_flux_deposit` → table `chorus_flux_deposits`.
- Chorus/PISTE clients: `client.py`, `chorus_flux_client.py`, `g2b_flux_client.py`,
  `g2b_annuaire_client.py`; error explainer `g2b_error_explainer.py`, `errors.py`.

## 2. Priority backend work (maps to backlog)

### BR-A · GET flux deposits (list + stats) — P2-1 *(top gap)*
- **Add** to `chorus_python/chorus_flux_routes.py`:
  - `GET /api/chorus/flux/deposits` (paginated, tenant-scoped, `require_auth`).
  - `GET /api/chorus/flux/deposits/stats` (count total/by `status_local`, error count via `code_retour`,
    last `date_depot`/`created_at`, success rate).
- **Add** repository reads in `chorus_python/db/repositories.py` (mirror `record_flux_deposit`).
- **No migration** (table + indexes already exist: `ix_chorus_flux_deposits_tenant_created|status|numero`).
- **Acceptance:** endpoints return tenant-isolated data; power the hub KPIs.

### BR-B · OAuth2 token cache + refresh-on-401 — P2-2
- **Files:** `chorus_python/client.py`, server `OAUTH_TOKEN_PATH` handler.
- Cache token per environment; refresh on expiry/401 then retry once. Token lifetime **[à vérifier S4]**.
- **Acceptance:** no user-visible 401 with valid creds; single retry on expiry.

### BR-C · Compte rendu (`consulterCR`) normalization — P2-3
- **Files:** `chorus_python/chorus_flux_client.py` (or new `chorus_cr_client.py`), new route.
- Call/normalize CR → `{ flux_state, invoices: [{status, motif, remedy?}] }`.
- **Acceptance:** structured CR served to FE; technical + per-invoice outcome present.

### BR-D · Error/motif catalog — P3-1
- **Files:** `g2b_error_explainer.py`, `errors.py`.
- Extend mapping of CR motifs + `ERREUR_*` statuses to plain-language remedy (source: S7 PDF — **à parser**).
- **Acceptance:** known motifs → remedy; unknown → safe generic + source link.

### BR-E · Guided correction + redeposit — P3-2, P3-3
- **Files:** `chorus_flux_routes.py` (`prepare-correction`), `chorus_ubl_generator.py`, `{RECYCLE_PATH}` handler.
- Field-level correction → regenerate conformant XML → re-validate → redeposit, tracking new flux.
- **Acceptance:** corrected invoice redeposits with a new tracked flux id.

### BR-F · Modularise the monolithic server — tech-debt (P5/ongoing)
- Extract the inline `@app.post(...)` handlers in `scripts/chorus_submit_server.py` into routers:
  `reception_routes.py`, `invoice_routes.py`, `submission_routes.py`, `references_routes.py`.
- Keep paths identical (constants like `SUBMIT_PATH`, `RECYCLE_PATH`) to avoid breaking the FE.
- **Acceptance:** server file shrinks to app wiring + middleware; all routes unchanged; tests pass.

### BR-G · Security & ops hardening — P5-1/2/3/4
- CORS allowlist + security headers in middleware; structured JSON logging; no secret/`cpro-account` logging;
  basic rate limiting (nginx/app). **Acceptance:** security checklist passes.

## 3. Cross-cutting
- Keep **secrets server-side** (already the pattern). Validate uploads (size ≤ 10 Mo non compressé / 30 Mo compressé pre-check, content-type).
- Preserve `require_auth/require_admin/require_submit_permission` gates on new routes.
- All new endpoints tenant-scoped; reuse `db/session.py` patterns and `asyncio.to_thread` for sync DB calls
  (as `chorus_flux_routes.py` already does).

## 4. Risks
- Refactoring the large server file risks route regressions → move behind identical path constants + tests.
- CR/error mapping depends on the **unparsed S7 PDF** → ship generic explanations first, enrich later.

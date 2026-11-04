# Database Plan — Chorus Pilot

> **Generated:** 2026-06-07 · PostgreSQL 16 + SQLAlchemy 2.0 (`MappedAsDataclass`) + Alembic.
> Real schema from `chorus_python/db/entities.py` and `alembic/versions/*`.

## 1. Current schema (entities)

| Table | Class | Notes |
|-------|-------|-------|
| `tenants` | `Tenant` | multi-tenant root |
| `suppliers` | `Supplier` | issuer orgs |
| `public_customers` | `PublicCustomer` | recipients (SIRET, structure) |
| `public_services` | `PublicService` | service exécutant per customer |
| `invoices` | `Invoice` | full lifecycle fields incl. `statusChorus`, `statusReasonCode/Label`, recipient/service Chorus ids, `rawPayload` (JSONB) |
| `invoice_lines` | `InvoiceLine` | line items |
| `sync_runs` | `SyncRun` | sync history |
| `chorus_flux_deposits` | `ChorusFluxDeposit` | flux deposit trace + persisted Chorus CR enrichment |

## 2. Migrations (Alembic)
```
20260504_0001_initial_schema.py
20260504_0002_extend_invoice_columns.py
20260530_0003_chorus_flux_deposits.py        # creates chorus_flux_deposits
20260530_0004_flux_deposit_detection.py      # detection columns
d55c148e31ff_change_status_reason_label_to_text.py
e7a4bd3e24d6_merge_alembic_heads.py          # no-op checkpoint after 0004
20260607_0005_flux_deposit_cr_enrichment.py  # P2-3 CR state/errors
```
- **P0-5 fixed (2026-06-07):** the checkpoint no longer references the nonexistent
  `20260522_0001`; `alembic heads` exposes one valid head.

## 3. `chorus_flux_deposits` — already KPI-ready (no migration needed for P2-1)
Columns (existing): `id, tenant_id, nom_fichier, file_sha256, file_size, format_flux, syntaxe_flux,
detected_file_type, root_element, namespace, avec_signature, id_utilisateur_courant, http_status,
code_retour, libelle, date_depot, numero_flux_depot, raw_response (JSONB), status_local, created_at`.
Indexes: `(tenant_id, created_at)`, `(tenant_id, status_local)`, `(numero_flux_depot)`.

→ **Read endpoints (BR-A / P2-1) can use these directly:**
- "flux déposés" = COUNT by tenant.
- "flux en erreur" = COUNT where `status_local` ∈ error set OR `code_retour` indicates failure.
- "dernier dépôt" = MAX(`date_depot` || `created_at`).
- "taux de succès" = success / total.

### ✅ Implemented (P2-1, 2026-06-07) — no migration
`GET /api/chorus/flux/deposits` (+ `/stats`) read this table (repo: `list_flux_deposits`,
`flux_deposit_stats` in `chorus_python/db/repositories.py`; routes in `chorus_flux_routes.py`).

### ✅ Implemented (P2-3, 2026-06-07) — migration `20260607_0005`
The additive migration stores the normalized CR fields:
`etat_courant_flux`, `cr_summary_json`, `invoice_count`, `error_count`, `cr_available`,
`last_cr_checked_at`, `last_cr_error`.

`POST /api/chorus/flux/deposits/{deposit_id}/refresh-cr` and
`POST /api/chorus/flux/deposits/refresh-cr` call `consulterCRDetaille` (fallback
`consulterCR`), then persist the official state and error summary. Stats now prioritize
`etat_courant_flux`; deposits without a CR still use the P2-1 best-effort mapping. Batch
refresh is bounded and selects the least recently checked deposits first.

**Fields still returned as `null`/`not_available`:**
- `formatDepot` (PDF_NON_SIGNE/PADES/XADES) — only relevant to `deposerPDFFacture`, not persisted here.
- `updated_at` — no column (only `created_at`); `dateDepot` is a free string from Chorus.
- `invoice_count` remains `null`: `consulterCRDetaille` exposes rejected DPs, not the total invoice count.

## 4. Proposed additions (post-beta / as needed)

| Change | Why | Priority | Migration |
|--------|-----|----------|-----------|
| Link table `flux_deposit_invoices` (flux_id ↔ invoice_id) | model flux↔N invoices [S6] | P2/P3 | new migration |
| `audit_events` table (id, tenant_id, actor, action, target, payload JSONB, created_at) | DB-backed audit vs JSONL (P3-4) | P3 (optional for beta) | new migration |
| `users` table (if moving off `config/auth-users.json`) | admin role management (P4-4) | P4 | new migration |
| Indexes on `invoices(statusChorus)`, `invoices(tenant_id, invoiceDate)` | dashboard/list perf | P2 | new migration |

> Keep beta minimal: **P2-1 needs NO migration.** Only add tables when a feature requires them.

## 5. Operational (P5)
- **Backups (P5-5):** scheduled `pg_dump` of `chorus` DB (volume `chorus_pg_data`) + **tested restore**.
- **Connections:** `DATABASE_URL=postgresql+psycopg://...` (compose). Pool sizing for beta load.
- **Data retention:** align with Chorus "2 years then archive" expectation [S5] — **[à vérifier]** for stored copies/RGPD.
- **PII/RGPD:** invoices contain business identifiers (SIRET) — document retention & access; no personal data scraping.

## 6. Risks
- Adding flux↔invoice link requires backfill strategy if deposits predate it.
- `rawPayload`/`raw_response` JSONB can grow — index/prune as needed.

# API → Feature Mapping — Chorus Pilot

> **Generated:** 2026-06-07 · Maps **real backend routes** (`scripts/chorus_submit_server.py` +
> `chorus_python/*_routes.py`) and the **Chorus Pro endpoints** they call, to product features.
> ✅ wired · 🟨 partial · ❌ missing. **No API invented.**

## 1. Backend route → Chorus Pro endpoint → feature

| App backend route | Calls Chorus Pro (PISTE) | Product feature | State |
|-------------------|--------------------------|-----------------|-------|
| `POST /api/chorus/oauth-token` | `/api/oauth/token` (client_credentials) | Connection / onboarding | ✅ |
| `POST /api/chorus/flux/detect` | (local detection) | Format detection (pre-deposit) | ✅ |
| `POST /api/chorus/flux/business-validate` | reference data `recuperer/*` | Business validation | ✅ |
| `POST /api/chorus/flux/deposer` | `/v1/deposer/flux` (deposerFluxFacture) | Dépôt de flux | ✅ |
| `POST /api/chorus/flux/formats` | `/v1/recuperer/formatflux` | Format list | ✅ |
| `POST /api/chorus/flux/syntaxes` | `/v1/recuperer/syntaxeflux` | Syntax list | ✅ |
| `GET  /api/chorus/flux/guide` | (local) | Deposit guidance | ✅ |
| `POST /api/chorus/flux/prepare-correction` | (local) | Guided correction prep | 🟨 |
| `POST /api/chorus/pdf-to-flux/extract` | (OCR/extract) | PDF → flux extraction | ✅ |
| `POST /api/chorus/pdf-to-flux/generate-xml` | (UBL gen) | Generate UBL | ✅ |
| `POST /api/chorus/pdf-to-flux/validate-xml` | (validate) | Pre-deposit validation | ✅ |
| `POST /api/chorus/pdf-to-flux/deposer-generated` | `/v1/deposer/flux` | Deposit generated flux | ✅ |
| `POST {SUBMIT_PATH}` (`/api/chorus/submit`) | `/v1/deposer/pdf` + `/v1/soumettre` | Invoice emission | ✅ |
| `POST {INVOICE_HISTORY_PATH}` | invoice status/history | Status tracking | ✅ |
| `POST {SUPPLIER_INVOICES_SEARCH_PATH}` | `/v1/rechercher/...` | Invoice search | ✅ |
| `POST {RECEPTION_CONSULT_PATH}` (+bulk) | reception consult | Factures reçues | ✅ |
| `POST {RECEPTION_PROCESS_PATH}` | reception process | Traiter une facture | ✅ |
| `POST {RECEPTION_COMPLETE_PATH}` | complete suspended | Suspension handling | ✅ |
| `POST {INVOICE_DOWNLOAD_PATH}` / `{RECEPTION_DOWNLOAD_PATH}` | download | Download PDF/XML | ✅ |
| `POST {SIRET_INFO_PATH}` | SIRET info | Annuaire / entity config | ✅ |
| `POST {ACTIVE_RECIPIENT_STRUCTURES_PATH}` | `recuperer/structures` | Entity config | ✅ |
| `POST {SYNC_ANNUAIRE_PATH}` | annuaire sync | Annuaire | ✅ |
| `POST {RECYCLE_PATH}` | redeposit | Rejection correction | 🟨 |
| `POST {CORRECT_VALIDATOR_PATH}` | (local correction) | Guided correction | 🟨 |
| `POST /api/g2b/flux/detect|business-validate|deposit` | G2B interface | Operator deposit | ✅ |
| `GET  /api/g2b/flux/{uid}/status` · `POST .../poll` | G2B status | Flux suivi (CR/status) | ✅ |
| `POST /api/g2b/annuaire/validate-recipient` | G2B annuaire | Recipient obligations | ✅ |
| `GET  /api/db/dashboard/summary` | (DB aggregate) | Dashboard KPIs | ✅ |
| `GET  /api/db/invoices` · `/invoices/{id}` · `/invoice-lines` | (DB) | Invoice lists/detail | ✅ |
| `GET  /api/db/sync-runs` · `POST /sync/*` | (DB + Chorus sync) | Sync | ✅ |
| `GET  /api/db/audit-log` | (audit) | Audit logs | ✅ |
| `POST /api/auth/login` · `GET /me` · `POST /change-password` | (auth) | Auth / roles | ✅ |
| **❌ GET `/api/chorus/flux/deposits` (list+stats)** | reads `chorus_flux_deposits` | **Flux hub KPIs** | ❌ **missing** |
| 🟨 `consulterCR` surfaced as UI object | `/v1/consulterCR` | CR reading | 🟨 |

## 2. Feature → readiness summary

| Product feature | Backend | Frontend | Beta gap |
|-----------------|---------|----------|----------|
| Onboarding / connection | ✅ oauth bridge | 🟨 login only | Wizard (PISTE app + technical user) |
| Entity configuration | ✅ structures/SIRET | 🟨 References | Config screen |
| Annuaire lookup | ✅ | ✅ | Polish |
| Invoice emission | ✅ submit | ✅ | — |
| Dépôt de flux | ✅ | ✅ | — |
| Syntax/business validation | ✅ | ✅ partial | Reference-data depth (S7) |
| PDF → flux | ✅ | ✅ | — |
| Status tracking (flux + invoice) | ✅ history/status | ✅ | **CR as object** |
| **Flux deposit KPIs** | ❌ no read endpoint | 🟨 placeholders | **Add GET + wire** |
| Rejection / suspension correction | 🟨 recycle/correct | 🟨 | Guided UX |
| Reception | ✅ | ✅ | Unify UI |
| Dashboard / stats / exports | ✅ summary, CSV | ✅ | Flux stats |
| Audit logs | ✅ (JSONL) | ✅ | DB-backed (optional) |
| Admin settings / roles | ✅ roles | 🟨 | Admin UX |

## 3. Notes
- The backend is **more complete than the frontend exposes** — much beta work is **UX/wiring**, not new APIs.
- The single most leveraged missing piece is the **flux deposits read endpoint** (data already persisted).
- CR (`consulterCR`) handling and the **motif→remedy** mapping depend on parsing the **S7 spec PDF**.

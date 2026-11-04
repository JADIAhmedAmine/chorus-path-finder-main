# Risk Register — Chorus Pilot → Beta

> **Generated:** 2026-06-07 · Likelihood (L) / Impact (I) / Severity = L×I (low/med/high).
> Mitigations reference backlog tasks (`IMPLEMENTATION_BACKLOG.md`). Owner = role to assign.

| ID | Risk | L | I | Sev | Mitigation | Owner | Linked |
|----|------|---|---|-----|-----------|-------|--------|
| R1 | **Incomplete API contracts** — CR motif catalog & per-method schemas live in unparsed S7/S13 PDF | High | High | **High** | Parse S7/S13; ship generic explanations first; mark "à vérifier" | Tech lead | P2-3, P3-1 |
| R2 | **OAuth2 token expiry** breaks calls mid-session (lifetime unconfirmed) | Med | High | **High** | Token cache + refresh-on-401 regardless of S4; alert on auth failures | Backend | P2-2 |
| R3 | **40 pre-existing frontend type errors** hide real bugs / block clean CI | High | Med | Med | Fix in P0-1; enable `tsc` in CI gate | Frontend | P0-1, P0-2 |
| R4 | **Monolithic server file** (~2800 lines) → regressions when changing routes | Med | High | **High** | Modularise behind identical path constants; add route tests | Backend | BR-F |
| R5 | **Flux KPIs blocked** (deposits persisted but no read endpoint) | High | Med | Med | Add GET deposits/stats (no migration) | Backend | P2-1 |
| R6 | **Merged Alembic heads** fail on fresh DB | Med | High | **High** | Verify `upgrade head` on clean DB in CI | Backend/DBA | P0-5 |
| R7 | **PISTE/Chorus availability & quotas** unknown in prod | Med | High | **High** | Backoff/retry; conservative usage; confirm quotas on PISTE dashboard | Backend/Ops | P5-4 |
| R8 | **Secrets exposure** (`client_secret`, Chorus password, `cpro-account`) | Low | High | Med | Server-side only; never log; HTTPS; secret scanning | Security | P5-1 |
| R9 | **Two-level auth onboarding friction** (PISTE app + Chorus technical user) | High | Med | Med | Onboarding wizard validating creds in sandbox | Product/FE | P4-2 |
| R10 | **10 Mo / 30 Mo compressé flux limit / format non-conformance** → rejects | Med | Med | Med | Pre-deposit size + format/syntax validation | FE/BE | P2-5, (exists) |
| R11 | **Regulatory drift** (B2B/PDP-PPF dates) presented as fixed | Med | High | **High** | Mark all dates "à vérifier"; re-check impots.gouv.fr; keep out of beta scope | Product | BETA_SCOPE |
| R12 | **Status semantics** (60+ codes, MOA/MOE circuits) mislabeled | Med | Med | Med | Single source `status-utils.ts`; verify transitions vs S7 | FE | P1-3 |
| R13 | **UX refactor regressions** across many invoice pages | Med | Med | Med | Shared component + incremental page adoption + visual checks | FE | P1-1…P1-7 |
| R14 | **No DB backups / untested restore** | Med | High | **High** | Scheduled `pg_dump` + restore drill before beta | Ops | P5-5 |
| R15 | **Prod readiness gaps** (CORS, headers, monitoring, rate limit) | Med | High | **High** | Phase 5 security + observability checklist | Ops/Security | P5-1/2/3/4 |
| R16 | **PISTE catalog not publicly extractable** → contract assumptions | Med | Med | Med | Rely on repo + Communauté docs; confirm via PISTE account | Tech lead | API_CONTRACT_GAP_ANALYSIS |
| R17 | **RGPD / data retention** for stored invoice copies | Low | High | Med | Define retention; align with Chorus 2-yr/archive [S5]; access controls | Legal/Backend | DATABASE_PLAN |
| R18 | **Objective drift** (research prompt file was missing) | Low | Med | Low | Objective confirmed by user 2026-06-07; revisit if scope changes | Product | context_pack |

## Top 6 to watch (severity High)
R1 (contracts), R2 (token), R4 (monolith), R6 (migrations), R7 (quotas/availability), R14/R15 (ops/prod).

## Review cadence
- Re-score weekly during Phases 0–2; at each phase exit thereafter.
- Any new external dependency (PISTE quota, S7 parse outcome) → re-evaluate R1/R2/R7.

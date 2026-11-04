# Product Opportunity Map — Chorus Pilot

> **Generated:** 2026-06-07 · **Skill:** product-strategy-mapper
> Built from `context_pack.md`, `api_*` files, and the existing codebase. Source ids → `context_sources.json`.
> Speculative/business-judgement items are flagged; regulatory dates are **[à vérifier]**.

## 1. Who & what pain

**Users:** finance/AP teams of suppliers to the French public sector, and operators/éditeurs
depositing on their behalf. **Core pain:** Chorus Pro is powerful but **opaque** — flux vs invoice,
CRs, 60+ statuses, MOA/MOE circuits, format conformance, recipient obligations. Mistakes mean
**rejects, suspensions, and delayed payment**.

## 2. Pain points → automation opportunities

| Pain point | Manual today | Opportunity (API-enabled) | Evidence |
|------------|--------------|---------------------------|----------|
| Rejects from bad data | Discover only after deposit via CR | **Pre-deposit validation** (SIRET/TVA/amount/number/recipient/service/engagement/format) using `recuperer/*` + annuaire | R2, R4, S5 |
| "What does this status mean?" | Read Chorus docs each time | **Guided status reading** with plain-language + recommended action (status-utils mapping) | R5, S6 |
| Flux ↔ invoice confusion | Mentally reconcile | **Unified flux→invoices tracking** with CR drill-down | S6 |
| Recipient obligations unknown | Trial and error | **Directory-first check** (service code / engagement required) before deposit | R4 |
| PDF-only invoices | Re-key into structured format | **PDF→flux extraction** reviewed before deposit | R2, S9 |
| Suspensions need a complement | Email back-and-forth | **Guided suspension handling** (comment/attachment) | R5, S5 |
| No cockpit | Spreadsheets | **Operational hub** with KPIs + pipeline (already started: `/flux`) | repo |

## 3. Business obligations baked into the product

- B2G e-invoicing via Chorus Pro is **mandatory** (phased 2017→2020).
- B2B e-invoicing reform with **PDP/PPF** is upcoming — **[à vérifier: confirm current calendar]** —
  a strategic adjacency (don't hard-commit until verified).

## 4. Missing UX layers (where Chorus Pilot wins)

1. **Pedagogy** — explain every step & status, cite official sources (already designing this).
2. **Prevention** — stop bad deposits before they happen (validation + directory).
3. **Linkage** — one parcours from deposit → CR → invoice lifecycle → payment.
4. **Recovery** — turn a reject/suspension into a clear, guided next action.

## 5. Monetizable features (business judgement)

- **Pre-deposit validation** (reduces rejects) — premium/seat value.
- **Bulk deposit + flux monitoring** for operators.
- **Analytics** (reject rate, time-to-payment, top reject motifs).
- **Multi-structure / multi-supplier** management for accountants & operators.
- **Audit trail / compliance export**.

## 6. Risks & dependencies

- **PISTE/Chorus availability & quotas** (gateway dependency).
- **Two-level auth onboarding friction** [R1] → invest in onboarding UX.
- **Spec drift** (formats, statuses, B2B reform) → keep texts sourced & "à vérifier".
- **10 Mo / 30 Mo compressé flux limit** & format conformance [S8].
- **Endpoint certainty gaps** → confirm via S7/S4 PDFs.

## 7. Beta-readiness gaps

- Persisted **flux deposit history** (for real flux-level KPIs — currently not stored).
- Robust **CR parsing → human-readable motifs** for every reject code.
- **Production onboarding** flow (PISTE app + Chorus account) end-to-end.
- Confirmed **error catalog** mapping (from S7).

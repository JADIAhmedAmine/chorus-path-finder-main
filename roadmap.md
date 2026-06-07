# Roadmap — Chorus Pilot

> **Generated:** 2026-06-07 · **Skill:** product-strategy-mapper
> Sequenced from `mvp_scope.md` + `feature_matrix.csv`. Effort is relative, not committed dates.
> Regulatory items are **[à vérifier]**.

## Phase 0 — Verify foundations (1–2 weeks)
*Goal: remove uncertainty before building on assumptions.*
- [ ] Confirm the **research objective** (the `chorus_research_prompt.txt` was missing).
- [ ] Deep-read **Spécifications Externes Annexe Services API** PDF [S7] → lock endpoint/param/error tables.
- [ ] Parse **OAuth2 fiche pratique** PDF [S4] → confirm grant type, scopes, token lifetime.
- [ ] Re-verify the **B2B e-invoicing reform calendar** (official source).
- [ ] Fix dead source link in `src/lib/flux/officialSources.ts` (`developer.aife.economie.gouv.fr` → PISTE).

## Phase 1 — MVP: prevent & explain (4–6 weeks)
*Goal: deposit fewer rejects; understand every status.*
- [ ] Harden **pre-deposit business validation** (SIRET, TVA, amount, number, recipient, service/engagement, format) using live `recuperer/*` + annuaire [R2, R4].
- [ ] **CR reading**: parse `consulterCR` into plain-language outcome + recommended action [S6].
- [ ] **Status guidance**: ensure every code in `status-utils.ts` has explanation + next action [R5].
- [ ] **Directory-first** deposit flow (block on missing service/engagement) [R4].
- [ ] Finalise the **/flux hub** as the canonical entry (cards, pipeline, sourced pedagogy).
- [ ] **Onboarding** wizard for PISTE app + Chorus account (two-level auth) [R1].

**Exit:** MVP acceptance criteria in `mvp_scope.md` all pass in sandbox.

## Phase 2 — Recover & scale operations (4–8 weeks)
*Goal: turn rejects/suspensions into guided recovery; support operators.*
- [ ] Guided **rejection correction + resubmit/recycle** end-to-end [R2, S6].
- [ ] **Suspension handling** (comment/attachment complement) [S5].
- [ ] **Persisted flux deposit history** → real flux-level KPIs (flux deposited, in error, last deposit).
- [ ] **Bulk deposit + flux monitoring** for operators (G2B code interfaces) [R3].
- [ ] Production onboarding & promotion gate from qualification [à vérifier S4/S7].

## Phase 3 — Insight & differentiation (6–10 weeks)
*Goal: management value & stickiness.*
- [ ] **Analytics**: reject rate, top reject motifs, time-to-payment.
- [ ] **Multi-structure / multi-supplier** management.
- [ ] **Compliance/audit export**.
- [ ] Reporting module [feature_matrix P3].

## Phase 4 — Strategic adjacency (scope when confirmed)
*Goal: future-proof for the B2B reform.* **[à vérifier — do not commit until calendar confirmed]**
- [ ] **PDP / PPF readiness** assessment.
- [ ] Annuaire/PPF integration design.
- [ ] Format coverage expansion (Factur-X/UBL/CII profiles).

## Cross-cutting (every phase)
- Keep all business text **sourced** (PISTE / Chorus Pro-AIFE); mark uncertain rules "à vérifier".
- Respect API constraints (**10 Mo / 30 Mo compressé** flux, format conformance) [S8].
- Secrets server-side only; HTTPS; no `cpro-account` logging [R1].
- Re-verify specs against the latest **Spécifications Externes** PDF [S7] each release.

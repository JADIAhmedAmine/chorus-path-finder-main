# Chorus Pro — Flow & Invoice Statuses

> **Generated:** 2026-06-07 · **Phase 0**
> Two distinct status layers: **(A) flux technical states** (deposit receivability) and **(B) invoice
> business statuses** (lifecycle to payment). Source ids → official docs (S) / repository (R).

## A. Flux technical states — `consulterCR` monitoring (9 states) [S6]

> **Official French labels CONFIRMED** (spec V5.00, `etatCourantFlux`): Reçu · Traité SE CPP · En attente de traitement · En cours de traitement · **Incidenté** (= the EN doc's "Warning") · Rejeté · En attente de retraitement · Intégré · Intégré partiellement. Full descriptions in `CHORUS_SPEC_EXTRACT.md`.

| State | Meaning | Tone |
|-------|---------|------|
| Received | Flux received by Chorus Pro | info |
| Processed SE CPP | File arrived in the Chorus Pro exchange system | info |
| Waiting for processing | Flux queued | neutral |
| In progress | Active processing | info |
| Warning | Flux not processed by the exchange system | warning |
| **Rejected** | Anomalies (technical **or** business) prevent acceptance | error |
| Waiting for reprocessing | Blocked, awaiting manual processing | warning |
| **Integrated** | Processed and **fully** integrated | success |
| **Partially integrated** | Only error-free invoices accepted (API/portal modes) | warning/success |

**Flux ↔ invoices:** one flux carries **1..N invoices**. Rejection mode is configurable:
**complete** (resubmit the whole flux) or **partial** (resubmit only erroneous invoices) [S6].

The app additionally models pre-send local states for the deposit UI: `RECEVABLE`, `IRRECEVABLE`,
`ENTRANT_ENVELOPPE_VALIDE`, `PROCESSING_NOT_AVAILABLE_YET`, `BLOCKED_LOCAL_VALIDATION`,
`BLOCKED_BUSINESS_VALIDATION` [R: `src/lib/flux/fluxStatus.ts`, `G2BFluxDepositPage.tsx`].

## B. Invoice business statuses — machine codes [R5: `src/lib/status-utils.ts`]

The app encodes **60+ Chorus invoice status codes** and classifies them. Portal-facing subset confirmed
in docs: **Brouillon, Rejetée, À recycler, Suspendue** [S5].

### Classification used by the app [R5]

**Success** (`text-success`): `VALIDEE_1`, `VALIDEE_2`, `MANDATEE`, `MISE_EN_PAIEMENT`, `COMPTABILISEE`,
`SERVICE_FAIT`, `PRISE_EN_COMPTE_MOE`, `PRISE_EN_COMPTE_MOA`, `PRISE_EN_COMPTE_DESTINATAIRE`.

**Warning / action needed** (`text-warning`): `A_VALIDER_1`, `A_VALIDER_2`, `A_VALIDER_MOE`,
`A_RECYCLER`, `SUSPENDUE`, `EN_ATTENTE_RECYCLAGE_FOURNISSEUR`, `A_ASSOCIER_MOE`, `A_ASSOCIER_MOA`,
`A_ASSOCIER_FOURNISSEUR`, `A_COMPLETER`, `DUPLIQUE_APRES_REFUS`.

**Error / rejection** (`text-destructive`): `ERREUR_FOURNISSEUR_SUR_VALIDEUR`, `REFUSEE_1`,
`ABSENCE_VALIDATION_1_HORS_DELAI`, `ERREUR_COTRAITANT_SUR_VALIDEUR`, `REFUSEE_2`,
`ABSENCE_VALIDATION_2_HORS_DELAI`, `ERREUR_FOURNISSEUR_SUR_MOE`, `REJETEE`, `ABANDONNEE`, `SUPPRIMEE`,
`REFUSEE_MOE`, `ERREUR_MOE_SUR_FOURNISSEUR`, `ERREUR_MOA_SUR_FOURNISSEUR`, `ERREUR_FOURNISSEUR_SUR_MOA`,
`ERREUR_MOE_SUR_MOA`, `ERREUR_DESTINATAIRE_PD`, `ERREUR_DESTINATAIRE_EA`, `NON_CONFORME`, `ERREUR_DE_MOE`,
`ERREUR_DE_MOA`, `REFUSEE_MOA`, `REFUSEE_FOURNISSEUR`, `ABSENCE_VALIDATION_MOE_DELAI_REGLEMENTAIRE`,
`TECHNIQUE_INCONNU`.

**Info / transit** (`text-info`): `DEPOSEE`, `EN_COURS_ACHEMINEMENT`, `MISE_A_DISPOSITION`,
`MISE_A_DISPOSITION_COMPTABLE`, `ASSOCIEE`, `EN_COURS_TRAITEMENT_PIVOT_S`, `INTERPRETEE_OCR`, `COMPLETEE`,
`MISE_A_DISPOSITION_MOE`, `TRANSMISE_MOA`, `REMPLACEE_PAR_A22`, `MISE_A_DISPOSITION_MOA`.

> Unmapped/neutral default falls back to muted. Full ordered list lives in
> `CHORUS_INVOICE_STATUS_CODES` [R5].

### Typical happy path (illustrative, à vérifier per recipient circuit)
`DEPOSEE` → `EN_COURS_ACHEMINEMENT` → `MISE_A_DISPOSITION` → (validation MOA/MOE) → `MANDATEE` →
`MISE_EN_PAIEMENT` → `COMPTABILISEE`. Exact transitions depend on the recipient's validation circuit
(MOA/MOE) and are **[à vérifier in S7]**.

## C. Product implications

- The hub/cards should always pair a status with a **plain-language meaning + recommended action**,
  driven by the classification above (already started in `status-utils.ts` + Flux components).
- Distinguish **flux state** (technical) from **invoice status** (business) in the UI — they answer
  different questions ("was my file accepted?" vs "where is my invoice in the payment cycle?").
- `INTERPRETEE_OCR`, `A_COMPLETER`, `SUSPENDUE`, `A_RECYCLER`, `REJETEE` are the highest-value
  "next action" triggers.

## Sources
S5 Rechercher factures · S6 Monitoring flows · S7 Spéc. Externes (status transitions, not parsed) ·
R5 `src/lib/status-utils.ts`.

# Chorus Pro — Error, Rejection & Suspension Handling

> **Generated:** 2026-06-07 · **Phase 0**
> What can go wrong, where it surfaces, and the product response. Exact **error-code catalogs** live in
> the Spécifications Externes PDF [S7/S13] — **parsed 2026-06-07 (V5.00), see `CHORUS_SPEC_EXTRACT.md`**. Behavioural facts are sourced
> from public docs [S6/S5] and the repository [R].

## 1. Two checkpoints (where errors appear)

1. **Technical receivability of the flux** — is the file acceptable at all?
   - Outcomes: `Received` → … → `Rejected` / `Warning` / `Waiting for reprocessing` /
     `Integrated` / `Partially integrated` [S6].
   - App pre-send equivalents: `IRRECEVABLE`, `BLOCKED_LOCAL_VALIDATION`,
     `BLOCKED_BUSINESS_VALIDATION` [R: `fluxStatus.ts`].
2. **Business integration of each invoice** — does each invoice pass the recipient's rules?
   - Outcomes appear as invoice statuses (`REJETEE`, `SUSPENDUE`, `A_RECYCLER`, `NON_CONFORME`,
     `A_COMPLETER`, `ERREUR_*`) [R5].

## 2. Rejection model [S6]

- A flux contains **1..N invoices**. Rejection is **complete** (resubmit the whole flux) or **partial**
  (resubmit only the erroneous invoices), depending on structure configuration [S6].
- `Partially integrated` = error-free invoices accepted, erroneous ones rejected (API/portal modes) [S6].

## 3. Error classes (product-facing taxonomy)

| Class | Examples (status/codes) [R5] | Likely cause | Product response |
|-------|------------------------------|--------------|------------------|
| **Format / syntax** | flux `Rejected` (technical) | Non-conformant XML/UBL/CII, wrong syntax, > 10 Mo / 30 Mo compressé | Pre-deposit format detection + syntax check; block before send |
| **Identification** | `ERREUR_DESTINATAIRE_PD/EA`, recipient not found | Bad SIRET, missing service exécutant, wrong recipient | Directory check before deposit (annuaire) |
| **Business data** | `NON_CONFORME`, `REFUSEE_*` | Missing TVA, incoherent TTC, missing invoice number, missing engagement | Business validation (TVA/devises/cadre + amounts) before deposit |
| **Validation circuit** | `REFUSEE_1/2`, `ABSENCE_VALIDATION_*_HORS_DELAI`, `ERREUR_*_SUR_*` | Recipient validation refusal / delay | Show motif + guide resubmission / contact |
| **Suspension** | `SUSPENDUE`, `A_COMPLETER`, `EN_ATTENTE_RECYCLAGE_FOURNISSEUR` | Complement requested | Guided complement (comment/attachment) |
| **Recyclage** | `A_RECYCLER`, `DUPLIQUE_APRES_REFUS` | Routing data must be corrected | Correct recipient/service/commitment only → recycle |

## 4. Suspension handling

- `SUSPENDUE` / `A_COMPLETER` mean a **complement is expected** (comment and/or attachment) before the
  invoice can proceed [S5/R5].
- Product flow: detect suspended → show what's missing → collect complement → resubmit.
  (App: reception/processing components + `CompleteSuspendedInvoiceCard` [R].)

## 5. Rejection / recyclage handling

- `REJETEE`: read the **motif**, create a corrected invoice with a **new invoice number**, then submit
  it as a new invoice/flux.
- `A_RECYCLER`: keep amounts, VAT, lines, supplier and invoice number unchanged. Correct only the
  recipient SIRET/code, recipient service and legal commitment/purchase order, then call the dedicated
  recycle action.
- App support: `/api/chorus/recycle`, `/api/chorus/validator/correct`, `EmissionRejections.tsx` page [R2].
- Always surface `statusReasonCode` / `statusReasonLabel` (present on the invoice model) to the user [R5].

## 6. Reading the compte rendu (CR)

- `consulterCR` returns the integration report of a deposited flux [S6].
- The CR indicates technical receivability and, per invoice, integration vs rejection with motifs.
- Product: parse CR → map each motif to a **plain-language explanation + recommended action**.
  The motif/error code structure is **confirmed** in `CHORUS_SPEC_EXTRACT.md` (deposerFluxFacture 20000–20007; ConsulterCRDetaille `listeErreurTechnique` + `listeErreurDP`).

## 7. HTTP / auth error handling (transport layer)

| Symptom | Likely cause | Handling |
|---------|--------------|----------|
| `401 Unauthorized` | Expired/invalid PISTE token | Refresh token (client_credentials) and retry once [S11] |
| `403 Forbidden` | Missing scope / `cpro-account` / app not subscribed | Re-check PISTE app subscription + technical account [S12] |
| `400 Bad Request` | Payload/headers invalid | Validate against schema (S7); ensure UTF-8 + correct headers [S11] |
| `413 Payload Too Large` | Flux > 10 Mo / 30 Mo compressé | Block before send [S8] |
| `5xx` | Gateway/Chorus issue | Backoff + retry; surface "service indisponible" |

## 8. Open items (à vérifier)
- Per-service error tables → **parsed (V5.00)**: see `CHORUS_SPEC_EXTRACT.md`. Remaining ~80 services not yet detailed.
- Mapping of each `ERREUR_*` status to a precise user remedy → derive from S7 once parsed.

## Sources
S5 Rechercher factures · S6 Monitoring flows · S7/S13 Spéc. Externes (error tables PARSED V5.00 → CHORUS_SPEC_EXTRACT.md) ·
S8 Submit flow invoice (10 Mo / 30 Mo compressé) · S11 Help for API developers OAuth2 · S12 Périmètre et prérequis ·
R2 bridge routes · R5 `status-utils.ts`.

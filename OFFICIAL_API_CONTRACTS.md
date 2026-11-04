# Official API Contracts — Chorus Pro via PISTE

> **Generated:** 2026-06-07 · **Phase 0** · For Chorus Pilot / InvoicePilot
> **Integrity:** facts cite a source id. `R*` = this repository; `S*` = official public docs (see list at
> bottom). Items not confirmed by a parsed source are marked **[à vérifier]**. **No endpoint invented.**

## 1. Gateway, environments & hosts

PISTE is the State API gateway in front of Chorus Pro (since **January 2020**) [S4/S11]. Two equivalent
host families exist (PISTE-branded and AIFE-branded); both front the same gateway. **This app uses the
`piste.gouv.fr` hosts** [R1]; official docs also document `aife.economie.gouv.fr` hosts and an RIE
(inter-ministerial) network variant [S11].

| Purpose | Sandbox / Qualification | Production |
|---------|-------------------------|-----------|
| OAuth token (app, `piste.gouv.fr`) [R1] | `https://sandbox-oauth.piste.gouv.fr/api/oauth/token` | `https://oauth.piste.gouv.fr/api/oauth/token` |
| API base (app, `piste.gouv.fr`) [R1] | `https://sandbox-api.piste.gouv.fr/cpro/factures` | `https://api.piste.gouv.fr/cpro/factures` |
| OAuth token (docs, AIFE) [S11] | `https://sandbox-oauth.aife.economie.gouv.fr/api/oauth/token` | (prod equivalent: `oauth.aife.economie.gouv.fr`) **[à vérifier]** |
| API base (docs, AIFE) [S11] | `https://sandbox-api.aife.economie.gouv.fr/{votre_API}` | (prod equivalent: `api.aife.economie.gouv.fr/{votre_API}`) **[à vérifier]** |
| OAuth token (RIE network) [S11] | `https://sandbox-oauth.aife.finances.rie.gouv.fr/api/oauth/token` | **[à vérifier]** |
| User APIs (port 5443) [R1] | `https://chorus-pro.gouv.fr:5443/service-qualif/utilisateurs/...` | `https://chorus-pro.gouv.fr:5443/service/utilisateurs/...` |

> **Rule:** complete **qualification** before requesting **production** connection [S12].

## 2. Required headers (confirmed) [S11]

| Header | Value | Notes |
|--------|-------|-------|
| `Authorization` | `Bearer <access_token>` | PISTE OAuth2 token |
| `Content-Type` | `application/json; charset=UTF-8` | All content UTF-8 |
| `cpro-account` | base64 of `logintechnique:password` | Chorus Pro **technical account** |

## 3. Confirmed endpoints — "Factures émises / flux" domain

Base: `/cpro/factures` (sandbox/prod) [R1]. Methods are POST unless noted. Endpoint paths below are
**used by this app** [R2/R6] and/or named in public docs [S5/S6/S8/S9].

| Method (functional) | Path (app) | Use case | Source |
|---------------------|-----------|----------|--------|
| `deposerFluxFacture` | `/v1/deposer/flux` | Deposit structured invoice flux (XML/Factur-X) | R2,R6,S8 |
| `deposerPDFFacture` | `/v1/deposer/pdf` | Deposit PDF, OCR → `INTERPRETEE_OCR` | R2,S9 |
| `soumettreFacture` | `/v1/soumettre` | Submit interpreted/structured invoice | R2,S9 |
| `consulterCR` | `/v1/consulterCR` | Consult flux integration report (compte rendu) | R6,S6 |
| `recupererFormatsFlux` | `/v1/recuperer/formatflux` | List accepted flux formats | R2,R6 |
| `recupererSyntaxesFlux` | `/v1/recuperer/syntaxeflux` | List accepted XML syntaxes | R2,R6 |
| `recupererModeDepot` | `/v1/recuperer/modedepot` | List deposit modes | R2 |
| `recupererCadreFacturation` | `/v1/recuperer/cadrefacturation` | List billing frameworks | R2 |
| `recupererTauxTVA` | `/v1/recuperer/tauxtva` | List valid VAT rates | R2 |
| `recupererDevises` | `/v1/recuperer/devises` | List currencies | R2 |
| `recupererModeReglements` | `/v1/recuperer/modereglements` | List payment modes | R2 |
| `recupererCoordBancValides` | `/v1/recuperer/coordbanc/valides` | List valid bank details | R2 |
| `recupererStructuresFournisseur` | `/v1/recuperer/structures/actives/fournisseur` | List active supplier structures | R2 |
| `rechercherDestinataire` | `/v1/rechercher/destinataire` | Search public recipient (annuaire) | R2 |
| `rechercherServiceExecutant` | `/v1/rechercher/serviceexecutant` | Search service exécutant (annuaire) | R2 |
| health | `/v1/health-check` (GET) | Service probe | R2 |

**Utilisateurs** (`/cpro/utilisateurs`): `/v1/consulter/compte`, `/v1/monCompte/recuperer/rattachements` [R2].
**Transverses** (`/cpro/transverses`): cross-cutting reference services; full path list **[à vérifier in S7]**.

> The exact request/response/error schemas per method live in the **Dossier de Spécifications Externes –
> Annexe Services API** [S7/S13]. **Parsed 2026-06-07 (V5.00)** → see **`CHORUS_SPEC_EXTRACT.md`** for the
> confirmed method I/O, format/syntax enumerations, `etatCourantFlux` states and error tables. Methods not
> detailed there remain **[à vérifier in S7/S13]**.

## 4. Accepted formats & deposit limits

- Formats/syntaxes: **UBL, CII (UN/CEFACT), Factur-X / PDF-A3**; PDF (OCR route) [R2,S8,S9].
- The **authoritative accepted list is environment-dependent** and is read live via
  `recuperer/formatflux` + `recuperer/syntaxeflux` [R2] — do not hard-code.
- **Flux size limit: ≤ 10 Mo non compressé / 30 Mo compressé** for `deposerFluxFacture`
  (spec V5.00 §2.1.1.1; error **20001** if exceeded). Note: **120 Mo** is the *download* limit of
  `telechargerGroupeFacture` (§2.1.1.24, error 413) — **not** the flux deposit limit. See `CHORUS_SPEC_EXTRACT.md`.

## 5. Operator interface used by this app (internal bridge)

Chorus Pilot's backend proxies the above and a **G2B** operator interface. These `/api/chorus/*` and
`/api/g2b/*` routes are **app-internal**, not Chorus Pro public endpoints [R2,R3]. G2B code interfaces:
`FSO3110A`, `FSO3117A`, `FSO3300A`, `FSO6000A` [R3]. See `api_endpoints.csv` / `api_catalog_map.json`.

## 6. Sources

S4 OAuth2 fiche pratique · S5 Rechercher factures · S6 Monitoring flows · S7 Spéc. Externes V4.14 PDF ·
S8 Submit flow invoice · S9 Traiter une facture · S11 Help for API developers in OAuth2 mode
(`/documentation/help-for-api-developers-in-oauth2-mode/`) · S12 Périmètre et prérequis
(`/documentation/perimetre-et-prerequis-2/`) · S13 Spéc. Externes V5.00 PDF
(`/wp-content/uploads/2020/04/Specifications_Externes_Annexe_Services_API_V5.00.pdf`). Repo: R1–R6.

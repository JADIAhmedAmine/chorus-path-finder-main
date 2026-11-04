# Scrape Summary — Chorus Pro / PISTE (public sources)

> **Generated:** 2026-06-07 · **Skill:** site-scraper
> **Scope:** public pages only. **No** login/captcha/paywall/anti-bot bypass. robots.txt checked.

## Run report

| Metric | Value |
|--------|-------|
| Hosts probed | 3 (piste.gouv.fr, communaute.chorus-pro.gouv.fr, developer.aife.economie.gouv.fr) |
| Pages visited (HTTP 200) | 7 |
| Pages fully/partially extracted | 6 |
| Pages skipped | 3 (1 DNS-dead, 1 JS/auth catalog, 1 large PDF not parsed) |
| Repository primary sources used | 6 (R1–R6) |
| Records extracted | 9 flux states, 4 portal invoice statuses, 5 API methods, search params, formats, auth facts |
| Login/anti-bot bypass | **None** |

## What was extracted (with sources)

- **Authentication** — PISTE is the OAuth2 gateway since **Jan 2020** [S4]. Sandbox/prod token + API base URLs and the two-level auth model (PISTE bearer + Chorus Pro `cpro-account`) are confirmed from the repository [R1] and the OAuth2 fiche pratique [S4].
- **Flux deposit** — `deposerFluxFacture` accepts **XML or PDF/A3, ≤ 10 Mo non compressé / 30 Mo compressé** [S8]; PDF route uses OCR → `INTERPRETEE_OCR` → `soumettreFacture` [S9].
- **Compte rendu / monitoring** — `consulterCR` returns the integration report; **9 flux states** (Received → Integrated / Rejected / Partially integrated); a flux carries **1..N invoices** with complete vs partial rejection [S6].
- **Invoice search & statuses** — search by SIRET, VAT, framework, number, amount, rejected filter; portal statuses **Brouillon / Rejetée / À recycler / Suspendue** [S5]; full machine status set (60+) in `status-utils.ts` [R5].
- **Formats** — UBL, CII (UN/CEFACT), Factur-X / PDF-A3; the exact accepted list is read live via `recuperer/formatflux` + `recuperer/syntaxeflux` [R2][S8].

## What could NOT be extracted (honest gaps)

1. **PISTE API catalog list** — JavaScript-rendered and full detail behind authentication → **not visible publicly**. Endpoint specifics were taken from the Communauté docs and the repository instead.
2. **OAuth2 fine detail** (exact grant type, scopes) — inside the **OAuth2 PDF** [S4], not parsed → marked **[à vérifier]**.
3. **Authoritative endpoint/parameter/error tables** — inside the **Spécifications Externes Annexe Services API** PDF [S7], not parsed in this pass (recommended deep read).
4. **`developer.aife.economie.gouv.fr`** — DNS dead; consolidated into PISTE. (⚠️ The app's `officialSources.ts` currently links this dead host — see recommendation below.)

## Recommendations

- Deep-read **[S7]** and **[S4]** PDFs to lock API contracts and OAuth2 parameters.
- Update `src/lib/flux/officialSources.ts` to point at a live PISTE URL (e.g. `https://piste.gouv.fr/`) instead of the dead `developer.aife.economie.gouv.fr`.
- Re-verify the **B2B e-invoicing reform calendar** from the official source before using any date.

See `context_pack.md` and the `api_*` files for the structured downstream maps.

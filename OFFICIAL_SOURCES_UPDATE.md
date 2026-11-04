# Official Sources Update

> **Date:** 2026-06-07 · **Scope:** documentation + `src/lib/flux/officialSources.ts` only (no product code changed)

## 1. Obsolete source

| Field | Value |
|-------|-------|
| **Label** | Portail développeur AIFE |
| **URL** | `https://developer.aife.economie.gouv.fr/` |
| **Problem** | **DNS does not resolve** (`curl: (6) Could not resolve host`). The host has been decommissioned / consolidated into PISTE. |
| **First introduced** | `officialSources.ts` (SOURCE_PISTE `url`) created in the previous Flux-hub task |

## 2. Replacement

| Field | Value |
|-------|-------|
| **Label** | Catalogue API PISTE |
| **URL** | `https://piste.gouv.fr/` |
| **Verified** | HTTP 200 (2026-06-07) |
| **Rationale** | PISTE replaced the legacy Chorus Pro / AIFE API platform in **January 2020** (confirmed by the Communauté Chorus Pro OAuth2 fiche pratique). It is the current State API gateway. |

## 3. Sources now maintained in `officialSources.ts`

| Constant | Label | URL | curl check (2026-06-07) | Notes |
|----------|-------|-----|--------------------------|-------|
| `SOURCE_PISTE` | Catalogue API PISTE | https://piste.gouv.fr/ | **200** | Replaces dead AIFE dev host |
| `SOURCE_CHORUS_PRO` | Documentation Chorus Pro / AIFE | https://communaute.chorus-pro.gouv.fr/ | **200** | Functional + API docs |
| `SOURCE_AIFE` | AIFE | https://aife.economie.gouv.fr/ | **200** | `www.` variant does NOT resolve — use apex host |
| `SOURCE_IMPOTS` | impots.gouv.fr (DGFiP) | https://www.impots.gouv.fr/ | **200** | B2B reform / PDP-PPF |
| `SOURCE_ECONOMIE` | economie.gouv.fr | https://www.economie.gouv.fr/ | **403 to curl** | Valid official site; 403 is anti-bot on HEAD, reachable in a browser |
| `SOURCE_AIFE_DEVELOPER_LEGACY` | Portail développeur AIFE (obsolète) | https://developer.aife.economie.gouv.fr/ | **DNS fail** | `deprecated: true`, `replacedBy` PISTE — kept for traceability, NOT shown in UI |

### Export structure (no UI regression)
- `OFFICIAL_SOURCES` (default shown by `OfficialSourcesBox`) = **[PISTE, Chorus Pro]** — unchanged count, UI stays clean.
- `ALL_OFFICIAL_SOURCES` = the 5 active sources (for pages that want the full list).
- `LEGACY_SOURCES` = the deprecated AIFE dev host (documented, not displayed).

## 4. Files modified

| File | Change |
|------|--------|
| `src/lib/flux/officialSources.ts` | Fixed PISTE URL; added AIFE/impots/economie; added `deprecated`/`replacedBy` fields; kept legacy host documented; added `ALL_OFFICIAL_SOURCES` + `LEGACY_SOURCES`. |
| `OFFICIAL_SOURCES_UPDATE.md` | This report (new). |

No component was changed: `OfficialSourcesBox` still reads `OFFICIAL_SOURCES` by default, so existing pages render identically (with a working PISTE link).

## 5. Still to verify (à vérifier)

- `economie.gouv.fr` returns 403 to automated HEAD requests (anti-bot). Confirmed valid in a browser; consider deep-linking to a specific stable page if needed.
- `impots.gouv.fr` **B2B e-invoicing reform calendar** (PDP/PPF dates) changes over time — re-verify before quoting any date in the product.
- AIFE apex host (`aife.economie.gouv.fr`) is used; if a more specific Chorus Pro landing page is preferred, update `SOURCE_AIFE.url`.

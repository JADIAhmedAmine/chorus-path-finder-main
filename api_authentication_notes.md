# API Authentication Notes — Chorus Pro via PISTE

> **Generated:** 2026-06-07 · **Skill:** api-doc-mapper
> **Sources:** repository `src/lib/chorus/storage.ts` / `client.ts` / `fluxDeposit.ts` [R1, R2];
> Communauté Chorus Pro OAuth2 fiche pratique [S4]. Items not confirmed are marked **[à vérifier]**.

## 1. Two-level authentication

Calling a Chorus Pro API through PISTE requires **two** stacked credentials:

1. **PISTE OAuth2 (gateway level)** — obtain a **Bearer access token** from the PISTE OAuth server
   using a PISTE application's `client_id` / `client_secret`.
   - Header on every API call: `Authorization: Bearer <access_token>` [R2]
   - Default scope observed in repo: `openid` [R1]
   - Grant type: **`client_credentials`** **[à vérifier — confirm in the OAuth2 PDF, S4]**

2. **Chorus Pro account (application level)** — identify the Chorus Pro user/raccordement behind the
   operator call via a **`cpro-account`** header containing the **base64 of `login:password`**
   [R1, R2 — confirmed by code comment in `src/lib/chorus/fluxDeposit.ts`].

> The legacy Chorus Pro API platform was replaced by **PISTE in January 2020** [S4]. The old host
> `developer.aife.economie.gouv.fr` no longer resolves.

## 2. Endpoints & base URLs (confirmed from repo [R1])

| Environment | OAuth token URL | API base URL |
|-------------|-----------------|--------------|
| **Qualification / Sandbox** | `https://sandbox-oauth.piste.gouv.fr/api/oauth/token` | `https://sandbox-api.piste.gouv.fr/cpro/factures` |
| **Production** | `https://oauth.piste.gouv.fr/api/oauth/token` | `https://api.piste.gouv.fr/cpro/factures` |

User APIs use a different host/port: `https://chorus-pro.gouv.fr:5443/service-qualif/...`
(qualification) and `.../service/...` (production) [R1].

## 3. Token flow (as implemented in Chorus Pilot)

The frontend never holds PISTE secrets directly. A **server bridge** performs the OAuth2 exchange:

```
POST /api/oauth/token              (PISTE)         -> access_token
  client_id, client_secret, grant_type, scope=openid
POST /cpro/factures/v1/<action>    (Chorus via PISTE)
  Authorization: Bearer <access_token>
  cpro-account: base64("login:password")
  body: <action payload>
```

In this repo the exchange is wrapped by `/api/chorus/oauth-token` and the calls go through
`/api/chorus/*` and `/api/g2b/*` bridge routes [R2, R3].

## 4. Approval / onboarding requirements

- A **PISTE account + application subscription** to the Chorus Pro APIs is required (gateway approval).
- A **Chorus Pro account/raccordement** (and structure rattachements) is required for the
  `cpro-account` level [R1].
- **Production access** typically follows successful **qualification** testing. **[à vérifier — exact
  promotion/approval gate is defined by AIFE/PISTE; confirm in S4/S7].**

## 5. Security observations

- Secrets (`client_secret`, Chorus `password`) must live **server-side** only — the repo already
  routes token retrieval through a backend bridge, which is correct.
- `cpro-account` is base64, **not encryption** — always over HTTPS, never logged.
- Separate `client_id/secret` per environment; never reuse sandbox creds in production [R1 presets].

## 6. Not visible publicly

- Per-API **OAuth scopes** beyond `openid` (PISTE catalog is auth-gated).
- Production **rate limits / quotas**.
- Exact **grant type** and token lifetime — confirm in the **OAuth2 fiche pratique PDF** [S4].

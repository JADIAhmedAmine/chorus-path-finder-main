# OAuth2 Connection Notes — Chorus Pro via PISTE

> **Generated:** 2026-06-07 · **Phase 0**
> **Now CONFIRMED** (previously "à vérifier"): the OAuth2 grant type and parameters, headers, and
> sandbox/prod hosts — sourced from the official "Help for API developers in OAuth2 mode" page [S11]
> and the OAuth2 fiche pratique [S4], cross-checked with the repository [R1/R2].

## 1. Authentication model (two levels)

1. **PISTE OAuth2** (gateway) → obtain a Bearer access token.
2. **Chorus Pro technical account** (application) → `cpro-account` header.

Both are required on each Chorus Pro API call.

## 2. Token request (CONFIRMED) [S11/S4]

```
POST https://sandbox-oauth.piste.gouv.fr/api/oauth/token        # qualification (app host, R1)
# or  https://sandbox-oauth.aife.economie.gouv.fr/api/oauth/token  # docs host, S11
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id=XXXXX
&client_secret=XXXXXXX
&scope=openid
```

- **grant_type:** `client_credentials` ✅ (confirmed) [S11]
- **scope:** `openid` ✅ (matches repo default) [S11/R1]
- **Production token URL:** `https://oauth.piste.gouv.fr/api/oauth/token` [R1]
- **Token lifetime:** not stated in parsed sources → **[à vérifier in S4 PDF]** (implement refresh-on-401).

## 3. Calling a Chorus Pro API (CONFIRMED headers) [S11]

```
POST https://sandbox-api.piste.gouv.fr/cpro/factures/v1/<action>   # app host (R1)
# or  https://sandbox-api.aife.economie.gouv.fr/cpro/factures/v1/<action>  # docs host (S11)
Authorization: Bearer <access_token>
Content-Type: application/json; charset=UTF-8
cpro-account: <base64( logintechnique:password )>

{ ...action payload... }
```

- `cpro-account` = base64 of `logintechnique:password` (Chorus Pro **technical user**) [S11].
- All content **UTF-8** [S11].

## 4. Environments & networks

| | Qualification / Sandbox | Production |
|--|--------------------------|-----------|
| OAuth (app) | sandbox-oauth.piste.gouv.fr | oauth.piste.gouv.fr |
| API (app) | sandbox-api.piste.gouv.fr/cpro/factures | api.piste.gouv.fr/cpro/factures |
| OAuth (RIE network) | sandbox-oauth.aife.finances.rie.gouv.fr | **[à vérifier]** |

> Rule: **qualification before production** [S12].

## 5. Prerequisites (CONFIRMED) [S12]

1. **PISTE application** created — its **name is case-sensitive** and "determinant for the success of
   future API calls" [S12].
2. **Chorus Pro structure** created on the portal + an **authorized user account** [S12].
3. For API mode: a **technical user** must be created [S12].
4. **Qualification connection** completed before production (unless the editor is already connected in
   qualification) [S12].
5. Connection requires **technical expertise** [S12]. Structures using a dematerialization **operator**
   have no direct connection requirement [S12].

## 6. How Chorus Pilot implements this today (repo) [R1/R2]

- Secrets are held **server-side**; the frontend calls a bridge route `/api/chorus/oauth-token` to get
  the token, then `/api/chorus/*` and `/api/g2b/*` proxy the Chorus calls [R2].
- Env presets (sandbox vs prod token/API URLs, scope `openid`) are in `src/lib/chorus/storage.ts` [R1].
- `cpro-account` base64 is built server-side (comment in `src/lib/chorus/fluxDeposit.ts`) [R2].

## 7. Security checklist (recommendations)

- [ ] Keep `client_secret` and Chorus `password` **server-side only** (already the case) [R2].
- [ ] Never log the `cpro-account` header or token.
- [ ] Separate credentials per environment; never reuse sandbox in prod [R1].
- [ ] Handle token expiry (refresh on `401`); cache token per environment.
- [ ] Enforce HTTPS everywhere; reject non-TLS.

## 8. Open items (à vérifier)

- Exact **token lifetime / refresh** semantics (S4 PDF, image-based — not parsed).
- Production **AIFE host** equivalents and **RIE** production URLs.
- Any **rate limits / quotas** (not stated publicly; PISTE app-level) — confirm on PISTE dashboard.

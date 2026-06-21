# MVP Scope — `feature/sage-integration-layer`

> Objectif de réussite : **« Chorus Pilot peut créer une facture dans Sage Accounting et lire son statut »** — de bout en bout, via le backend, pour un tenant connecté.

---

## 1. Énoncé du MVP

Un **`SageAccountingProvider`** (rôle `ErpProvider`) côté backend FastAPI qui :
1. établit et maintient une connexion **OAuth2** par tenant,
2. **crée une facture de vente** dans Sage à partir du `draft` existant,
3. **relit le statut** de cette facture par polling,
le tout exposé par **une UI minimale** (connecter, émettre, voir le statut).

---

## 2. Périmètre IN (must-have MVP)

### Backend
- **Token manager OAuth2** : authorization code, échange `code`→tokens, **refresh centralisé avec lock** (single-writer), stockage **chiffré** des tokens par tenant.
- **Résolution `X-Business`** via `GET /businesses` (cache par connexion).
- **Résolution des références** avec cache par tenant :
  - contact `CUSTOMER` (`GET/POST /contacts`),
  - `ledger_account_id` groupe INCOME (`GET /ledger_accounts`),
  - `tax_rate_id` FR (`GET /tax_rates`).
- **Mapping `draft` → payload Sage** `sales_invoice` (réutilise le modèle d'extraction existant).
- **`POST /sales_invoices`** avec `Idempotency-Key`, gestion 429/backoff.
- **`GET /sales_invoices/{id}`** → statut **de paiement** (champ séparé du lifecycle PDP).
- **Polling** statut via `updated_or_created_since` + pagination `$next` (réutiliser APScheduler/`sync.py`).
- **Persistance** : table de liaison `provider_invoices` (tenant, provider, external_id, payment_status, last_polled_at).
- **Audit** des appels Sage (sans secrets ; logguer `x_request_id`).

### Interface `Provider` (socle d'orchestration)
- Définir `ErpProvider` : `connect()`, `createInvoice(draft)`, `getInvoiceStatus(id)`, `listInvoices(since)`, `resolveReferences()`.
- `SageAccountingProvider` = première implémentation.
- (Le `PdpProvider` existe déjà *de facto* via Chorus Pro — juste le formaliser derrière l'interface, sans le réécrire.)

### Frontend (minimal)
- Écran **« Connecter Sage »** (lance OAuth, affiche statut de connexion).
- Action **« Émettre vers Sage »** sur une facture/draft.
- Affichage du **statut de paiement Sage** sur le détail facture.

---

## 3. Périmètre OUT (explicitement hors MVP)

- ❌ **Sage Network (rôle PDP)** — API non publique, chantier séparé.
- ❌ **Cegid / Docaposte** — itérations ultérieures.
- ❌ **Réception/import** de factures depuis Sage (le MVP est émission only).
- ❌ **Règles de routing avancées** (UI de routing ERP×PDP) — V1.
- ❌ **Avoirs / montants négatifs** (déjà bloqués dans le validateur existant).
- ❌ **Mapping multi-comptes complexe** : un compte INCOME + taux par défaut suffisent au MVP.
- ❌ **Multi-tenant strict** au-delà de ce qui existe déjà.

---

## 4. Definition of Done

- [ ] Un tenant connecte Sage en OAuth2 ; tokens stockés chiffrés ; refresh testé **sous concurrence**.
- [ ] `X-Business`, contact, compte INCOME et taux TVA FR résolus et cachés.
- [ ] Une facture du `draft` est créée dans le **sandbox Sage** (`POST /sales_invoices` → 2xx).
- [ ] Le statut de paiement est relu et **affiché dans l'UI**, distinct du lifecycle PDP.
- [ ] 429 géré (backoff) ; `Idempotency-Key` empêche les doublons.
- [ ] Aucun secret ni token côté navigateur ; aucun contenu de facture journalisé.
- [ ] Tests : token refresh (lock), mapping draft→payload, gestion d'erreurs API.
- [ ] `security-review` passée avant merge.

---

## 5. Pré-requis bloquants

1. **Compte développeur Sage** + application **sandbox** (`client_id`, `client_secret`, `redirect_uri`).
2. **Spec OpenAPI/Swagger Sage** récupérée → lancer **`api-doc-mapper`** pour figer les schémas exacts (champ SIRET du contact, énumérations de statut, formats).

---

## 6. Estimation indicative (ordre de grandeur)

| Lot | Effort relatif |
|---|---|
| Token manager OAuth2 + lock + stockage chiffré | M |
| Résolution références + caches | M |
| Mapping draft→payload + POST + erreurs | M |
| Polling statut (réutilise APScheduler) | S |
| Interface `Provider` + `SageAccountingProvider` | S |
| UI minimale (connecter / émettre / statut) | S |
| Tests + security-review | M |

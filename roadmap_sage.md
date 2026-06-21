# Roadmap — Couche d'intégration multi-ERP / multi-PDP

> Branche `feature/sage-integration-layer`. Fil conducteur : **Sage Accounting (MVP) → routing → Sage Network → Cegid/Docaposte**.

> ⚠️ **PIVOT (2026-06) — cible MVP = Iopole (PDP), pas Sage.**
> Constats portail : l'API e-facturation **Sage Network (PDP) n'est pas live**, et **Sage Accounting (REST)** n'est pas accessible depuis le compte (seul **X3 GraphQL** l'est, qui exige un tenant prod). Décision : valider l'architecture multi-PDP **maintenant** avec **Iopole** — PDP « API-first » (REST, client_credentials, **sandbox sans tenant**, Swagger public, webhooks).
> - **Sage reste un référentiel/cible future** : `SageAccountingProvider` (REST) sert d'exemple ERP ; X3 et Sage Network = backlog.
> - **Iopole = Phase 1 active** : `IopolePdpProvider` (rôle PDP), même interface que l'intégration Chorus Pro existante.
> - Bénéfice : la doc Iopole étant publique, **`api-doc-mapper` est exécutable** dès l'obtention de la sandbox.

---

## Phase 0 — Pré-requis (déblocage)
- [ ] Créer un **compte développeur Sage** + application **sandbox**.
- [ ] Récupérer la **spec OpenAPI/Swagger** Sage Accounting.
- [ ] Lancer **`api-doc-mapper`** sur la spec → référence d'endpoints + schémas exacts (clore les `[À VÉRIFIER]` : champ SIRET contact, énum statuts, formats).
- **Sortie :** schémas figés, prêts à coder.

---

## Phase 1 — MVP : `SageAccountingProvider` (rôle ERP)
**But : « créer une facture dans Sage + lire son statut ».** Voir `mvp_scope_sage.md`.
- [ ] Token manager OAuth2 (refresh rotatif + lock, stockage chiffré par tenant).
- [ ] Résolution + cache : `X-Business`, contacts, ledger INCOME, tax_rates FR.
- [ ] Mapping `draft` → `sales_invoice` + `POST` (Idempotency-Key, 429/backoff).
- [ ] Polling statut paiement (APScheduler) + persistance `provider_invoices`.
- [ ] Interface `Provider` (ErpProvider) + UI minimale (connecter / émettre / statut).
- [ ] Tests (concurrence refresh, mapping, erreurs) + **`security-review`**.
- **Critère de sortie :** une facture du sandbox Sage créée et suivie, secrets côté backend.

---

## Phase 2 — Orchestration & routing
- [ ] Formaliser **Chorus Pro derrière `PdpProvider`** (sans réécriture).
- [ ] **Moteur de routing** : règle *ERP source × PDP destination* (ex. B2G→Chorus, B2B→PDP).
- [ ] Import (réception) depuis Sage via `listInvoices` (`updated_or_created_since`).
- [ ] Dashboard KPI par provider / par PDP.
- **Critère de sortie :** une facture peut être *créée dans un ERP* puis *routée vers une PDP* via des règles.

---

## Phase 3 — `SageNetworkProvider` (rôle PDP)
- [ ] Lever le blocage : accès à l'**API PDP Sage Network** (partenariat / doc privée).
- [ ] Implémenter `PdpProvider` Sage Network (deposit + lifecycle status).
- [ ] Routing Chorus ↔ Sage Network selon B2G/B2B.
- **Dépendance / blocage confirmé (2026-06)** : l'API e-facturation Sage (send/receive,
  lifecycle, formats) est annoncée « **not live for development yet** » sur le portail
  développeur. On ne peut que **planifier**, pas coder dessus. La voie buildable
  aujourd'hui est donc le **rôle ERP (Sage Accounting REST)**, pas le rôle PDP.

---

## Phase 4 — Extension multi-connecteurs
- [ ] **CegidProvider** (ErpProvider).
- [ ] **DocaposteProvider** (PdpProvider).
- [ ] Catalogue de providers + activation par tenant.

---

## Critères pour ajouter un nouveau provider
Un nouveau connecteur n'est intégré que s'il coche :
1. **Rôle clair** : ErpProvider (source) ou PdpProvider (routing) — pas les deux mélangés.
2. **API documentée + sandbox** disponible (sinon Phase "blocked").
3. **Auth** mappable sur le token manager existant (OAuth2 de préférence).
4. **Mapping** possible depuis le `draft`/modèle interne sans champ bloquant.
5. **Suivi de statut** : webhooks ou polling identifié.
6. **Tests + security-review** passés.

---

## Décisions à trancher (avant Phase 1)
1. **Segment** : Sage Accounting cible micro/PME — est-ce ton marché ? (sinon X3/100 = autre socle).
2. **Émission only** au MVP (pas de réception Sage) — OK ?
3. **Modèle de statut** : deux champs séparés (paiement ERP vs lifecycle PDP) — validé ?
4. **Stockage credentials** : chiffrement au repos + rotation — quelle solution (KMS, secret backend) ?

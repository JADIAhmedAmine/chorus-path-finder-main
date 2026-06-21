# Product Opportunity Map — Sage Integration Layer

> Branche `feature/sage-integration-layer` · Chorus Pilot · 2026-06-21
> Source de contexte : `context_pack_sage.md`. Décision cadre : modéliser **deux rôles de provider** (`ErpProvider` / `PdpProvider`).

---

## 1. Le problème produit

Avec la réforme FR (réception 2026, émission 2026/2027), chaque entreprise doit faire **circuler ses factures** entre :
- son **ERP / outil de facturation** (où la facture *naît* — ex. Sage Accounting),
- une **PDP / Plateforme Agréée** (qui la *transmet* — ex. Sage Network, Chorus Pro pour le B2G),
- l'**administration** (e-reporting).

Aujourd'hui, Chorus Pilot ne sait parler qu'au rôle **PDP côté Chorus Pro**, et ingère les factures via **PDF + extraction**. Il manque la capacité à **se brancher nativement sur l'ERP source** et à **orchestrer le routing**. C'est l'objet de cette branche.

| Pain point | Qui | Aujourd'hui | Opportunité |
|---|---|---|---|
| Ressaisie / export manuel ERP → plateforme | PME, cabinets | PDF + extraction OCR/regex faillible | **Créer la facture directement dans Sage via API** |
| Choix/lock-in d'une seule PDP | DAF, éditeurs | mono-PDP (Chorus) | **Routing multi-PDP** (Sage Network, Chorus, autres) |
| Statuts éclatés (paiement vs lifecycle e-facture) | exploitants | confusion | **Vue unifiée 2 statuts séparés** |
| Pas de vision multi-systèmes | groupes multi-entités | silos | **Hub d'orchestration ERP × PDP** |

---

## 2. Obligations & fenêtre de marché

- **1er sept. 2026** : réception obligatoire (toutes entreprises) + émission (GE/ETI).
- **1er sept. 2027** : émission obligatoire (PME/micro).
- Fenêtre 2026–2027 = **moment d'acquisition** : les entreprises choisissent leur stack maintenant. Un connecteur ERP propre est un **argument d'onboarding fort**.

---

## 3. Cartographie par module Chorus Pilot

| Module existant | Impact branche Sage |
|---|---|
| onboarding | **+ écran "Connecter un provider"** (OAuth2 Sage) |
| entity configuration | **+ mapping entité ↔ X-Business Sage**, comptes/taux par défaut |
| annuaire lookup | réutiliser le pattern de cache pour `contacts`/`ledger_accounts`/`tax_rates` |
| invoice emission | **+ "Émettre vers Sage"** (POST /sales_invoices) |
| dépôt de flux | inchangé (PDP Chorus) — devient un `PdpProvider` parmi d'autres |
| status tracking | **+ statut paiement Sage** (séparé du lifecycle PDP) |
| audit logs | **+ traçage des appels Sage** (sans secrets, x_request_id) |
| admin settings | **+ gestion des credentials/connexions providers par tenant** |
| dashboard | **+ KPI "factures par provider / par PDP"** |

---

## 4. Opportunités d'automatisation (API-enabled)

1. **Création de facture sans ressaisie** : draft Chorus Pilot → `POST /sales_invoices` Sage.
2. **Résolution automatique des références** (contact CUSTOMER, compte INCOME, taux TVA FR) avec cache par tenant.
3. **Polling de statut** réutilisant l'infra APScheduler (`sync.py`) — pas de webhooks Sage.
4. **Routing intelligent** : règle "ERP source × PDP destination" (B2G→Chorus, B2B→Sage Network/autre).
5. **Idempotence** native via `Idempotency-Key` (fiabilise retry/polling).

---

## 5. Couches UX manquantes

- Écran **connexions providers** (statut OAuth, expiration, reconnexion).
- **Assistant de mapping** entité ↔ business Sage + comptes/taux par défaut.
- **Vue facture multi-statut** : statut paiement (ERP) vs statut lifecycle (PDP).
- **Règles de routing** (par client/type → PDP cible).

---

## 6. Différenciation business

- **Positionnement "hub d'orchestration" neutre** : multi-ERP **et** multi-PDP, là où Sage Network ou Chorus seuls sont des silos.
- **Valeur** : l'utilisateur garde Chorus Pilot comme cockpit unique même s'il change de PDP ou d'ERP.
- **Monétisable** : par provider connecté, par volume de factures routées, par module (réconciliation, audit).

---

## 7. Beta-readiness gaps (issus de l'audit)

- Tokens OAuth **côté backend uniquement** (jamais navigateur) — Sage l'impose de fait (refresh rotatif 5 min).
- Stockage **chiffré des credentials providers** par tenant.
- Tests de **concurrence du refresh** (race condition = déconnexion définitive).
- Séparation stricte **statut paiement vs lifecycle PDP** dans le modèle de données.

---

## 8. Risques & dépendances

| Risque | Type | Décision à trancher |
|---|---|---|
| Sage Accounting cible micro/PME | marché | Valider que c'est ton segment (sinon X3/100 = autre chantier) |
| API PDP Sage Network non publique | dépendance | Reporter le rôle PDP Sage ; commencer par ERP |
| Doc officielle non scrapable | dépendance | Compte dev + OpenAPI manuelle avant `api-doc-mapper` |
| Refresh token rotatif | technique | Token manager single-writer/lock |
| Confusion statuts | UX/data | Deux champs de statut distincts |

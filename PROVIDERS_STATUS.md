# Couche providers — état & reprise

> Branche `feature/sage-integration-layer`. Wedge retenu : **émission B2B via PDP (PME)**,
> positionnement **OD (Opérateur de Dématérialisation) sur Iopole** (pas PDP soi-même).

## 🆕 MAJ 2026-06-21 (suite) — tranche frontend + multi-tenant DB
- **Frontend Iopole** : page [src/pages/IopolePage.tsx](src/pages/IopolePage.tsx) + client [src/lib/providers/iopole.ts](src/lib/providers/iopole.ts) + route `/providers/iopole` + **lien sidebar** (Plateformes > Iopole PDP).
- **Routes backend** `/api/providers/iopole/*` (health, invoices, status, emit, notifications, **connect**) montées + scopées tenant.
- **Stack complète lancée** (`docker compose up`) : page 200, route wirée, login OK → http://localhost:8081/providers/iopole.
- **Multi-tenant DB activé** : tables `provider_connections`/`provider_tokens` (migration `20260621_0006`), stores chiffrés (Fernet), `POST /connect` de provisioning, registre DB-aware (fallback bridge). **Validé end-to-end** : provision tenant → secret chiffré au repos → lecture DB → health live True.
- `PROVIDERS_ENCRYPTION_KEY` généré dans `.env.local`.
- Reste : **webhook Push** (persistance `provider_invoices` + réconciliation), UI de provisioning `/connect`, archivage légal.

## ✅ Fait et validé
- **Architecture générique** `ErpProvider` / `PdpProvider` (`chorus_python/providers/base.py`).
- **OAuth** : `authorization_code` (Sage) + `client_credentials` (Iopole), refresh single-writer.
- **Iopole connecteur** validé **live** (sandbox PPD) :
  - token Keycloak, `search`, `get_lifecycle_status` (DELIVERED), `get_status_history` (APPROVED/IN_HAND).
  - **round-trip émission prouvé** : `generate_invoice_document` (Factur-X 134 KB) → `deposit` (POST /v1/invoice) → statut `INVALID/REJECTED` (attendu : vendeur de test non enregistré).
- **Multi-tenant (Phase 1 étape 1)** : `crypto.TokenCipher` (Fernet), `EncryptedTokenStore`,
  `ProviderRegistry.iopole_for(tenant)` isolé par tenant (clé `tenant:iopole`).
- **Docker** : `docker-compose.frontend.yml` (UI sur http://localhost:8081).
- **api-doc-mapper** : `api_*_iopole.*` (endpoints confirmés).
- **31 tests verts** au total (providers).

## 🔑 Faits clés à réutiliser
- Base API Iopole = **host racine** (`https://api.ppd.iopole.fr`), pas `/v1/api/operator/invoicing` (= emplacement du spec seulement).
- Token PPD : `https://auth.preprod.iopole.fr/realms/iopole/protocol/openid-connect/token` (client_credentials).
- Header **`customer-id`** (UUID) = le tenant côté Iopole → **modèle opérateur→customers** = notre multi-tenant.
- Émission : `POST /v1/invoice` multipart `file` (pdf/xml) → `{type, id}` (async).
- Statut lifecycle = `metadata.state` (enum) ; détail accusés = `status-history[].status.code`.
- Génération conforme : `POST /v1/tools/{facturx|ubl|cii}/generate` (depuis JSON Iopole) → **remplace le générateur UBL maison**.
- `expand` = liste **séparée par virgules** (répété → 500).
- Creds sandbox dans `.env.local` (gitignoré) : `IOPOLE_*`. ⚠️ **Régénérer le secret** (exposé en chat).

## ⏭️ Prochaines étapes (reprise après reset)
1. **Persistance DB** : remplacer les backends en mémoire de `connections.py` par des tables
   PostgreSQL chiffrées (`provider_connections`, `provider_tokens`) + migration Alembic +
   `EncryptedTokenStore` adossé à la DB (partagé entre workers → le verrou de refresh devient réel).
2. **Routes FastAPI** `/api/providers/iopole/*` (émettre, statut, annuaire) **scopées au tenant courant**
   (via `ProviderRegistry`) + `app.include_router` dans `scripts/chorus_submit_server.py`.
3. **Webhook Push** `/api/providers/iopole/notifications` (statuts entrants) + table `provider_invoices` + réconciliation/retry.
4. **Provisioning** : créer le `customer-id` Iopole d'un tenant à l'onboarding (confirmer l'API opérateur Iopole).
5. **Archivage légal (10 ans)** + piste d'audit.
6. **UI** : écran « Émettre via Iopole » + suivi statut (le front Docker pourra piloter).
7. **Générer `PROVIDERS_ENCRYPTION_KEY`** et l'ajouter à `.env.local` :
   `python -c "from chorus_python.providers.crypto import TokenCipher; print(TokenCipher.generate_key())"`

## ⚠️ Dette/risques produit (rappel audit)
Monolithe `chorus_submit_server.py` à éclater · vrai PDF + secret à purger de l'historique · CI/CD absent ·
différenciation PME (concurrence forte : viser PME **B2B+B2G** + ingestion PDF) · distribution via experts-comptables.

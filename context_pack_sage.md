# Context Pack — Sage Integration Layer (branche `feature/sage-integration-layer`)

> Construit pour Chorus Pilot, afin de spécifier un connecteur Sage comme premier « ERP/PDP provider ».
> Sources : portail Sage Developer (bloqué au scraping, 403) + sources techniques secondaires + pages Sage France. Voir `context_sources_sage.json`.
> Date de construction : 2026-06-21. Faits marqués `[CONFIRMÉ]`, `[À VÉRIFIER]`, `[HYPOTHÈSE]`.

---

## 1. Executive summary

Le mot « Sage » recouvre **deux briques distinctes** qu'il ne faut surtout pas confondre dans cette branche :

1. **Sage Accounting** (ex-Sage Business Cloud Accounting) — un **ERP/logiciel de facturation cloud** doté d'une **API REST publique moderne** (OAuth2). C'est *ici* qu'on crée des factures de vente et qu'on lit leur statut. **C'est la bonne cible technique pour le connecteur de cette branche.**
2. **Sage Network** — la **Plateforme Agréée (PA, ex-PDP)** de Sage, immatriculée auprès de la DGFiP pour router les factures électroniques B2B et faire l'e-reporting. C'est un **concurrent/pair de Chorus Pro**, pas un ERP.

➡️ **Clarification stratégique n°1 :** ton intuition « router PDF vers PDP vs Sage » mélange ces deux rôles. Dans la réforme FR, le routing se fait **vers une PDP** (Sage Network, ou Chorus Pro côté B2G, ou une autre PDP). **Sage Accounting est une *source* de factures (rôle ERP), pas une *destination* de routing (rôle PDP).** Ta couche d'intégration doit donc modéliser **deux types de providers** : `ErpProvider` (Sage Accounting, Cegid…) et `PdpProvider` (Chorus Pro — déjà fait, Sage Network, etc.).

➡️ **Recommandation produit :** pour cette branche, livrer un **`SageAccountingErpProvider`** (créer une facture, lire son statut de paiement, lister) via l'API REST publique. C'est documenté, sandboxable, et valide ton architecture d'orchestration multi-provider. L'intégration à **Sage Network en tant que PDP** est un chantier séparé (API PDP non publiquement documentée — voir Risques).

---

## 2. Official source map

| Source | Type | Accès | Usage |
|---|---|---|---|
| `developer.sage.com/accounting` | Officiel — portail dev Sage Accounting | ⚠️ 403 au scraping (Cloudflare) | OpenAPI/Swagger à récupérer via compte dev |
| `developer.sage.com/.../authentication` | Officiel — guide OAuth2 | ⚠️ 403 | Auth de référence |
| `sage.com/fr-fr/dematerialisation/...` | Officiel — Sage France PA/PDP | ⚠️ 403 | Statut Sage Network |
| Truto — guide d'intégration 2026 | Secondaire technique détaillé | ✅ | Détails OAuth2, endpoints, rate limits, polling |
| Apideck — blog + connector | Secondaire technique | ✅ | Registration OAuth2, objets facture |
| Cleverence — Sage developer reference | Secondaire comparatif | ✅ | Comparaison produits Sage |
| partner-informatique.fr | Secondaire FR | ✅ | Immatriculation PA Sage |
| medi.fr — Sage Network PDP | Secondaire FR | ✅ | Branding « Sage Network » |

> ⚠️ La doc officielle Sage bloque la récupération automatisée. La phase `api-doc-mapper` nécessitera un **compte développeur Sage** et le **téléchargement manuel de la spec OpenAPI/Swagger**.

---

## 3. Domain actors

- **Éditeur (toi / Chorus Pilot)** — consomme l'API Sage Accounting comme provider ERP ; oriente ensuite vers une PDP.
- **Sage Accounting (ERP cloud)** — source des factures via API REST. Cible : micro/petites entreprises. `[CONFIRMÉ]`
- **Sage Network (PA/PDP Sage)** — plateforme agréée DGFiP : réception, transmission, conversion des factures B2B + e-reporting + archivage. `[CONFIRMÉ]`
- **Chorus Pro / PPF** — déjà intégré dans Chorus Pilot (B2G + annuaire/concentrateur). Pair de Sage Network.
- **DGFiP** — immatricule les PA, fixe le calendrier, opère le PPF.
- **Futurs providers** — Cegid, Docaposte… (mêmes interfaces génériques).

---

## 4. Business processes

### Processus A — Émission via Sage Accounting (rôle ERP, objet de cette branche)
```
1. OAuth2 connect (autorisation utilisateur Sage) → access + refresh tokens
2. GET /businesses          → résoudre le X-Business (GUID de l'entité)
3. GET /contacts            → résoudre/créer le contact CUSTOMER (client)
4. GET /ledger_accounts     → résoudre le compte INCOME (par ligne)
5. GET /tax_rates           → résoudre le tax_rate_id FR (TVA 20/10/5.5…)
6. POST /sales_invoices     → créer la facture
7. GET /sales_invoices/{id} → relire le statut (statut de PAIEMENT, pas lifecycle PDP)
8. Polling incrémental via updated_or_created_since (pas de webhooks)
```

### Processus B — Routing PDP (hors périmètre de la branche, à modéliser)
```
Facture (ERP) → choix PDP (Sage Network | Chorus Pro | autre) → dépôt → suivi lifecycle
```

---

## 5. API / technical map — Sage Accounting `[CONFIRMÉ via sources secondaires]`

### Authentification (OAuth2 — Authorization Code)
| Élément | Valeur |
|---|---|
| Flow | Authorization Code grant |
| Authorization URL | `https://www.sageone.com/oauth2/auth/central` |
| Token URL | `https://oauth.accounting.sage.com/token` |
| Paramètres | `client_id`, `client_secret`, `redirect_uri` (exact match), `scope=full_access`, `state` (anti-CSRF) |
| **Access token TTL** | **5 minutes** ⚠️ |
| **Refresh token** | **Rotation à chaque usage** — chaque refresh invalide le précédent ⚠️ |
| Inscription | Compte sur `developer.sage.com` → `client_id` + `client_secret` |

> ⚠️ **Footgun critique :** TTL 5 min + refresh rotatif → deux workers qui rafraîchissent en parallèle **déconnectent définitivement le client**. Il faut un **refresh centralisé (single-writer / lock distribué)** côté backend. (Cohérent avec la reco d'audit : gestion des tokens côté serveur, jamais navigateur.)

### Base & headers
| Élément | Valeur |
|---|---|
| Base URL | `https://api.accounting.sage.com/v3.1/` (unique pour UK, IE, US, CA, **FR**, ES, DE) |
| Header obligatoire | `X-Business: {guid}` sur **chaque** requête (multi-entités) |
| Auth header | `Authorization: Bearer {access_token}` |
| Idempotence | `Idempotency-Key` sur les POST (anti-doublon) |
| Traçabilité | logguer `x_request_id` de la réponse (support Sage) |

### Endpoints clés
| Action | Endpoint |
|---|---|
| Lister les entités | `GET /businesses` |
| Créer facture vente | `POST /v3.1/sales_invoices` |
| Lire/relire facture | `GET /v3.1/sales_invoices/{id}` |
| Comptes (résolution) | `GET /ledger_accounts` (groupe INCOME) |
| Taux de TVA | `GET /tax_rates` (FR, **jamais en dur**) |
| Contacts | `GET/POST /contacts` (contact_type `CUSTOMER`) |

### Payload facture (mapping vers le draft existant de Chorus Pilot)
```json
{
  "sales_invoice": {
    "contact_id": "UUID",          // ← customer (résolu/créé)
    "date": "YYYY-MM-DD",          // ← invoice.invoice_date
    "due_date": "YYYY-MM-DD",      // ← invoice.due_date
    "reference": "string",         // ← invoice.invoice_number
    "invoice_lines": [
      {
        "description": "string",       // ← line.description
        "ledger_account_id": "UUID",   // ← résolu via /ledger_accounts (INCOME)
        "quantity": 0,                 // ← line.quantity
        "unit_price": 0,               // ← line.unit_price
        "tax_rate_id": "string",       // ← résolu via /tax_rates (FR/taux)
        "discount_amount": 0           // ← line.discount (optionnel)
      }
    ]
  }
}
```
> Les totaux HT/TVA/TTC sont **calculés par Sage** à partir des lignes (à rapprocher de la réconciliation de totaux déjà faite côté Chorus Pilot). Le **SIRET** se porte sur le `contact` (à mapper sur un champ identifiant/registration du contact). `[À VÉRIFIER]` : champ exact SIRET sur l'objet contact.

### Synchronisation & limites
| Élément | Valeur |
|---|---|
| Webhooks | ❌ Aucun → **polling obligatoire** (réutiliser APScheduler / `sync.py`) |
| Filtre incrémental | `updated_or_created_since` |
| Pagination | suivre l'URL `$next` (pas d'offset) |
| Rate limit / jour | **1 296 000 req/app/jour** |
| Concurrence | **150 requêtes simultanées max** |
| Dépassement | HTTP **429** → backoff exponentiel ; éviter les POST parallèles à référence unique |

### ⚠️ Sémantique du « statut »
Le statut renvoyé par Sage Accounting est un **statut de paiement** (impayé / partiel / payé), **pas** le statut *lifecycle e-facturation* (déposé / rejeté / accepté). Ce dernier relève de la **PDP** (Sage Network / Chorus Pro). Ne pas confondre dans l'UI ni le modèle de données.

---

## 6. Comparaison produits Sage (choix de cible) `[CONFIRMÉ]`

| Produit | API | Déploiement | Aptitude connecteur SaaS |
|---|---|---|---|
| **Sage Accounting** | **REST moderne, OAuth2** | Cloud | 🟢 **Le plus simple — cible recommandée** |
| Sage Intacct | Web services (XML + REST, signature HMAC) | Cloud | 🟠 Complexe (sender IDs, HMAC) |
| Sage X3 | Web services / objets métier (GraphQL + SOAP legacy) | On-prem & cloud | 🔴 Lourd, orienté grands comptes |
| Sage 100 / 300 | SDK + business objects | On-premise | 🔴 Pas d'API cloud publique |
| Sage 50 / 200 | API/SDK selon marché | On-premise | 🟠 Variable |

➡️ **Décision :** cibler **Sage Accounting** pour le premier provider. Cible client = micro/PME (à valider vs ton segment réel ; les grands comptes seraient sur X3/100).

---

## 7. Regulatory timeline (réforme FR e-facturation) `[CONFIRMÉ, dates à reconfirmer source DGFiP]`

- **Juillet 2025** : la DGFiP renomme « PDP » → **« Plateforme Agréée (PA) »**.
- **1er septembre 2026** : obligation progressive — **réception** d'e-factures pour toutes les entreprises ; **émission** pour grandes entreprises et ETI.
- **1er septembre 2027** : **émission** obligatoire pour PME et micro-entreprises.
- Seules les **PA immatriculées** par la DGFiP peuvent assurer transmission/réception/e-reporting. Sage Network **est immatriculée** (`[CONFIRMÉ]`, numéro `[À VÉRIFIER]`).
- Le **PPF** (Portail Public de Facturation) est recentré sur l'**annuaire** et la concentration de données ; le routing effectif passe par les PA/PDP.

---

## 8. Product implications pour Chorus Pilot

1. **Interface générique à deux rôles** (clé de la branche) :
   - `ErpProvider` : `createInvoice()`, `getInvoiceStatus()`, `listInvoices()`, `resolveReferences()` → implémenté par `SageAccountingProvider`.
   - `PdpProvider` : `deposit()`, `getLifecycleStatus()` → déjà incarné par Chorus Pro ; Sage Network plus tard.
2. **OAuth2 réutilisable côté backend** : token manager avec refresh **single-writer** (lock), stockage chiffré des tokens par tenant. **Jamais côté navigateur** (cf. audit).
3. **Réutilisation forte de l'existant** : polling de statut → APScheduler/`sync.py` ; caches de résolution (`ledger_accounts`, `tax_rates`, contacts) → même pattern que l'annuaire/références ; mapping facture → réutilise le `draft` model et la réconciliation de totaux.
4. **Routing PDP-vs-Sage clarifié** : ce n'est pas « PDP ou Sage », c'est « quel ERP source » × « quelle PDP destination ». Modéliser les deux axes.
5. **Idempotence** : exploiter `Idempotency-Key` pour fiabiliser les créations (anti-doublon, utile avec polling/retry).

---

## 9. Risks & constraints

| Risque | Gravité | Mitigation |
|---|---|---|
| Doc officielle non scrapable (403) | 🟠 | Compte dev Sage + spec OpenAPI manuelle pour `api-doc-mapper` |
| Refresh token rotatif + TTL 5 min | 🔴 | Refresh centralisé / lock distribué ; tests de concurrence |
| Statut Sage = paiement, pas lifecycle PDP | 🟠 | Séparer les 2 statuts dans le modèle & l'UI |
| API PDP « Sage Network » non publique | 🟠 | Hors périmètre branche ; `[À VÉRIFIER]` via partenariat Sage |
| Sage Accounting orienté micro/PME | 🟠 | Valider le segment client cible |
| Tax/ledger country-specific | 🟡 | Toujours résoudre via `/tax_rates` & `/ledger_accounts` FR |
| Pas de webhooks | 🟡 | Polling `updated_or_created_since` + `$next` |
| Numéro d'immatriculation PA Sage | 🟡 | `[À VÉRIFIER]` sur la liste officielle DGFiP |

---

## 10. Glossary

- **PDP / PA** : Plateforme de Dématérialisation Partenaire → renommée **Plateforme Agréée** (DGFiP, juillet 2025). Tiers immatriculé qui transmet/reçoit les e-factures.
- **PPF** : Portail Public de Facturation (annuaire + concentrateur de données).
- **Sage Network** : la PA/PDP de Sage (destination de routing, pair de Chorus Pro).
- **Sage Accounting** : l'ERP cloud de Sage avec API REST (source de factures).
- **e-reporting** : transmission des données de transaction/paiement à l'administration.
- **Factur-X / UBL / CII** : formats de facture électronique (déjà gérés côté Chorus Pilot).
- **ledger_account_id** : compte comptable Sage (groupe INCOME pour une vente).
- **tax_rate_id** : identifiant de taux de TVA Sage (résolu par pays).
- **X-Business** : header identifiant l'entité Sage ciblée.
- **Refresh token rotation** : invalidation du refresh token précédent à chaque échange.

---

## 11. Recommended next steps

1. **Trancher le périmètre** : confirmer **ERP-role (Sage Accounting)** pour cette branche (recommandé). ✅
2. **Compte développeur Sage** + application sandbox → `client_id`/`client_secret`/`redirect_uri`, récupérer la **spec OpenAPI/Swagger**.
3. **Lancer `api-doc-mapper`** sur la spec → référence d'endpoints exploitable (auth, sales_invoices, ledger_accounts, tax_rates, contacts, businesses).
4. **Concevoir l'interface `Provider`** (rôles ERP/PDP) — `product-strategy-mapper` peut cadrer le MVP + roadmap Cegid/Docaposte.
5. **Implémenter** le token manager OAuth2 (lock refresh) + le `SageAccountingProvider` côté backend FastAPI ; réutiliser le polling APScheduler.
6. **`security-review`** sur l'auth/secrets avant merge.

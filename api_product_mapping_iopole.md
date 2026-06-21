# Iopole API → Modules Chorus Pilot

> Mapping de l'API Iopole (PDP) vers les modules produit, pour le connecteur
> `IopolePdpProvider` (rôle PDP, même interface que l'intégration Chorus Pro).

| Module Chorus Pilot | Endpoint Iopole | Statut | Note d'intégration |
|---|---|---|---|
| **onboarding** | Get token (client_credentials) | 🟡 à confirmer | Réutilise `OAuth2TokenManager.get_client_credentials_token()` ; figer `IOPOLE_TOKEN_URL` |
| **organization/entity directory** (annuaire) | Directory lookup | 🟡 à confirmer | Résolution destinataire / routing code (Peppol / point-to-point) |
| **invoice submission** (dépôt de flux) | Emit invoice `POST …/operator/invoicing` | 🟡 base confirmée | `IopolePdpProvider.deposit()` ; contrat multipart vs base64 à figer |
| **invoice status tracking** | Get status + **webhook Push** | 🟡 à confirmer | `get_lifecycle_status()` + endpoint webhook entrant (mode Push) |
| **rejection/suspension correction** | Notification de rejet (validation) | 🟡 à confirmer | Iopole valide (structurel + sémantique) puis notifie le rejet |
| **reporting/statistics** | E-reporting | 🟡 à confirmer | Transmission données à l'administration |
| **audit/logging** | (transverse) | 🟢 prêt | Logguer `X-Request-Id` Iopole sans contenu/secret |

## Cohérence architecture
- Iopole remplit **`lifecycle_status`** (rôle PDP) — jamais `payment_status` (rôle ERP). C'est la séparation déjà câblée dans `providers/base.py` (`InvoiceStatus`).
- Le **mode Push** d'Iopole évite le polling : on expose un **endpoint webhook** `/api/providers/iopole/notifications` qui met à jour `provider_invoices`.
- Le `deposit()` Iopole consomme le **même flux UBL/Factur-X** que celui déjà généré par Chorus Pilot (`chorus_ubl_generator`) → réutilisation directe.

## Ce qui reste à figer (depuis le Swagger authentifié)
1. `token_url` exact + façon de passer les credentials + rôle du `CustomerId`.
2. Chemin exact + schéma de **emit invoice** (et format du document).
3. Endpoint + champ de **statut**, et **payload du webhook Push** (+ vérification de signature).
4. Endpoint **annuaire**.

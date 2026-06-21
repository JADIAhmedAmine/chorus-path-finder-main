# Iopole API — Notes d'authentification

> Provider : **Iopole** (Plateforme Agréée / PDP, e-facturation FR).
> Sources : docs.iopole.com, docs.ppd.iopole.fr, onboarding sandbox. Données non
> confirmables publiquement marquées **« not visible publicly »** (doc en rendu JS
> + Swagger protégé par auth — à confirmer depuis le Swagger authentifié).

## Modèle d'authentification
- **Type** : OAuth2 **client_credentials** (machine-to-machine) → **token Bearer**
  dans l'en-tête `Authorization: Bearer <token>`. *(confirmé)*
- **Credentials sandbox** (écran « Paramètres de la sandbox ») :
  - `Api Client ID` — identifiant client (en env)
  - `Api Client Secret` — **secret** (en env uniquement ; **à régénérer** s'il a fui)
  - `CustomerId` — **transmis dans le header `customer-id`** (UUID) *(confirmé via OpenAPI)*
  - `Mode de connexion` = **Push** → réception des statuts par **webhook** (pas de polling)
- **Token endpoint (CONFIRMÉ, Keycloak)** :
  - PPD : `https://auth.preprod.iopole.fr/realms/iopole/protocol/openid-connect/token`
  - Prod : `https://auth.iopole.com/realms/iopole/protocol/openid-connect/token` *(par analogie — à confirmer)*
  - Flow `clientCredentials`, **scopes vides**.
- **Comment passer les credentials** : Keycloak accepte `client_id`/`client_secret` en body form OU Basic. *(à valider en sandbox)*

## Transport & limites *(confirmé)*
- **HTTPS/TLS obligatoire** : toute requête non chiffrée échoue.
- **Rate limit** : **3 600 requêtes / minute / IP source** (niveau TCP).
- **Modèle asynchrone** : la plupart des appels modifiant une ressource sont async ; chaque description d'endpoint précise async ou non.

## Environnements *(confirmé)*
| Env | Base URL |
|---|---|
| **PPD (sandbox)** | `https://api.ppd.iopole.fr/v1` |
| **Production** | `https://api.iopole.com/v1` |

> Le gateway renvoie **401 à toute requête non authentifiée**, sur tous les chemins (impossible de distinguer un endpoint réel d'un faux sans token).

## Impact sur le connecteur
- Réutilise `OAuth2TokenManager.get_client_credentials_token()` (déjà implémenté).
- À figer dans `iopole/config.py` une fois le Swagger lu : `IOPOLE_TOKEN_URL`, et le rôle du `CustomerId`.

## Étape pour compléter (sûre)
Ouvrir **« Swagger API »** (navigateur authentifié) → bouton **Authorize** : il affiche le **tokenUrl** et le flow exact. Récupérer aussi le **swagger.json** (lien en haut de Swagger UI) → il fige tous les endpoints/schémas.

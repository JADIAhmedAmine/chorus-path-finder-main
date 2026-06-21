# Iopole API — Notes d'authentification

> Provider : **Iopole** (Plateforme Agréée / PDP, e-facturation FR).
> Sources : docs.iopole.com, docs.ppd.iopole.fr, onboarding sandbox. Données non
> confirmables publiquement marquées **« not visible publicly »** (doc en rendu JS
> + Swagger protégé par auth — à confirmer depuis le Swagger authentifié).

## Modèle d'authentification
- **Type** : OAuth2 **client_credentials** (machine-to-machine) → **token Bearer**
  dans l'en-tête `Authorization: Bearer <token>`. *(confirmé)*
- **Credentials sandbox** (écran « Paramètres de la sandbox ») :
  - `Api Client ID` — **not visible publicly** (propre au compte ; à mettre en env)
  - `Api Client Secret` — **secret** (en env uniquement ; **à régénérer** s'il a fui)
  - `CustomerId` — identifiant client ; **rôle exact à confirmer** (header `CustomerId` ? scope ? corps de la requête de token ?)
  - `Mode de connexion` = **Push** → réception des statuts par **webhook** (pas de polling)
- **Token endpoint (URL exacte)** : **not visible publicly**
  - À récupérer depuis le bouton **« Swagger API »** de la sandbox → dialogue **Authorize** (flow + tokenUrl), ou depuis la page doc *authentication*.
  - Candidats NON confirmés (ne pas coder en dur) : `…/auth/token`, `…/connect/token`.
- **Comment passer les credentials** (Basic header vs body) : **not visible publicly** → à confirmer.
- **Durée de vie du token / scopes** : **not visible publicly** → à confirmer.

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

# CI/CD developpement

La branche `developpement` declenche les workflows GitHub Actions suivants :

- `CI` : lint frontend, `npm run test`, build frontend, tests backend Python et validation Docker Compose.
- `Security` : blocage des fichiers `.env*` suivis par Git, scan simple de secrets, `npm audit` et `pip-audit`.
- `Deploy Development` : deploiement automatique sur le serveur de developpement apres une CI reussie.

## Secrets GitHub requis

Dans `Settings > Secrets and variables > Actions`, ajouter les secrets :

```text
DEV_SSH_HOST
DEV_SSH_USER
DEV_SSH_PRIVATE_KEY
```

Variables optionnelles :

```text
DEV_APP_DIR=/opt/chorus-path-finder-main
DEV_COMPOSE_PROJECT=chorus-path-finder-dev
```

## Prerequis serveur

Le serveur de developpement doit deja contenir :

- un clone du depot dans `DEV_APP_DIR` ;
- Docker et Docker Compose ;
- un fichier `.env.local` non versionne avec les secrets applicatifs ;
- `APP_HTTP_PORT=8081` si le port `8080` est occupe.

## Push initial

Depuis le poste de developpement :

```bash
git push -u origin developpement
```

Le deploiement partira ensuite automatiquement quand la CI aura reussi.

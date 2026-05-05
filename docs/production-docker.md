# Production Docker

Pour le test local actuel, les conteneurs utilisent les valeurs de `.env.local`.
Le fichier `.env.production` reste ignore par Git, mais il n'est pas utilise par `docker-compose.prod.yml` tant que ce compose pointe sur `.env.local`.

Commandes depuis la racine du repo:

```bash
docker-compose -p chorus-path-finder-prod --env-file .env.local -f docker-compose.prod.yml build
docker-compose -p chorus-path-finder-prod --env-file .env.local -f docker-compose.prod.yml up -d postgres
docker-compose -p chorus-path-finder-prod --env-file .env.local -f docker-compose.prod.yml run --rm migrate
docker-compose -p chorus-path-finder-prod --env-file .env.local -f docker-compose.prod.yml up -d chorus-api frontend
```

Acces local:

```text
http://localhost:8080
```

Verification:

```bash
docker-compose -p chorus-path-finder-prod --env-file .env.local -f docker-compose.prod.yml ps
docker-compose -p chorus-path-finder-prod --env-file .env.local -f docker-compose.prod.yml logs --tail=100 frontend chorus-api
```

Arret sans supprimer les donnees Postgres:

```bash
docker-compose -p chorus-path-finder-prod --env-file .env.local -f docker-compose.prod.yml down
```

Ne pas utiliser `down -v` sauf si tu veux supprimer les volumes Postgres et annuaire.

Avant exposition reseau:

- Remplacer `APP_AUTH_PASSWORD_HASH` par le hash bcrypt d'un vrai mot de passe.
- Remplacer `APP_AUTH_JWT_SECRET` par un secret neuf.
- Remplacer `APP_CORS_ORIGINS` par le domaine HTTPS final.
- Garder `SYNC_CRON_ENABLED=false` pendant le smoke test initial.
- Passer `SYNC_CRON_ENABLED=true` seulement quand la connexion Chorus prod et les donnees DB sont validees.

Generation d'un hash bcrypt:

```bash
.venv/bin/python -c "import bcrypt; print(bcrypt.hashpw(b'NOUVEAU_MOT_DE_PASSE', bcrypt.gensalt(rounds=12)).decode())"
```

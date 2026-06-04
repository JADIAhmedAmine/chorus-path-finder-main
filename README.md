# Chorus Pilot

Application React + FastAPI pour préparer, contrôler, synchroniser et soumettre des factures vers Chorus Pro via PISTE.

Le projet contient :

- un frontend React/Vite pour les écrans métier ;
- une API Python FastAPI pour l'authentification, les appels Chorus, l'extraction PDF et les données applicatives ;
- une base PostgreSQL pour les référentiels, factures et synchronisations ;
- une stack Docker de production avec nginx, API, migrations Alembic et Postgres.

## Sommaire

- [Vue d'ensemble](#vue-densemble)
- [Architecture](#architecture)
- [Démarrage local](#démarrage-local)
- [Déploiement Docker](#déploiement-docker)
- [Accès réseau](#accès-réseau)
- [Authentification](#authentification)
- [Configuration Chorus](#configuration-chorus)
- [Mode d'emploi applicatif](#mode-demploi-applicatif)
- [Base de données et synchronisation](#base-de-données-et-synchronisation)
- [Annuaire Chorus](#annuaire-chorus)
- [Tests et commandes utiles](#tests-et-commandes-utiles)
- [Dépannage](#dépannage)
- [Sécurité et exploitation](#sécurité-et-exploitation)

## Vue d'ensemble

Chorus Pilot sert à industrialiser le traitement des factures Chorus Pro :

- consultation des factures synchronisées depuis Chorus ;
- préparation d'une facture à partir d'un PDF ;
- extraction de texte PDF via le backend ;
- génération d'un payload Chorus ;
- upload PDF puis soumission via les API Chorus ;
- suivi des statuts, jobs et journaux d'appels ;
- pilotage des paramètres Chorus depuis la page `Paramètres`.

En production, le navigateur ne doit pas appeler directement Chorus avec des secrets. Le frontend passe par nginx, puis FastAPI, puis `chorus_python`.

## Architecture

```text
Navigateur
  -> nginx frontend
    -> React static app
    -> /api/* proxy vers FastAPI
      -> Auth JWT
      -> Extraction PDF
      -> API Chorus / PISTE
      -> API DB /api/db/*
        -> PostgreSQL
```

Fichiers principaux :

- `src/` : interface React ;
- `src/pages/SettingsPage.tsx` : page `Paramètres` et mode d'emploi intégré ;
- `src/lib/chorus/` : logique frontend Chorus ;
- `chorus_python/` : client Chorus, payload, extraction, DB, auth ;
- `scripts/chorus_submit_server.py` : serveur FastAPI ;
- `alembic/` : migrations PostgreSQL ;
- `docker/nginx/default.conf` : reverse proxy nginx ;
- `docker-compose.prod.yml` : stack Docker de production ;
- `.env` : variables lues par Docker Compose pour l'interpolation, notamment `APP_HTTP_PORT` ;
- `.env.local` : secrets et configuration applicative serveur.

## Démarrage local

### Frontend seul

```bash
npm install
npm run dev
```

Vite affiche l'URL locale, généralement :

```text
http://localhost:8081
```

### Backend Python local

Le backend nécessite Python 3.12 ou plus. Docker et la CI utilisent Python 3.12,
notamment pour la syntaxe Python moderne utilisée dans les modules DB.

```bash
python3.12 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python scripts/chorus_submit_server.py
```

Le backend écoute par défaut sur :

```text
http://127.0.0.1:8008
```

### Stack Docker locale

```bash
docker-compose -f docker-compose.prod.yml up -d --build
docker-compose -f docker-compose.prod.yml ps
```

Si `.env` contient :

```env
APP_HTTP_PORT=80
```

l'application sera disponible sur :

```text
http://localhost
```

Si le port `80` est déjà pris, remplacer temporairement par :

```env
APP_HTTP_PORT=8081
```

puis relancer :

```bash
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up -d --build
```

URL :

```text
http://localhost:8081
```

## Déploiement Docker

### Fichiers à transférer sur le serveur

Le serveur doit contenir le projet complet, notamment :

```text
docker-compose.prod.yml
Dockerfile.backend
Dockerfile.frontend
docker/nginx/default.conf
.env
.env.local
src/
chorus_python/
scripts/
alembic/
public/
package.json
package-lock.json
requirements.txt
```

Si le code passe par Git, attention : `.env.local` est ignoré par défaut car il contient des secrets. Il faut le créer ou le copier manuellement sur le serveur.

### Lancement

Depuis le dossier du projet sur le serveur :

```bash
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up -d --build
docker-compose -f docker-compose.prod.yml ps
```

Ne pas ajouter `-v` à `down` sauf si l'objectif est de supprimer les volumes Docker et donc les données PostgreSQL.

### Mise à jour après modification du code

```bash
docker-compose -f docker-compose.prod.yml up -d --build
```

Pour forcer une reconstruction complète :

```bash
docker-compose -f docker-compose.prod.yml build --no-cache
docker-compose -f docker-compose.prod.yml up -d
```

## Accès réseau

### Accès par IP

Si le serveur a l'IP :

```text
192.168.150.50
```

et si `.env` contient :

```env
APP_HTTP_PORT=80
```

l'application sera accessible depuis un poste du réseau avec :

```text
http://192.168.150.50
```

Si `APP_HTTP_PORT=8081` :

```text
http://192.168.150.50:8081
```

### Accès par nom interne

nginx est configuré pour accepter :

```text
chorusPilot.gigalis.local
```

Pour un test poste par poste, ajouter dans le fichier `hosts` Windows du poste client :

```text
192.168.150.50    chorusPilot.gigalis.local
```

Chemin Windows :

```text
C:\Windows\System32\drivers\etc\hosts
```

Pour un usage global, créer un enregistrement DNS interne :

```text
chorusPilot.gigalis.local -> 192.168.150.50
```

## Authentification

L'application utilise des utilisateurs applicatifs chargés côté serveur. En
priorité, l'API lit `config/auth-users.json` si ce fichier local existe. Ce
fichier est ignoré par Git et doit contenir uniquement les comptes réels du
serveur. Un modèle fictif est fourni dans `config/auth-users.example.json`.

Pour initialiser un fichier local :

```bash
cp config/auth-users.example.json config/auth-users.json
```

Si `config/auth-users.json` n'existe pas, l'application peut encore utiliser un
compte unique issu des variables `.env.local`.

Variables à configurer dans `.env.local` :

```env
APP_AUTH_EMAIL=admin@ton-domaine.fr
APP_AUTH_PASSWORD_HASH=set this in your local .env file
APP_AUTH_JWT_SECRET=set this in your local .env file
APP_AUTH_TOKEN_TTL_SECONDS=43200
```

Pour générer le hash du mot de passe :

```bash
python -c "import bcrypt; print(bcrypt.hashpw(b'TON_MOT_DE_PASSE', bcrypt.gensalt()).decode())"
```

Usage multi-utilisateurs actuel :

- plusieurs utilisateurs peuvent être déclarés dans `config/auth-users.json` ;
- les rôles serveur limitent les actions sensibles (`AUDITEUR`, `DEPOSANT`, `GESTIONNAIRE`, `ADMINISTRATEUR`) ;
- les données restent principalement mono-tenant par défaut ;
- pour un multi-tenant strict, chaque utilisateur doit porter le bon `tenantId`.

## Configuration Chorus

Les variables Chorus sont lues dans `.env.local`.

Variables de sélection d'environnement :

```env
CHORUS_ENV=prod
VITE_CHORUS_ENV=prod
```

Valeurs possibles :

- `qualif` : sandbox / qualification ;
- `prod` : production PISTE.

Variables serveur recommandées :

```env
CHORUS_PROD_CLIENT_ID=
CHORUS_PROD_CLIENT_SECRET=
CHORUS_PROD_TECHNICAL_LOGIN=
CHORUS_PROD_TECHNICAL_PASSWORD=
CHORUS_PROD_SUPPLIER_ID=
CHORUS_PROD_DESTINATAIRE_CODE=
CHORUS_PROD_SERVICE_EXECUTANT_CODE=
CHORUS_PROD_BANK_ACCOUNT_CODE=
```

En qualification, utiliser les équivalents :

```env
CHORUS_QUALIF_CLIENT_ID=
CHORUS_QUALIF_CLIENT_SECRET=
CHORUS_QUALIF_TECHNICAL_LOGIN=
CHORUS_QUALIF_TECHNICAL_PASSWORD=
CHORUS_QUALIF_SUPPLIER_ID=
```

Les variables `VITE_*` sont destinées au frontend. Toute variable `VITE_*` peut être visible dans le bundle navigateur. Pour les secrets de production, préférer les variables serveur `CHORUS_*`.

Endpoints principaux FastAPI :

- `GET /health` : santé de l'API ;
- `POST /api/auth/login` : connexion ;
- `GET /api/auth/me` : session courante ;
- `POST /api/chorus/oauth-token` : récupération d'un token OAuth2 côté serveur ;
- `POST /api/extract-pdf-text` : extraction texte PDF ;
- `POST /api/chorus/submit` : upload PDF puis soumission Chorus ;
- `POST /api/chorus/annuaire/sync` : synchronisation annuaire ;
- `GET /api/db/*` : données applicatives.

## Mode d'emploi applicatif

### 1. Se connecter

Ouvrir l'application, puis utiliser le compte configuré dans `.env.local`.

### 2. Vérifier les paramètres

Dans `Paramètres` :

- choisir l'environnement Chorus ;
- vérifier que le connecteur est activé ;
- vérifier l'endpoint backend de soumission ;
- renseigner ou récupérer le contexte technique Chorus ;
- cliquer sur `Tester la connexion`.

La page `Paramètres` contient maintenant un bloc `Mode d'emploi` avec les étapes d'exploitation les plus courantes.

### 3. Synchroniser les données

La synchronisation peut être déclenchée par le backend ou par le cron selon :

```env
SYNC_CRON_ENABLED=true
SYNC_CRON_INTERVAL_SECONDS=300
SYNC_CRON_MODE=delta
SYNC_CRON_PAGE_SIZE=3000
CHORUS_ALLOWED_SUPPLIER_IDS=
```

`CHORUS_ALLOWED_SUPPLIER_IDS` limite les structures fournisseur autorisées à être synchronisées.

### 4. Créer ou soumettre une facture

Flux général :

1. charger ou préparer la facture dans l'interface ;
2. extraire les données utiles du PDF ;
3. vérifier fournisseur, destinataire, service, montants et TVA ;
4. construire le payload Chorus ;
5. envoyer au backend ;
6. le backend appelle Chorus pour l'upload PDF puis la soumission ;
7. consulter le retour Chorus dans l'interface.

### 5. Suivre l'activité

Les écrans `Factures`, `Détail`, `Jobs`, `Audit`, `Archives` et `Références` s'appuient sur les endpoints `/api/db/*` ou sur les fallbacks JSON selon la configuration.

## Base de données et synchronisation

La base PostgreSQL est lancée par Docker :

```yaml
postgres:
  image: postgres:16-alpine
```

Les données sont conservées dans le volume :

```text
chorus_pg_data
```

Les migrations sont appliquées au démarrage par le service :

```text
migrate
```

Variables DB :

```env
POSTGRES_USER=chorus
POSTGRES_PASSWORD=chorus
POSTGRES_DB=chorus
DATABASE_URL=postgresql+psycopg://chorus:chorus@postgres:5432/chorus
CHORUS_DEFAULT_TENANT_ID=tenant-gigalis-default
```

En local hors Docker, `DATABASE_URL` peut pointer vers :

```env
DATABASE_URL=postgresql+psycopg://chorus:chorus@localhost:5432/chorus
```

## Annuaire Chorus

Le frontend peut charger les destinataires et services publics via :

- l'API DB `/api/db/public-customers` et `/api/db/public-services` ;
- le cache JSON `/annuaire/annuaire.normalized.json` ;
- un fallback XML si configuré.

Variable recommandée :

```env
VITE_REFERENCE_ANNUAIRE_JSON_URL=/annuaire/annuaire.normalized.json
```

Le volume Docker dédié :

```text
chorus_annuaire_data
```

est monté côté API et côté nginx pour partager les fichiers annuaire.

## Tests et commandes utiles

Pré-requis backend :

```bash
python3.12 --version
```

Installer les dépendances frontend :

```bash
npm install
```

Build frontend :

```bash
npm run build
```

Tests unitaires :

```bash
npm test
```

Lint :

```bash
npm run lint
```

Générer les données de test :

```bash
npm run build:test-data
```

Tester la configuration Docker Compose :

```bash
docker-compose -f docker-compose.prod.yml config
```

Voir les conteneurs :

```bash
docker ps
docker-compose -f docker-compose.prod.yml ps
```

Voir les logs :

```bash
docker-compose -f docker-compose.prod.yml logs -f frontend
docker-compose -f docker-compose.prod.yml logs -f chorus-api
docker-compose -f docker-compose.prod.yml logs -f postgres
```

Tester la santé HTTP :

```bash
curl -I http://localhost/health
curl -I http://192.168.150.50/health
```

## Dépannage

### Le port est déjà utilisé

Erreur typique :

```text
Bind for 0.0.0.0:8080 failed: port is already allocated
```

Identifier le conteneur :

```bash
docker ps
```

Arrêter le conteneur qui occupe le port :

```bash
docker stop NOM_DU_CONTENEUR
```

Ou changer le port dans `.env` :

```env
APP_HTTP_PORT=8080
```

### Le réseau Docker doit être recréé

Erreur typique :

```text
Network "chorus-path-finder-main_default" needs to be recreated
```

Solution :

```bash
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up -d --build
```

Ne pas utiliser `down -v` sauf suppression volontaire des données.

### L'application demande toujours la connexion

Vérifier :

- `APP_AUTH_EMAIL` ;
- `APP_AUTH_PASSWORD_HASH` ;
- `APP_AUTH_JWT_SECRET` ;
- l'heure du poste et du serveur ;
- l'expiration `APP_AUTH_TOKEN_TTL_SECONDS`.

Après modification de l'auth :

```bash
docker-compose -f docker-compose.prod.yml up -d --build
```

Puis se reconnecter dans le navigateur.

### La page ne répond pas depuis un autre poste

Vérifier :

- l'IP du serveur ;
- le port exposé dans `.env` ;
- le pare-feu serveur ;
- `docker-compose -f docker-compose.prod.yml ps` ;
- `curl -I http://IP_DU_SERVEUR/health`.

Sur Linux avec `ufw` :

```bash
sudo ufw allow 80/tcp
```

ou, si port 8081 :

```bash
sudo ufw allow 8081/tcp
```

### Le nom `chorusPilot.gigalis.local` ne résout pas

Tester :

```bash
ping chorusPilot.gigalis.local
```

Si le ping échoue :

- ajouter une ligne dans le fichier `hosts` du poste client ;
- ou créer l'entrée DNS interne ;
- ou utiliser directement l'IP serveur.

### La connexion Chorus échoue

Vérifier dans `Paramètres` :

- environnement `qualif` ou `prod` ;
- endpoint de test ;
- contexte technique Chorus ;
- credentials serveur dans `.env.local` ;
- logs `chorus-api`.

Logs :

```bash
docker-compose -f docker-compose.prod.yml logs -f chorus-api
```

## Sécurité et exploitation

Recommandations :

- ne jamais publier `.env.local` ;
- remplacer le mot de passe temporaire avant tout partage réseau ;
- générer une clé `APP_AUTH_JWT_SECRET` longue et unique ;
- éviter les secrets en `VITE_*` pour un build exposé à des utilisateurs ;
- ouvrir uniquement le port nécessaire, `80` ou `8081` ;
- sauvegarder régulièrement le volume PostgreSQL ;
- ajouter HTTPS avant une exposition large ou hors réseau interne ;
- garder le compte PISTE et le compte technique Chorus côté serveur.

Sauvegarde PostgreSQL indicative :

```bash
docker exec -t NOM_CONTENEUR_POSTGRES pg_dump -U chorus chorus > backup_chorus.sql
```

Restauration indicative :

```bash
docker exec -i NOM_CONTENEUR_POSTGRES psql -U chorus chorus < backup_chorus.sql
```

## URLs rapides

Local avec port 80 :

```text
http://localhost
```

Serveur par IP :

```text
http://192.168.150.50
```

Serveur par nom interne :

```text
http://chorusPilot.gigalis.local
```

## Auteur

Projet conçu et développé par Ahmed-Amine Jadi.

## Licence

Copyright (c) 2026 Ahmed-Amine Jadi. Tous droits réservés.

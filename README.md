# Chorus Path Finder

Interface React + Vite + TypeScript pour préparer et soumettre des factures Chorus Pro via PISTE, avec un mode `mock` et un mode `direct`.

## Démarrage

```bash
npm install
npm run dev
```

L'application démarre ensuite sur l'URL affichée par Vite, en général `http://localhost:8080`.

## Commandes utiles

```bash
npm run dev
npm test
npm run build
```

## Configuration

1. Copier `.env.example` vers `.env.local`
2. Renseigner les variables Chorus / PISTE sandbox
3. Lancer l'application
4. Vérifier la configuration dans la page `Settings`

Pour une soumission reelle, la configuration ne se limite pas au client OAuth2 et au compte technique. Il faut aussi renseigner le contexte Chorus utilise dans les payloads de soumission :

- `idUtilisateurCourant`
- `idFournisseur`
- `idServiceFournisseur`
- `codeCoordonneesBancairesFournisseur`
- eventuellement `codeCadreFacturation`, `codeServiceValideur`, `codeStructureValideur`
- les options de soumission comme `modePaiement`, `typeFacture`, `typeTva`

Depuis la page `Settings`, le projet peut maintenant tenter de récupérer automatiquement une partie de ce contexte via les API utilisateurs Chorus :

- `consulter/compte` pour `idUtilisateurCourant`
- `monCompte/recuperer/rattachements` pour `idStructure` et `idService`

Important :

- le body de `monCompte/recuperer/rattachements` est envoyé en `{}` par défaut
- le rapprochement `idFournisseur <- idStructure` et `idServiceFournisseur <- idService` est une inference applicative a confirmer avec votre environnement Chorus

Le projet garde une configuration persistée dans `localStorage` via `chorus.connector.config`. Si l'UI n'affiche pas les valeurs de `.env.local`, il faut réenregistrer la configuration ou vider cette clé.

En développement local avec `npm run dev`, les URLs officielles sandbox `https://sandbox-oauth.piste.gouv.fr` et `https://sandbox-api.piste.gouv.fr` sont automatiquement relayées via un proxy Vite local pour contourner les blocages CORS du navigateur. En production, ce proxy n'existe pas: il faut alors passer par un backend.

Le même mécanisme de proxy local est utilisé pour un serveur Ollama externe quand `GEN_PROVIDER=ollama` et `GEN_BASE_URL` sont définis.

## Pipeline actuelle

Flux réel aujourd'hui :

`PDF/XML upload` -> `lecture locale du fichier` -> `extraction heuristique / LLM` -> `normalisation du draft` -> `validation / préparation Chorus` -> `construction du payload Chorus` -> `validation du payload` -> `upload fichier API` -> `finalisation pieceJointePrincipale si depot PDF` -> `soumission API Chorus`

### Fichiers responsables

- [src/pages/InvoiceCreate.tsx](/mnt/c/users/ahmed-amine.jadi/chorus-path-finder-main/src/pages/InvoiceCreate.tsx)
  Rôle: écran d'upload, orchestration utilisateur, affichage des résultats d'extraction, correction manuelle, déclenchement de la soumission.
  Dépendances: `extractInvoiceData`, `mergeExtractionIntoDraft`, `prepareInvoiceSubmission`, `buildInvoiceSubmissionPayload`, `createChorusConnector`.
  Criticité: très élevée.

- [src/lib/chorus/extraction.ts](/mnt/c/users/ahmed-amine.jadi/chorus-path-finder-main/src/lib/chorus/extraction.ts)
  Rôle: lecture locale du PDF/XML et extraction heuristique des champs facture.
  Dépendances: APIs navigateur `File.text()`, `FileReader`, `arrayBuffer`, `TextDecoder`, expressions régulières.
  Criticité: très élevée.

- [src/lib/chorus/normalization.ts](/mnt/c/users/ahmed-amine.jadi/chorus-path-finder-main/src/lib/chorus/normalization.ts)
  Rôle: fusion du résultat d'extraction avec le draft UI et normalisation des données métier.
  Dépendances: types de pipeline.
  Criticité: élevée.

- [src/lib/chorus/normalizeSubmissionData.ts](/mnt/c/users/ahmed-amine.jadi/chorus-path-finder-main/src/lib/chorus/normalizeSubmissionData.ts)
  Rôle: normalisation dédiée au payload Chorus (`dates`, `montants`, `SIRET`, lignes de facture, lignes TVA, totaux).
  Dépendances: types de payload.
  Criticité: élevée.

- [src/lib/chorus/preparation.ts](/mnt/c/users/ahmed-amine.jadi/chorus-path-finder-main/src/lib/chorus/preparation.ts)
  Rôle: validation métier avant soumission et calcul de l'état `ready/review/blocked`.
  Dépendances: normalisation + types métier.
  Criticité: élevée.

- [src/lib/chorus/mappers.ts](/mnt/c/users/ahmed-amine.jadi/chorus-path-finder-main/src/lib/chorus/mappers.ts)
  Rôle: point d'entrée de mapping depuis le draft UI vers le payload Chorus typé.
  Dépendances: normalisation.
  Criticité: élevée.

- [src/lib/chorus/buildSubmissionPayload.ts](/mnt/c/users/ahmed-amine.jadi/chorus-path-finder-main/src/lib/chorus/buildSubmissionPayload.ts)
  Rôle: construction de l'objet JSON Chorus `soumettreDemandePaiement` / `soumettreFacture` à partir des données normalisées et du contexte applicatif.
  Dépendances: normalisation du draft + normalisation métier de soumission.
  Criticité: très élevée.

- [src/lib/chorus/validateSubmissionPayload.ts](/mnt/c/users/ahmed-amine.jadi/chorus-path-finder-main/src/lib/chorus/validateSubmissionPayload.ts)
  Rôle: validation finale du payload avant POST HTTP.
  Dépendances: types de payload.
  Criticité: très élevée.

- [src/lib/chorus/client.ts](/mnt/c/users/ahmed-amine.jadi/chorus-path-finder-main/src/lib/chorus/client.ts)
  Rôle: OAuth2 PISTE, headers Chorus, upload du fichier, soumission de la facture, mode mock/direct.
  Dépendances: `fetch`, config Chorus.
  Criticité: très élevée.

- [src/lib/chorus/technicalContext.ts](/mnt/c/users/ahmed-amine.jadi/chorus-path-finder-main/src/lib/chorus/technicalContext.ts)
  Rôle: conversion de la configuration UI / `.env` en contexte technique Chorus typé.
  Dépendances: `types/chorus` + types de payload.
  Criticité: élevée.

- [src/lib/chorus/storage.ts](/mnt/c/users/ahmed-amine.jadi/chorus-path-finder-main/src/lib/chorus/storage.ts)
  Rôle: chargement et persistance de la configuration Chorus.
  Dépendances: `localStorage`, variables `VITE_*`.
  Criticité: moyenne.

- [src/lib/chorus/types.ts](/mnt/c/users/ahmed-amine.jadi/chorus-path-finder-main/src/lib/chorus/types.ts)
  Rôle: types explicites de la pipeline facture.
  Dépendances: types métier globaux.
  Criticité: moyenne.

## Bibliothèques et mécanismes utilisés pour l'analyse PDF locale

Le projet n'utilise pas encore de vraie bibliothèque de parsing PDF structurée comme `pdf.js` ou un moteur OCR.

Analyse locale actuelle :

- lecture du fichier via les APIs navigateur
- extraction plus robuste des chaînes textuelles PDF quand le document n'est pas un simple texte brut
- extraction texte heuristique
- enrichissement optionnel par LLM local via Ollama
- détection par regex
- tentative de résolution vers les référentiels locaux `suppliers`, `publicCustomers`, `publicServices`

Conséquence directe :

- XML et PDF texte: cas les mieux couverts
- PDF scanné: faible couverture
- OCR: absent
- structure interne PDF: non interprétée
- Factur-X complet: non pris en charge comme pipeline dédiée

## Construction du payload Chorus

La construction du JSON Chorus se fait maintenant en plusieurs couches explicites :

- extraction locale : [src/lib/chorus/extraction.ts](/mnt/c/users/ahmed-amine.jadi/chorus-path-finder-main/src/lib/chorus/extraction.ts)
- normalisation du draft : [src/lib/chorus/normalization.ts](/mnt/c/users/ahmed-amine.jadi/chorus-path-finder-main/src/lib/chorus/normalization.ts)
- normalisation orientée soumission : [src/lib/chorus/normalizeSubmissionData.ts](/mnt/c/users/ahmed-amine.jadi/chorus-path-finder-main/src/lib/chorus/normalizeSubmissionData.ts)
- construction du payload : [src/lib/chorus/buildSubmissionPayload.ts](/mnt/c/users/ahmed-amine.jadi/chorus-path-finder-main/src/lib/chorus/buildSubmissionPayload.ts)
- validation finale : [src/lib/chorus/validateSubmissionPayload.ts](/mnt/c/users/ahmed-amine.jadi/chorus-path-finder-main/src/lib/chorus/validateSubmissionPayload.ts)
- envoi HTTP et finalisation `pieceJointePrincipale` apres `deposer/pdf` : [src/lib/chorus/client.ts](/mnt/c/users/ahmed-amine.jadi/chorus-path-finder-main/src/lib/chorus/client.ts)

### Provenance des champs

Champs venant du PDF / XML / texte extrait :

- numero de facture
- date facture
- date d'echeance
- SIRET fournisseur
- SIRET / code destinataire si detecte
- code service / libelle service si detecte
- numero d'engagement, marche, bon de commande
- montants HT / TVA / TTC
- lignes de facture et lignes TVA si elles sont detectables

Champs venant du contexte applicatif / backend / referentiels Chorus :

- `idUtilisateurCourant`
- `fournisseur.idFournisseur`
- `fournisseur.idServiceFournisseur`
- `fournisseur.codeCoordonneesBancairesFournisseur`
- `cadreDeFacturation.codeServiceValideur`
- `cadreDeFacturation.codeStructureValideur`
- toute autre cle technique Chorus qui ne figure pas sur la facture
- `idUtilisateurCourant` requis aussi par `deposer/pdf`

Point important :

- ces identifiants techniques ne doivent jamais etre deduits du PDF
- ils doivent etre fournis par le backend, un referentiel Chorus, ou la configuration de `Settings` / `.env` en environnement de sandbox

## Architecture actuelle

La logique est encore majoritairement côté frontend, mais elle est maintenant séparée par responsabilités :

- UI: `InvoiceCreate.tsx`
- extraction: `extraction.ts`
- normalisation: `normalization.ts`
- normalisation soumission: `normalizeSubmissionData.ts`
- validation métier: `preparation.ts`
- mapping Chorus: `mappers.ts` + `buildSubmissionPayload.ts`
- validation payload: `validateSubmissionPayload.ts`
- transport API: `client.ts`

## Architecture cible

Chemin conseillé pour la suite :

1. Conserver le frontend comme couche d'orchestration et de revue humaine
2. Déplacer l'extraction lourde côté backend
3. Remplacer l'heuristique locale par une pipeline plus robuste:
   `pdf text parser -> OCR fallback -> règles métier -> validation -> JSON canonique`
4. Ajouter un client dédié aux API de préparation Chorus:
   `rechercher structure -> consulter structure -> rechercher service structure -> soumettre`
5. Générer ou typer plus finement les payloads Chorus à partir du Swagger officiel

## Limites actuelles

- Le parsing PDF reste heuristique et sensible à la mise en page
- Pas d'OCR pour les scans
- Pas encore de client dédié pour les étapes Chorus de préparation structure/service
- Le payload de soumission est maintenant typé, mais certains champs Chorus restent dependants d'un contexte technique externe
- Les référentiels fournisseur/client/service sont encore locaux dans `mock-data`
- Sans `idUtilisateurCourant` / `idFournisseur` / `idServiceFournisseur` reels, la validation bloque volontairement le POST

## Tests

Les tests unitaires couvrent actuellement :

- extraction locale
- normalisation
- normalisation de soumission
- préparation / validation
- mapping payload Chorus
- validation du payload Chorus
- client Chorus
- stockage de configuration

Exécution :

```bash
npm test
```

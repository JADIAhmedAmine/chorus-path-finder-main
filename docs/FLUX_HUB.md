# Espace « Flux » — centre de pilotage Chorus Pro / PISTE

Cette note décrit la réorganisation introduite autour des **flux** Chorus Pro. L'objectif
est **produit** : regrouper des fonctionnalités qui existaient déjà, clarifier le parcours,
et expliquer chaque étape — sans recréer de logique métier ni inventer de règles Chorus Pro.

## 1. Ce qui a été ajouté

| Élément | Fichier | Rôle |
| --- | --- | --- |
| Page hub | [`src/pages/FluxHub.tsx`](../src/pages/FluxHub.tsx) | Vue d'ensemble `/flux` : accès rapide, pipeline, état global, bloc pédagogique. |
| Contenu centralisé | [`src/lib/flux/content.ts`](../src/lib/flux/content.ts) | Cartes d'accès, 10 étapes du pipeline, typologie des flux, textes d'aide par page. |
| Sources officielles | [`src/lib/flux/officialSources.ts`](../src/lib/flux/officialSources.ts) | Références PISTE + Chorus Pro / AIFE. |
| Tonalités statut flux | [`src/lib/flux/fluxStatus.ts`](../src/lib/flux/fluxStatus.ts) | Mapping libellé/couleur des statuts **techniques** de flux. |
| Façades de service | `src/lib/flux/{fluxService,annuaireService,invoiceService,fluxDepositsService}.ts` | Points d'import uniques pour le hub et les dépôts persistés. |
| Composants réutilisables | `src/components/flux/*` | `ProcessExplanationCard`, `OfficialSourcesBox`, `FluxPipeline`, `FluxSummaryCard`, `InvoiceSummaryCard`. |

Aucune route existante n'a été supprimée ou modifiée. La seule route nouvelle est `/flux`.

## 2. Navigation

Un groupe **« Flux »** a été ajouté en tête de la sidebar
([`AppSidebar.tsx`](../src/components/layout/AppSidebar.tsx)). Toutes ses entrées pointent
vers des pages **déjà existantes** :

| Sous-entrée | Route | Page existante |
| --- | --- | --- |
| Vue d'ensemble | `/flux` | `FluxHub` (nouvelle) |
| Déposer | `/invoices/flux` | `FluxDepositPage` |
| Préparer / Corriger | `/invoices/pdf-to-flux` | `PdfToFluxPage` |
| Suivi | `/invoices/g2b-flux` | `G2BFluxDepositPage` |
| Erreurs | `/invoices/rejections` | `EmissionRejections` |
| Factures liées | `/invoices` | `InvoiceList` |
| Annuaire | `/references/customers` | `References` |

Les groupes historiques (Réception, Émission, Référentiels) restent inchangés.

## 3. Composants réutilisables

- **`ProcessExplanationCard`** — carte d'aide pédagogique (titre, description, contexte
  officiel, étapes, données requises, erreurs fréquentes, prochaine action, sources). Le
  détail est repliable pour ne pas surcharger les pages. Présente sur les pages : dépôt,
  dépôt G2B (suivi), PDF → flux, factures, annuaire, rejets.
- **`OfficialSourcesBox`** — encadré « Sources officielles » réutilisable.
- **`FluxPipeline`** — stepper des 10 étapes. Neutre sur le hub (vue de référence) ;
  accepte un tableau d'étapes avec statut (`idle` / `in_progress` / `valid` / `error`)
  pour suivre un flux réel.
- **`FluxSummaryCard`** / **`InvoiceSummaryCard`** — fiches de résumé uniformisées, avec
  boutons d'action contextuels (Voir détail / Corriger / Suivre / Voir facture).

## 4. Données & statistiques

Les indicateurs factures restent dérivés du cache via `computeFluxHubStats`. Les métriques
de dépôt utilisent désormais :

- `GET /api/chorus/flux/deposits`
- `GET /api/chorus/flux/deposits/stats`
- `POST /api/chorus/flux/deposits/refresh-cr`
- `POST /api/chorus/flux/deposits/{deposit_id}/refresh-cr`

Le bouton **« Actualiser les CR »** lance le refresh batch, affiche ses états de chargement
et d'erreur, puis recharge les KPI. Les états officiels viennent du CR persisté quand il
existe ; sinon le hub conserve le mapping best-effort P2-1. Aucune valeur n'est inventée.

## 5. Règle éditoriale (important)

Tous les textes d'aide sont rédigés prudemment et rattachés aux sources officielles :

- **Catalogue API PISTE** — API Chorus Pro / G2B (Annuaire, Dépôt de flux, Recherche de factures).
- **Documentation Chorus Pro / AIFE** — typologie des flux, formats, comptes rendus
  d'intégration, cycle de vie et statuts.

Toute règle métier non confirmée par une source officielle est explicitement marquée
**« à vérifier »** et ne doit pas être présentée comme certaine. Pour modifier un texte,
éditer `src/lib/flux/content.ts` (source unique) plutôt que les pages.

/**
 * Sources officielles utilisées pour rédiger les textes d'aide de l'espace Flux.
 *
 * IMPORTANT (règle produit) :
 * - On ne cite ici que des portails/documentations officiels et stables.
 * - Toute règle métier qui n'est pas confirmée par l'une de ces sources doit être
 *   présentée comme « à vérifier » dans l'interface, jamais comme une certitude.
 *
 * Mise à jour 2026-06-07 : le portail développeur historique de l'AIFE
 * (`developer.aife.economie.gouv.fr`) ne résout plus (DNS mort) ; il a été consolidé
 * dans PISTE. La source PISTE pointe désormais sur `https://piste.gouv.fr/`.
 * L'ancienne référence est conservée plus bas, marquée `deprecated`, pour traçabilité.
 * Voir OFFICIAL_SOURCES_UPDATE.md à la racine du projet.
 */

export interface OfficialSource {
  /** Libellé court affiché à l'utilisateur. */
  label: string;
  /** Ce que la source documente, en une phrase. */
  description: string;
  /** URL du portail officiel (page d'entrée stable). */
  url: string;
  /** Vrai si la source est obsolète et conservée uniquement pour traçabilité. */
  deprecated?: boolean;
  /** URL de remplacement si `deprecated`. */
  replacedBy?: string;
}

/**
 * PISTE — portail d'accès aux API de l'État.
 * Expose notamment les API Chorus Pro côté EDI/opérateur (familles « G2B ») :
 * Annuaire, Dépôt de flux et Recherche de factures.
 */
export const SOURCE_PISTE: OfficialSource = {
  label: 'Catalogue API PISTE',
  description:
    "Portail d'accès aux API de l'État. Référence les API Chorus Pro (familles G2B : Annuaire, Dépôt de flux, Recherche de factures) et leurs conditions d'accès.",
  url: 'https://piste.gouv.fr/',
};

/**
 * Communauté Chorus Pro (AIFE) — documentation fonctionnelle et API.
 * Référence la typologie des flux, les formats, les comptes rendus d'intégration,
 * le cycle de vie et les statuts.
 */
export const SOURCE_CHORUS_PRO: OfficialSource = {
  label: 'Documentation Chorus Pro / AIFE',
  description:
    "Communauté Chorus Pro : typologie des flux, formats acceptés, comptes rendus d'intégration, cycle de vie et liste des statuts.",
  url: 'https://communaute.chorus-pro.gouv.fr/',
};

/** AIFE — Agence pour l'Informatique Financière de l'État (opérateur de Chorus Pro). */
export const SOURCE_AIFE: OfficialSource = {
  label: 'AIFE',
  description:
    "Agence pour l'Informatique Financière de l'État : opérateur de Chorus Pro et de PISTE.",
  url: 'https://aife.economie.gouv.fr/',
};

/** impots.gouv.fr — DGFiP : réforme de la facturation électronique (B2B), PDP/PPF. */
export const SOURCE_IMPOTS: OfficialSource = {
  label: 'impots.gouv.fr (DGFiP)',
  description:
    "DGFiP : réforme de la facturation électronique (B2B), plateformes de dématérialisation (PDP/PPF) et calendrier. À vérifier régulièrement.",
  url: 'https://www.impots.gouv.fr/',
};

/** economie.gouv.fr — Ministère de l'Économie : cadre général facturation électronique. */
export const SOURCE_ECONOMIE: OfficialSource = {
  label: 'economie.gouv.fr',
  description:
    "Ministère de l'Économie et des Finances : cadre général de la facturation électronique du secteur public et privé.",
  url: 'https://www.economie.gouv.fr/',
};

/**
 * @deprecated Ancien portail développeur AIFE — ne résout plus (consolidé dans PISTE).
 * Conservé uniquement pour traçabilité. Ne pas utiliser dans l'UI.
 */
export const SOURCE_AIFE_DEVELOPER_LEGACY: OfficialSource = {
  label: 'Portail développeur AIFE (obsolète)',
  description:
    "Ancien portail développeur de l'AIFE, remplacé par PISTE. Conservé pour traçabilité — ne plus utiliser.",
  url: 'https://developer.aife.economie.gouv.fr/',
  deprecated: true,
  replacedBy: 'https://piste.gouv.fr/',
};

/**
 * Sources affichées PAR DÉFAUT dans OfficialSourcesBox (UI épurée : 2 références clés).
 * Pour la liste complète, utiliser ALL_OFFICIAL_SOURCES.
 */
export const OFFICIAL_SOURCES: OfficialSource[] = [SOURCE_PISTE, SOURCE_CHORUS_PRO];

/** Toutes les sources officielles actives (non obsolètes). */
export const ALL_OFFICIAL_SOURCES: OfficialSource[] = [
  SOURCE_PISTE,
  SOURCE_CHORUS_PRO,
  SOURCE_AIFE,
  SOURCE_IMPOTS,
  SOURCE_ECONOMIE,
];

/** Sources obsolètes conservées pour traçabilité (à ne pas afficher). */
export const LEGACY_SOURCES: OfficialSource[] = [SOURCE_AIFE_DEVELOPER_LEGACY];

/**
 * Contenu pédagogique de l'espace Flux (centralisé).
 *
 * Tous les textes d'aide utilisateur vivent ici pour rester cohérents entre les pages
 * et faciliter la relecture métier. Les formulations restent prudentes : aucune règle
 * Chorus Pro n'est présentée comme certaine si elle n'est pas confirmée par une source
 * officielle (cf. officialSources.ts). Les points incertains sont marqués « à vérifier ».
 */

import type {
  LucideIcon,
} from 'lucide-react';
import {
  AlertTriangle,
  Archive,
  Building2,
  CheckCircle2,
  FileSearch,
  FileUp,
  ListChecks,
  Send,
  ShieldCheck,
  UploadCloud,
  Wand2,
  Workflow,
} from 'lucide-react';

/** Statut visuel partagé, aligné sur les tokens de design existants. */
export type FluxTone = 'success' | 'warning' | 'error' | 'neutral' | 'info';

export interface QuickAccessCard {
  id: string;
  title: string;
  description: string;
  to: string;
  icon: LucideIcon;
  tone: FluxTone;
}

/**
 * Cartes d'accès rapide du hub — chaque carte pointe vers une fonctionnalité
 * qui existe DÉJÀ dans l'application (aucune route inventée).
 */
export const QUICK_ACCESS_CARDS: QuickAccessCard[] = [
  {
    id: 'deposer',
    title: 'Déposer un flux',
    description:
      "Importer un fichier XML, UBL, CII ou Factur-X (PDF/A-3), détecter son format, extraire les données clés et préparer le dépôt via PISTE.",
    to: '/invoices/flux',
    icon: UploadCloud,
    tone: 'info',
  },
  {
    id: 'preparer',
    title: 'Préparer / corriger un flux',
    description:
      "Analyser les erreurs détectées avant dépôt : format, SIRET, TVA, montant, numéro de facture, destinataire, code service ou engagement juridique.",
    to: '/invoices/pdf-to-flux',
    icon: Wand2,
    tone: 'warning',
  },
  {
    id: 'suivi',
    title: 'Suivi des flux',
    description:
      "Suivre les flux déposés, leurs statuts techniques, leurs comptes rendus d'intégration et les factures associées.",
    to: '/invoices/g2b-flux',
    icon: Workflow,
    tone: 'neutral',
  },
  {
    id: 'factures',
    title: 'Factures liées aux flux',
    description:
      "Accéder aux factures émises, reçues, suspendues, rejetées ou à compléter, avec une fiche unifiée.",
    to: '/invoices',
    icon: FileSearch,
    tone: 'info',
  },
  {
    id: 'annuaire',
    title: 'Annuaire & destinataires',
    description:
      "Vérifier les informations de structure, SIRET, service destinataire et obligations éventuelles avant dépôt.",
    to: '/references/customers',
    icon: Building2,
    tone: 'neutral',
  },
  {
    id: 'erreurs',
    title: 'Erreurs & rejets',
    description:
      "Comprendre les motifs de rejet ou de suspension et obtenir une action recommandée.",
    to: '/invoices/rejections',
    icon: AlertTriangle,
    tone: 'error',
  },
];

export type FluxStepStatus = 'idle' | 'in_progress' | 'valid' | 'error';

export interface FluxPipelineStep {
  /** Ordre / identifiant. */
  id: number;
  title: string;
  /** Une phrase simple, compréhensible par un non-technicien. */
  description: string;
  icon: LucideIcon;
  /** Action vers une fonctionnalité EXISTANTE (optionnelle). */
  action?: { label: string; to: string };
  /** Statut par défaut (générique sur le hub). Surchargé quand on suit un vrai flux. */
  status?: FluxStepStatus;
}

/**
 * Pipeline de traitement d'un flux (10 étapes).
 * Sur le hub, les statuts sont neutres (`idle`) : c'est une vue de référence.
 * Le composant accepte un tableau surchargé pour suivre un flux réel.
 */
export const FLUX_PIPELINE_STEPS: FluxPipelineStep[] = [
  {
    id: 1,
    title: 'Import du fichier',
    description: 'Sélectionner le fichier de facture (XML, UBL, CII ou Factur-X) à transmettre.',
    icon: FileUp,
    action: { label: 'Déposer', to: '/invoices/flux' },
  },
  {
    id: 2,
    title: 'Détection du format',
    description: 'Identifier automatiquement le format et la syntaxe du fichier importé.',
    icon: FileSearch,
    action: { label: 'Déposer', to: '/invoices/flux' },
  },
  {
    id: 3,
    title: 'Extraction des métadonnées',
    description: 'Lire les données clés : numéro de facture, SIRET, montants, destinataire.',
    icon: ListChecks,
    action: { label: 'PDF → flux', to: '/invoices/pdf-to-flux' },
  },
  {
    id: 4,
    title: 'Validation syntaxique',
    description: 'Vérifier que la structure du fichier respecte le format attendu.',
    icon: ShieldCheck,
    action: { label: 'Déposer', to: '/invoices/flux' },
  },
  {
    id: 5,
    title: 'Validation métier',
    description: 'Contrôler la cohérence des données (SIRET, TVA, montants, destinataire) avant envoi.',
    icon: CheckCircle2,
    action: { label: 'Déposer', to: '/invoices/flux' },
  },
  {
    id: 6,
    title: 'Correction guidée',
    description: 'Corriger les anomalies détectées pour réduire le risque de rejet.',
    icon: Wand2,
    action: { label: 'Préparer', to: '/invoices/pdf-to-flux' },
  },
  {
    id: 7,
    title: 'Dépôt via API PISTE',
    description: 'Transmettre le flux à Chorus Pro via l’API de dépôt exposée sur PISTE.',
    icon: Send,
    action: { label: 'Dépôt G2B', to: '/invoices/g2b-flux' },
  },
  {
    id: 8,
    title: 'Récupération du statut',
    description: 'Récupérer la recevabilité technique du flux et son identifiant.',
    icon: Workflow,
    action: { label: 'Dépôt G2B', to: '/invoices/g2b-flux' },
  },
  {
    id: 9,
    title: 'Suivi du cycle de vie',
    description: 'Suivre l’évolution des statuts des factures contenues dans le flux.',
    icon: ListChecks,
    action: { label: 'Suivi', to: '/invoices' },
  },
  {
    id: 10,
    title: 'Archivage / historique',
    description: 'Conserver la trace du flux et de ses comptes rendus pour consultation ultérieure.',
    icon: Archive,
    action: { label: 'Historique', to: '/invoices' },
  },
];

export interface FluxTypeEntry {
  id: string;
  title: string;
  description: string;
  tone: FluxTone;
}

/**
 * Bloc « Comprendre les flux Chorus Pro ».
 * Descriptions volontairement génériques et prudentes : la terminologie (flux entrant,
 * flux pivot, flux retour, compte rendu d'intégration) est issue de la documentation
 * Chorus Pro / AIFE. Les détails de format/codification précis restent « à vérifier »
 * dans la documentation officielle selon votre raccordement.
 */
export const FLUX_TYPES: FluxTypeEntry[] = [
  {
    id: 'entrant',
    title: 'Flux entrant',
    description:
      "Facture envoyée par le fournisseur (ou son opérateur) vers Chorus Pro.",
    tone: 'info',
  },
  {
    id: 'pivot',
    title: 'Flux pivot',
    description:
      "Données transmises par Chorus Pro au destinataire public, dans un format normalisé.",
    tone: 'neutral',
  },
  {
    id: 'retour',
    title: 'Flux retour / cycle de vie',
    description:
      "Statuts retournés au fournisseur ou à l'opérateur pour suivre l'avancement du traitement.",
    tone: 'success',
  },
  {
    id: 'compte-rendu',
    title: "Compte rendu d'intégration",
    description:
      "Retour technique et/ou métier indiquant si le flux ou la facture a été intégré ou rejeté.",
    tone: 'warning',
  },
];

/** Données nécessaires à la prop `ProcessExplanationCard`. */
export interface ProcessExplanationContent {
  title: string;
  shortDescription: string;
  officialContext?: string;
  steps?: string[];
  requiredData?: string[];
  commonErrors?: string[];
  userNextAction?: string;
}

/**
 * Contenu d'aide par page, formulé pour un utilisateur non technique.
 * Réutilisé via <ProcessExplanationCard {...PAGE_EXPLANATIONS.depot} />.
 */
export const PAGE_EXPLANATIONS = {
  depot: {
    title: 'Comment fonctionne le dépôt de flux ?',
    shortDescription:
      "Le dépôt de flux consiste à transmettre à Chorus Pro un fichier structuré contenant une ou plusieurs factures. Le système vérifie d'abord la recevabilité technique du flux, puis l'intégration métier des factures.",
    officialContext:
      "La recevabilité, les formats acceptés et les comptes rendus sont décrits dans la documentation Chorus Pro / AIFE. L'API de dépôt est exposée via le catalogue PISTE.",
    steps: [
      'Importer le fichier',
      'Détecter le format',
      'Vérifier les données obligatoires',
      'Déposer via PISTE',
      "Récupérer l'identifiant de flux",
      'Suivre le compte rendu',
    ],
    userNextAction:
      "Importez votre fichier ci-dessous : la détection et les contrôles se lancent automatiquement avant le dépôt.",
  },
  preparation: {
    title: 'Pourquoi corriger avant dépôt ?',
    shortDescription:
      "Un flux peut être rejeté si sa structure, ses données ou sa codification ne respectent pas les règles attendues. Cette page sert à réduire les rejets avant envoi.",
    officialContext:
      "Les règles de conformité dépendent du format et du raccordement. Reportez-vous à la documentation Chorus Pro / AIFE pour les contrôles exacts applicables à votre cas (à vérifier selon le format).",
    commonErrors: [
      'SIRET manquant ou incohérent',
      'Taux de TVA absent',
      'Montant TTC incohérent',
      'Numéro de facture absent',
      'Destinataire non identifié',
      'Code service ou engagement juridique requis',
      'Format XML non conforme',
    ],
    userNextAction:
      "Corrigez les anomalies signalées, puis relancez la validation avant de déposer le flux.",
  },
  suivi: {
    title: "Comment lire le suivi d'un flux ?",
    shortDescription:
      "Le suivi permet de distinguer l'état technique du flux et l'état métier des factures associées.",
    officialContext:
      "Les statuts et comptes rendus proviennent de Chorus Pro. Leur signification est décrite dans la documentation officielle (cycle de vie et liste des statuts).",
    requiredData: [
      'Statut du flux',
      'Statut facture',
      'Compte rendu',
      'Date de dépôt',
      'Identifiant flux',
      'Identifiant facture Chorus (si disponible)',
      'Action recommandée',
    ],
    userNextAction:
      "Ouvrez un flux pour consulter son compte rendu et l'état des factures qu'il contient.",
  },
  facturesLiees: {
    title: 'Lien entre flux et factures',
    shortDescription:
      "Un flux peut contenir une ou plusieurs factures. Une facture peut ensuite avoir son propre cycle de vie : déposée, intégrée, suspendue, rejetée, validée, mise en paiement, selon les retours disponibles.",
    officialContext:
      "Le cycle de vie d'une facture et ses statuts sont définis par Chorus Pro. Les transitions exactes dépendent du circuit de validation du destinataire (à vérifier dans la documentation officielle).",
    userNextAction:
      "Sélectionnez une facture pour voir sa fiche unifiée et l'action recommandée.",
  },
  annuaire: {
    title: "Pourquoi vérifier l'annuaire ?",
    shortDescription:
      "Avant dépôt, les informations du destinataire public peuvent être nécessaires pour vérifier le SIRET, le service, l'engagement juridique ou les obligations associées à la structure.",
    officialContext:
      "L'annuaire des structures publiques est exposé via l'API Annuaire (catalogue PISTE). Les obligations par structure (service / engagement) y sont indiquées et peuvent varier (à vérifier par structure).",
    requiredData: [
      'SIRET du destinataire',
      'Service destinataire (code service exécutant)',
      "Engagement juridique (si requis par la structure)",
    ],
    userNextAction:
      "Recherchez la structure destinataire pour confirmer ses informations et ses obligations avant le dépôt.",
  },
  erreurs: {
    title: 'Comprendre les rejets et suspensions',
    shortDescription:
      "Un rejet ou une suspension signale qu'une facture ne peut pas poursuivre son cycle de vie en l'état. Le motif fourni par Chorus Pro oriente la correction.",
    officialContext:
      "Les motifs de rejet/suspension et les statuts associés sont documentés par Chorus Pro / AIFE. La marche à suivre dépend du motif exact retourné (à vérifier selon le code statut).",
    userNextAction:
      "Ouvrez un rejet pour lire le motif et l'action recommandée, puis corrigez et redéposez si nécessaire.",
  },
} satisfies Record<string, ProcessExplanationContent>;

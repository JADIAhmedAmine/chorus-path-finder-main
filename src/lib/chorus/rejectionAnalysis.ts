import type { Invoice } from '@/types';
import { canUseLlmExtraction, loadLlmConfig, resolveLlmRuntimeConfig } from '@/lib/llm/config';
import { requestLlmCompletion } from '@/lib/llm/client';

/**
 * Analyse d'un rejet / refus / recyclage / suspension d'une facture émise, et
 * suggestion d'action pour l'utilisateur.
 *
 * Deux sources possibles :
 *  - `llm` : le motif Chorus est analysé par le modèle (vLLM / Ollama) configuré.
 *  - `heuristique` : repli par mots-clés quand le LLM n'est pas disponible.
 */

export type RejectionActionType =
  | 'RESOUMETTRE'      // corriger les données et émettre une nouvelle facture
  | 'RECYCLER'         // compléter et recycler côté fournisseur (sans recréer)
  | 'COMPLETER'        // compléter une facture suspendue puis valider
  | 'CONTACTER_CLIENT' // le blocage dépend du client / de l'administration
  | 'AUCUNE';          // aucune action utile (doublon déjà traité, etc.)

export interface RejectionAnalysis {
  actionRecommandee: RejectionActionType;
  explication: string;
  etapes: string[];
  /** Noms de champs métier probablement à corriger (cf. CORRIGIBLE_FIELDS). */
  champsACorriger: string[];
  source: 'llm' | 'heuristique';
}

const ACTIONS: readonly RejectionActionType[] = [
  'RESOUMETTRE',
  'RECYCLER',
  'COMPLETER',
  'CONTACTER_CLIENT',
  'AUCUNE',
];

// Champs que l'utilisateur peut corriger dans l'assistant de saisie.
const CORRIGIBLE_FIELDS = [
  'engagementNumber',
  'marketNumber',
  'purchaseOrderNumber',
  'publicCustomerSiret',
  'publicCustomerId',
  'supplierSiret',
  'totalAmountHt',
  'totalVat',
  'totalAmountTtc',
  'invoiceDate',
  'supplierInvoiceNumber',
  'currencyCode',
];

function statusOf(invoice: Invoice): string {
  return (invoice.statusChorus || invoice.statusInternal || '').toUpperCase();
}

function reasonTextOf(invoice: Invoice): string {
  return `${invoice.statusReasonCode ?? ''} ${invoice.statusReasonLabel ?? ''}`;
}

// ---------------------------------------------------------------------------
// Repli heuristique (mots-clés) — toujours disponible, même sans LLM.
// ---------------------------------------------------------------------------

export function heuristicRejectionAnalysis(invoice: Invoice): RejectionAnalysis {
  const status = statusOf(invoice);
  const reason = reasonTextOf(invoice).toLowerCase();
  const base = { source: 'heuristique' as const };

  if (status.includes('RECYCL')) {
    return {
      ...base,
      actionRecommandee: 'RECYCLER',
      explication: 'La facture est en attente de recyclage : elle peut être complétée et renvoyée sans en recréer une nouvelle.',
      etapes: [
        'Ouvrir la fiche Chorus de la facture.',
        'Compléter le destinataire / l’engagement demandé.',
        'Lancer le recyclage depuis la fiche.',
      ],
      champsACorriger: ['engagementNumber', 'publicCustomerId'],
    };
  }

  if (status.includes('SUSPEND')) {
    return {
      ...base,
      actionRecommandee: 'COMPLETER',
      explication: 'La facture est suspendue : Chorus attend un complément d’information avant validation.',
      etapes: [
        'Ouvrir la fiche Chorus de la facture.',
        'Renseigner les informations manquantes demandées dans le motif.',
        'Valider la complétion.',
      ],
      champsACorriger: ['engagementNumber', 'purchaseOrderNumber'],
    };
  }

  // Rejets (REJETEE / refus) — branchement par mot-clé du motif.
  if (/(termin|supprim|cl[oô]tur|marché terminé)/.test(reason)) {
    return {
      ...base,
      actionRecommandee: 'CONTACTER_CLIENT',
      explication: 'Le rejet provient du client (marché terminé / engagement supprimé). Une correction de la facture ne suffira pas.',
      etapes: [
        'Contacter le service destinataire pour confirmer l’engagement / le marché à utiliser.',
        'Obtenir un numéro d’engagement valide avant toute nouvelle émission.',
      ],
      champsACorriger: ['engagementNumber', 'marketNumber'],
    };
  }
  if (reason.includes('siret')) {
    return {
      ...base,
      actionRecommandee: 'RESOUMETTRE',
      explication: 'Le SIRET destinataire n’est pas reconnu par Chorus.',
      etapes: ['Vérifier le SIRET destinataire dans l’annuaire Chorus.', 'Corriger puis émettre une nouvelle facture.'],
      champsACorriger: ['publicCustomerSiret', 'publicCustomerId'],
    };
  }
  if (reason.includes('engagement')) {
    return {
      ...base,
      actionRecommandee: 'RESOUMETTRE',
      explication: 'Un numéro d’engagement valide est requis et manquant ou incorrect.',
      etapes: ['Renseigner un numéro d’engagement valide communiqué par le client.', 'Émettre une nouvelle facture.'],
      champsACorriger: ['engagementNumber'],
    };
  }
  if (reason.includes('commande') || reason.includes('marche') || reason.includes('marché')) {
    return {
      ...base,
      actionRecommandee: 'RESOUMETTRE',
      explication: 'Le bon de commande / marché de rattachement est manquant ou erroné.',
      etapes: ['Renseigner le bon de commande / marché correspondant.', 'Émettre une nouvelle facture.'],
      champsACorriger: ['marketNumber', 'purchaseOrderNumber'],
    };
  }
  if (reason.includes('montant') || reason.includes('tva') || reason.includes('ttc')) {
    return {
      ...base,
      actionRecommandee: 'RESOUMETTRE',
      explication: 'Les montants HT / TVA / TTC sont incohérents ou erronés.',
      etapes: ['Contrôler les montants et la cohérence des taux de TVA.', 'Corriger puis émettre une nouvelle facture.'],
      champsACorriger: ['totalAmountHt', 'totalVat', 'totalAmountTtc'],
    };
  }
  if (reason.includes('doublon')) {
    return {
      ...base,
      actionRecommandee: 'AUCUNE',
      explication: 'Cette facture existe déjà côté Chorus (doublon).',
      etapes: ['Vérifier l’historique Chorus avant toute nouvelle action.'],
      champsACorriger: [],
    };
  }
  if (reason.includes('signature') || reason.includes('format') || reason.includes('xml') || reason.includes('schema')) {
    return {
      ...base,
      actionRecommandee: 'RESOUMETTRE',
      explication: 'Le document est invalide (format / signature non conforme).',
      etapes: ['Régénérer un PDF/A-3 ou un XML Factur-X conforme.', 'Émettre une nouvelle facture.'],
      champsACorriger: [],
    };
  }

  return {
    ...base,
    actionRecommandee: 'RESOUMETTRE',
    explication: 'Le motif de rejet nécessite une correction avant nouvelle émission.',
    etapes: ['Consulter le détail Chorus pour identifier l’élément invalide.', 'Corriger puis émettre une nouvelle facture.'],
    champsACorriger: [],
  };
}

// ---------------------------------------------------------------------------
// Analyse LLM
// ---------------------------------------------------------------------------

function buildPrompt(invoice: Invoice): string {
  const metadata = {
    supplierInvoiceNumber: invoice.supplierInvoiceNumber,
    invoiceDate: invoice.invoiceDate,
    currencyCode: invoice.currencyCode,
    totalHt: invoice.totalHt,
    totalVat: invoice.totalVat,
    totalTtc: invoice.totalTtc,
    engagementNumber: invoice.engagementNumber ?? null,
    marketNumber: invoice.marketNumber ?? null,
    purchaseOrderNumber: invoice.purchaseOrderNumber ?? null,
    publicCustomerId: invoice.publicCustomerId,
    recipientChorusName: invoice.recipientChorusName ?? null,
  };

  return [
    'Tu es un expert Chorus Pro. Une facture émise est dans un état problématique (rejetée, à recycler ou suspendue).',
    'À partir du statut, du motif Chorus et des métadonnées, explique en français clair pourquoi, et propose une action.',
    '',
    'Réponds UNIQUEMENT en JSON brut (aucun texte hors JSON, aucun markdown), avec EXACTEMENT ces champs :',
    '{',
    '  "actionRecommandee": "RESOUMETTRE" | "RECYCLER" | "COMPLETER" | "CONTACTER_CLIENT" | "AUCUNE",',
    '  "explication": string,        // 1 à 2 phrases : pourquoi la facture est dans cet état',
    '  "etapes": string[],           // 2 à 4 étapes concrètes pour résoudre',
    '  "champsACorriger": string[]   // noms de champs parmi la liste autorisée',
    '}',
    '',
    'Choix de l’action :',
    '- RESOUMETTRE : le rejet vient d’une donnée corrigeable (SIRET, engagement, marché, montants, format) → corriger et émettre une nouvelle facture.',
    '- RECYCLER : statut « à recycler » → compléter destinataire/engagement et renvoyer sans recréer la facture.',
    '- COMPLETER : statut « suspendue » → compléter les informations demandées puis valider.',
    '- CONTACTER_CLIENT : le blocage dépend du client / de l’administration (marché terminé, engagement à fournir par le client).',
    '- AUCUNE : aucune action utile (doublon déjà traité, etc.).',
    '',
    `Champs autorisés pour champsACorriger : ${CORRIGIBLE_FIELDS.join(', ')}`,
    '',
    'Contexte :',
    `Statut : ${statusOf(invoice)}`,
    `Motif Chorus : ${invoice.statusReasonLabel ?? '(non communiqué)'} ${invoice.statusReasonCode ? `(code ${invoice.statusReasonCode})` : ''}`,
    `Métadonnées facture : ${JSON.stringify(metadata)}`,
  ].join('\n');
}

function extractJsonObject(value: string): string | undefined {
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start < 0 || end < start) return undefined;
  return value.slice(start, end + 1);
}

function asStringArray(value: unknown, allowList?: readonly string[]): string[] {
  if (!Array.isArray(value)) return [];
  const out = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
  return allowList ? out.filter((item) => allowList.includes(item)) : out;
}

function parseAnalysis(content: string): RejectionAnalysis | null {
  const json = extractJsonObject(content);
  if (!json) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }

  const rawAction = String(parsed.actionRecommandee ?? '').toUpperCase();
  const actionRecommandee = (ACTIONS as readonly string[]).includes(rawAction)
    ? (rawAction as RejectionActionType)
    : 'RESOUMETTRE';

  const explication = typeof parsed.explication === 'string' ? parsed.explication.trim() : '';
  const etapes = asStringArray(parsed.etapes);
  if (!explication && etapes.length === 0) {
    return null;
  }

  return {
    actionRecommandee,
    explication: explication || 'Analyse du motif de rejet.',
    etapes,
    champsACorriger: asStringArray(parsed.champsACorriger, CORRIGIBLE_FIELDS),
    source: 'llm',
  };
}

/**
 * Analyse le rejet via le LLM configuré. Retombe sur l'heuristique si le LLM
 * n'est pas configuré ou échoue — la fonction renvoie donc toujours une analyse.
 */
export async function analyzeRejection(
  invoice: Invoice,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<RejectionAnalysis> {
  const config = resolveLlmRuntimeConfig(loadLlmConfig());
  if (!canUseLlmExtraction(config)) {
    return heuristicRejectionAnalysis(invoice);
  }

  const content = await requestLlmCompletion(config, buildPrompt(invoice), fetchImpl);
  const analysis = content ? parseAnalysis(content) : null;
  return analysis ?? heuristicRejectionAnalysis(invoice);
}

/** Indique si une analyse LLM (vs heuristique) est disponible. */
export function isLlmRejectionAnalysisAvailable(): boolean {
  return canUseLlmExtraction(resolveLlmRuntimeConfig(loadLlmConfig()));
}

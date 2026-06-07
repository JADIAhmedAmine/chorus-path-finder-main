/**
 * Tonalité visuelle des statuts TECHNIQUES de flux (recevabilité du dépôt).
 *
 * Distincte des statuts métier de facture (cf. status-utils.ts / getChorusRawStatusConfig).
 * Les libellés et codes correspondent à ce que renvoient déjà les pages de dépôt
 * (FluxDepositPage, G2BFluxDepositPage). Tout code inconnu retombe sur « neutre ».
 */

import type { FluxTone } from '@/lib/flux/content';

interface FluxStatusVisual {
  label: string;
  tone: FluxTone;
}

const TECHNICAL_STATUS: Record<string, FluxStatusVisual> = {
  // Recevabilité technique du flux
  RECEVABLE: { label: 'Recevable', tone: 'success' },
  ACCEPTED: { label: 'Accepté', tone: 'success' },
  IRRECEVABLE: { label: 'Irrecevable', tone: 'error' },
  REJECTED: { label: 'Rejeté', tone: 'error' },
  ERROR: { label: 'Erreur', tone: 'error' },
  // États transitoires
  ENTRANT_ENVELOPPE_VALIDE: { label: 'Enveloppe valide (en cours)', tone: 'warning' },
  PROCESSING_NOT_AVAILABLE_YET: { label: 'Traitement en cours', tone: 'info' },
  // États de blocage local (avant envoi)
  BLOCKED_LOCAL_VALIDATION: { label: 'Bloqué (validation locale)', tone: 'warning' },
  BLOCKED_BUSINESS_VALIDATION: { label: 'Bloqué (données métier)', tone: 'error' },
};

/** Résout le libellé + la tonalité d'un statut technique de flux. */
export function resolveFluxTechnicalStatus(status: string | null | undefined): FluxStatusVisual {
  const raw = (status ?? '').trim();
  if (!raw) return { label: 'En attente', tone: 'neutral' };
  return TECHNICAL_STATUS[raw.toUpperCase()] ?? { label: raw, tone: 'neutral' };
}

/** Classes Tailwind d'un badge selon la tonalité partagée. */
export const FLUX_TONE_BADGE: Record<FluxTone, string> = {
  success: 'bg-success-soft text-success ring-success/20',
  warning: 'bg-warning-soft text-warning ring-warning/20',
  error: 'bg-destructive-soft text-destructive ring-destructive/20',
  info: 'bg-info-soft text-info ring-info/20',
  neutral: 'bg-muted text-muted-foreground ring-border',
};

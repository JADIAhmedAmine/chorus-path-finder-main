/**
 * Façade de service « factures » pour l'espace Flux + agrégation des statistiques du hub.
 *
 * - Ré-expose la requête factures et les helpers de statut déjà présents dans le projet.
 * - `computeFluxHubStats` calcule, à partir des factures en cache, les seuls indicateurs
 *   réellement disponibles aujourd'hui (factures liées, rejets, corrections, dernier
 *   mouvement). Les métriques propres au DÉPÔT de flux (nombre de flux déposés, flux en
 *   erreur, taux de succès du dépôt) ne sont pas encore persistées côté application :
 *   elles sont exposées comme « prêtes à connecter » et restent vides tant qu'aucune
 *   source n'est branchée (cf. FluxHub). On n'invente aucune donnée.
 */

import type { Invoice } from '@/types';
import {
  getInvoiceChorusStatus,
  isActionableInvoice,
  isPaidChorusStatus,
  isRejectedChorusStatus,
} from '@/lib/chorus/actionableInvoices';

// --- Ré-exports (point d'import unique) ------------------------------------
export { useInvoicesQuery } from '@/lib/queries/db';
export {
  getInvoiceChorusStatus,
  isActionableInvoice,
  isActionableChorusStatus,
  isPaidChorusStatus,
  isRejectedChorusStatus,
} from '@/lib/chorus/actionableInvoices';

function isSuspendedStatus(status: string): boolean {
  return status.toUpperCase().includes('SUSPEND');
}

function invoiceActivityDate(invoice: Invoice): string {
  return (
    invoice.lastStatusSyncAt
    || invoice.statusChangedAt
    || invoice.updatedAt
    || invoice.submittedAt
    || invoice.invoiceDate
  );
}

export interface FluxHubStats {
  /** Nombre de factures connues (toutes confondues) — proxy « factures liées ». */
  linkedInvoices: number;
  /** Factures rejetées / refusées. */
  rejected: number;
  /** Factures suspendues (complément attendu). */
  suspended: number;
  /** Factures actionnables hors rejets (corrections à faire). */
  corrections: number;
  /** Factures avec un statut de paiement. */
  paid: number;
  /** Taux de succès indicatif (payées / total), si calculable. */
  successRate: number | null;
  /** Date du dernier mouvement connu (ISO) ou null. */
  lastActivityAt: string | null;
}

/** Agrège les indicateurs disponibles à partir des factures en cache. */
export function computeFluxHubStats(invoices: Invoice[]): FluxHubStats {
  const total = invoices.length;
  let rejected = 0;
  let suspended = 0;
  let corrections = 0;
  let paid = 0;
  let lastActivityAt: string | null = null;

  for (const invoice of invoices) {
    const status = getInvoiceChorusStatus(invoice);
    if (isRejectedChorusStatus(status)) rejected += 1;
    if (isSuspendedStatus(status)) suspended += 1;
    if (isActionableInvoice(invoice)) corrections += 1;
    if (isPaidChorusStatus(status)) paid += 1;

    const activity = invoiceActivityDate(invoice);
    if (activity && (!lastActivityAt || activity > lastActivityAt)) {
      lastActivityAt = activity;
    }
  }

  return {
    linkedInvoices: total,
    rejected,
    suspended,
    corrections,
    paid,
    successRate: total > 0 ? Math.round((paid / total) * 100) : null,
    lastActivityAt,
  };
}

import type { InvoiceStatusInternal, JobStatus, StatusConfig } from '@/types';

export const invoiceStatusConfig: Record<InvoiceStatusInternal, StatusConfig> = {
  DRAFT_UPLOADED: { label: 'Brouillon déposé', color: '#6b7280', bgClass: 'bg-muted', textClass: 'text-muted-foreground' },
  DRAFT_STRUCTURED: { label: 'Données structurées', color: '#6b7280', bgClass: 'bg-muted', textClass: 'text-muted-foreground' },
  PENDING_HUMAN_REVIEW: { label: 'Revue humaine requise', color: '#f59e0b', bgClass: 'bg-warning/10', textClass: 'text-warning' },
  READY_FOR_SUBMISSION: { label: 'Prêt à soumettre', color: '#3b82f6', bgClass: 'bg-info/10', textClass: 'text-info' },
  SUBMISSION_REQUESTED: { label: 'Soumission demandée', color: '#3b82f6', bgClass: 'bg-info/10', textClass: 'text-info' },
  ATTACHMENTS_UPLOADED: { label: 'Pièces téléversées', color: '#3b82f6', bgClass: 'bg-info/10', textClass: 'text-info' },
  SUBMITTED_TO_CHORUS: { label: 'Soumis à Chorus', color: '#8b5cf6', bgClass: 'bg-purple-100', textClass: 'text-purple-700' },
  STATUS_SYNC_PENDING: { label: 'Sync en cours', color: '#8b5cf6', bgClass: 'bg-purple-100', textClass: 'text-purple-700' },
  REJECTED_BUSINESS: { label: 'Rejeté (métier)', color: '#ef4444', bgClass: 'bg-destructive/10', textClass: 'text-destructive' },
  REJECTED_TECHNICAL: { label: 'Rejeté (technique)', color: '#ef4444', bgClass: 'bg-destructive/10', textClass: 'text-destructive' },
  ACCEPTED_BY_CHORUS: { label: 'Accepté', color: '#22c55e', bgClass: 'bg-success/10', textClass: 'text-success' },
  PAID: { label: 'Payé', color: '#16a34a', bgClass: 'bg-success/10', textClass: 'text-success' },
  ARCHIVED: { label: 'Archivé', color: '#6b7280', bgClass: 'bg-muted', textClass: 'text-muted-foreground' },
};

export const jobStatusConfig: Record<JobStatus, StatusConfig> = {
  PENDING: { label: 'En attente', color: '#6b7280', bgClass: 'bg-muted', textClass: 'text-muted-foreground' },
  RUNNING: { label: 'En cours', color: '#3b82f6', bgClass: 'bg-info/10', textClass: 'text-info' },
  FAILED: { label: 'Échoué', color: '#ef4444', bgClass: 'bg-destructive/10', textClass: 'text-destructive' },
  DONE: { label: 'Terminé', color: '#22c55e', bgClass: 'bg-success/10', textClass: 'text-success' },
  DEAD: { label: 'Abandonné', color: '#991b1b', bgClass: 'bg-destructive/20', textClass: 'text-destructive' },
};

export const CHORUS_INVOICE_STATUS_CODES = [
  'BROUILLON',
  'A_VALIDER_1',
  'ERREUR_FOURNISSEUR_SUR_VALIDEUR',
  'REFUSEE_1',
  'VALIDEE_1',
  'ABSENCE_VALIDATION_1_HORS_DELAI',
  'A_VALIDER_2',
  'ERREUR_COTRAITANT_SUR_VALIDEUR',
  'REFUSEE_2',
  'VALIDEE_2',
  'ABSENCE_VALIDATION_2_HORS_DELAI',
  'DEPOSEE',
  'ERREUR_FOURNISSEUR_SUR_MOE',
  'EN_COURS_ACHEMINEMENT',
  'MISE_A_DISPOSITION',
  'A_RECYCLER',
  'SUSPENDUE',
  'REJETEE',
  'MANDATEE',
  'MISE_EN_PAIEMENT',
  'COMPTABILISEE',
  'MISE_A_DISPOSITION_COMPTABLE',
  'ABANDONNEE',
  'SUPPRIMEE',
  'ASSOCIEE',
  'EN_COURS_TRAITEMENT_PIVOT_S',
  'A_VALIDER_MOE',
  'REFUSEE_MOE',
  'EN_ATTENTE_RECYCLAGE_FOURNISSEUR',
  'ERREUR_MOE_SUR_FOURNISSEUR',
  'ERREUR_MOA_SUR_FOURNISSEUR',
  'INTERPRETEE_OCR',
  'COMPLETEE',
  'ERREUR_FOURNISSEUR_SUR_MOA',
  'ERREUR_MOE_SUR_MOA',
  'ERREUR_DESTINATAIRE_PD',
  'ERREUR_DESTINATAIRE_EA',
  'SERVICE_FAIT',
  'NON_CONFORME',
  'A_ASSOCIER_MOE',
  'ERREUR_DE_MOE',
  'MISE_A_DISPOSITION_MOE',
  'PRISE_EN_COMPTE_MOE',
  'A_ASSOCIER_MOA',
  'ERREUR_DE_MOA',
  'REFUSEE_MOA',
  'A_ASSOCIER_FOURNISSEUR',
  'REFUSEE_FOURNISSEUR',
  'A_COMPLETER',
  'TRANSMISE_MOA',
  'PRISE_EN_COMPTE_DESTINATAIRE',
  'REMPLACEE_PAR_A22',
  'DUPLIQUE_APRES_REFUS',
  'MISE_A_DISPOSITION_MOA',
  'PRISE_EN_COMPTE_MOA',
  'ABSENCE_VALIDATION_MOE_DELAI_REGLEMENTAIRE',
  'TECHNIQUE_INCONNU',
] as const;

export type ChorusInvoiceStatusCode = typeof CHORUS_INVOICE_STATUS_CODES[number];

const CHORUS_SUCCESS_STATUS_CODES = new Set<string>([
  'VALIDEE_1',
  'VALIDEE_2',
  'MANDATEE',
  'MISE_EN_PAIEMENT',
  'COMPTABILISEE',
  'SERVICE_FAIT',
  'PRISE_EN_COMPTE_MOE',
  'PRISE_EN_COMPTE_MOA',
  'PRISE_EN_COMPTE_DESTINATAIRE',
]);

const CHORUS_WARNING_STATUS_CODES = new Set<string>([
  'A_VALIDER_1',
  'A_VALIDER_2',
  'A_VALIDER_MOE',
  'A_RECYCLER',
  'SUSPENDUE',
  'EN_ATTENTE_RECYCLAGE_FOURNISSEUR',
  'A_ASSOCIER_MOE',
  'A_ASSOCIER_MOA',
  'A_ASSOCIER_FOURNISSEUR',
  'A_COMPLETER',
  'DUPLIQUE_APRES_REFUS',
]);

const CHORUS_ERROR_STATUS_CODES = new Set<string>([
  'ERREUR_FOURNISSEUR_SUR_VALIDEUR',
  'REFUSEE_1',
  'ABSENCE_VALIDATION_1_HORS_DELAI',
  'ERREUR_COTRAITANT_SUR_VALIDEUR',
  'REFUSEE_2',
  'ABSENCE_VALIDATION_2_HORS_DELAI',
  'ERREUR_FOURNISSEUR_SUR_MOE',
  'REJETEE',
  'ABANDONNEE',
  'SUPPRIMEE',
  'REFUSEE_MOE',
  'ERREUR_MOE_SUR_FOURNISSEUR',
  'ERREUR_MOA_SUR_FOURNISSEUR',
  'ERREUR_FOURNISSEUR_SUR_MOA',
  'ERREUR_MOE_SUR_MOA',
  'ERREUR_DESTINATAIRE_PD',
  'ERREUR_DESTINATAIRE_EA',
  'NON_CONFORME',
  'ERREUR_DE_MOE',
  'ERREUR_DE_MOA',
  'REFUSEE_MOA',
  'REFUSEE_FOURNISSEUR',
  'ABSENCE_VALIDATION_MOE_DELAI_REGLEMENTAIRE',
  'TECHNIQUE_INCONNU',
]);

const CHORUS_INFO_STATUS_CODES = new Set<string>([
  'DEPOSEE',
  'EN_COURS_ACHEMINEMENT',
  'MISE_A_DISPOSITION',
  'MISE_A_DISPOSITION_COMPTABLE',
  'ASSOCIEE',
  'EN_COURS_TRAITEMENT_PIVOT_S',
  'INTERPRETEE_OCR',
  'COMPLETEE',
  'MISE_A_DISPOSITION_MOE',
  'TRANSMISE_MOA',
  'REMPLACEE_PAR_A22',
  'MISE_A_DISPOSITION_MOA',
]);

const CHORUS_STATUS_COLORS: Record<string, string> = {
  BROUILLON: '#64748b',
  A_VALIDER_1: '#eab308',
  A_VALIDER_2: '#ca8a04',
  A_VALIDER_MOE: '#d97706',
  A_RECYCLER: '#f59e0b',
  SUSPENDUE: '#ea580c',
  EN_ATTENTE_RECYCLAGE_FOURNISSEUR: '#f97316',
  A_ASSOCIER_MOE: '#fb923c',
  A_ASSOCIER_MOA: '#fdba74',
  A_ASSOCIER_FOURNISSEUR: '#f97316',
  A_COMPLETER: '#fbbf24',
  DUPLIQUE_APRES_REFUS: '#f97316',
  VALIDEE_1: '#22c55e',
  VALIDEE_2: '#16a34a',
  MANDATEE: '#65a30d',
  MISE_EN_PAIEMENT: '#059669',
  COMPTABILISEE: '#0d9488',
  SERVICE_FAIT: '#84cc16',
  PRISE_EN_COMPTE_MOE: '#10b981',
  PRISE_EN_COMPTE_MOA: '#14b8a6',
  PRISE_EN_COMPTE_DESTINATAIRE: '#06b6d4',
  DEPOSEE: '#6366f1',
  EN_COURS_ACHEMINEMENT: '#8b5cf6',
  MISE_A_DISPOSITION: '#3b82f6',
  MISE_A_DISPOSITION_COMPTABLE: '#2563eb',
  MISE_A_DISPOSITION_MOE: '#60a5fa',
  MISE_A_DISPOSITION_MOA: '#1d4ed8',
  ASSOCIEE: '#0ea5e9',
  EN_COURS_TRAITEMENT_PIVOT_S: '#7c3aed',
  INTERPRETEE_OCR: '#0891b2',
  COMPLETEE: '#0284c7',
  TRANSMISE_MOA: '#2563eb',
  REMPLACEE_PAR_A22: '#475569',
  REJETEE: '#ef4444',
  REFUSEE_1: '#dc2626',
  REFUSEE_2: '#b91c1c',
  REFUSEE_MOE: '#e11d48',
  REFUSEE_MOA: '#be123c',
  REFUSEE_FOURNISSEUR: '#f43f5e',
  ABANDONNEE: '#991b1b',
  SUPPRIMEE: '#7f1d1d',
  NON_CONFORME: '#fb7185',
  ABSENCE_VALIDATION_1_HORS_DELAI: '#dc2626',
  ABSENCE_VALIDATION_2_HORS_DELAI: '#b91c1c',
  ABSENCE_VALIDATION_MOE_DELAI_REGLEMENTAIRE: '#9f1239',
  TECHNIQUE_INCONNU: '#6b7280',
};

function getChorusStatusColor(status: string, fallback: string): string {
  return CHORUS_STATUS_COLORS[status] ?? fallback;
}

export function getStatusConfig(status: InvoiceStatusInternal): StatusConfig {
  return invoiceStatusConfig[status] || { label: status, color: '#6b7280', bgClass: 'bg-muted', textClass: 'text-muted-foreground' };
}

export function getChorusRawStatusConfig(status: string): StatusConfig {
  const label = status.trim() || '-';
  const normalized = label.toUpperCase();

  if (CHORUS_ERROR_STATUS_CODES.has(normalized)) {
    return { label, color: getChorusStatusColor(normalized, '#ef4444'), bgClass: 'bg-destructive/10', textClass: 'text-destructive' };
  }

  if (CHORUS_SUCCESS_STATUS_CODES.has(normalized)) {
    return { label, color: getChorusStatusColor(normalized, '#16a34a'), bgClass: 'bg-success/10', textClass: 'text-success' };
  }

  if (CHORUS_WARNING_STATUS_CODES.has(normalized)) {
    return { label, color: getChorusStatusColor(normalized, '#f59e0b'), bgClass: 'bg-warning/10', textClass: 'text-warning' };
  }

  if (CHORUS_INFO_STATUS_CODES.has(normalized)) {
    return { label, color: getChorusStatusColor(normalized, '#3b82f6'), bgClass: 'bg-info/10', textClass: 'text-info' };
  }

  return { label, color: getChorusStatusColor(normalized, '#6b7280'), bgClass: 'bg-muted', textClass: 'text-muted-foreground' };
}

export function getJobStatusConfig(status: JobStatus): StatusConfig {
  return jobStatusConfig[status] || { label: status, color: '#6b7280', bgClass: 'bg-muted', textClass: 'text-muted-foreground' };
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
}

export function formatDate(date: string): string {
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(date));
}

export function formatDateTime(date: string): string {
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(date));
}

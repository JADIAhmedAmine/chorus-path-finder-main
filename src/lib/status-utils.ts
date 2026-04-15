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

export function getStatusConfig(status: InvoiceStatusInternal): StatusConfig {
  return invoiceStatusConfig[status] || { label: status, color: '#6b7280', bgClass: 'bg-muted', textClass: 'text-muted-foreground' };
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

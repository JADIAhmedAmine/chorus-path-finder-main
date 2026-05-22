import type { Invoice } from '@/types';

export function isRejectedChorusStatus(status: string): boolean {
  const normalized = status.toUpperCase();
  return normalized.includes('REJET') || normalized.includes('REFUS');
}

export function isPaidChorusStatus(status: string): boolean {
  const normalized = status.toUpperCase();
  return normalized.includes('PAY') || normalized.includes('PAIE') || normalized.includes('PAIEMENT');
}

export function isActionableChorusStatus(status: string): boolean {
  const normalized = status.toUpperCase();
  return isRejectedChorusStatus(status)
    || normalized.includes('ERREUR')
    || normalized.includes('SUSPEND')
    || normalized.includes('RECYCL')
    || normalized.includes('NON_CONFORME')
    || normalized.includes('A_VALIDER');
}

export function getInvoiceChorusStatus(invoice: Invoice): string {
  return invoice.statusChorus || invoice.statusInternal;
}

export function isActionableInvoice(invoice: Invoice): boolean {
  return isActionableChorusStatus(getInvoiceChorusStatus(invoice));
}

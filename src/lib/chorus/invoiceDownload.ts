import type { Invoice } from '@/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asPositiveInteger(value: unknown): number | null {
  if (typeof value === 'boolean') return null;
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function rawPayload(invoice: Invoice): Record<string, unknown> {
  return isRecord(invoice.rawPayload) ? invoice.rawPayload : {};
}

/**
 * Resolves the Chorus CPP numeric identifier for an invoice.
 * Mirrors the ReceptionProcessing resolver so the download endpoint
 * can be called consistently from any invoice list.
 */
export function resolveChorusInvoiceId(invoice: Invoice): number | null {
  const raw = rawPayload(invoice);
  const candidates: unknown[] = [
    invoice.chorusInvoiceNumber,
    raw.identifiantFactureCPP,
    raw.idFactureCPP,
    raw.idFacture,
    raw.identifiantDemandePaiementCPP,
    raw.idDemandePaiementCPP,
    raw.idDemandePaiement,
    raw.identifiantDemandePaiement,
    invoice.id.startsWith('chorus-') ? invoice.id.slice('chorus-'.length) : invoice.id,
  ];
  for (const candidate of candidates) {
    const parsed = asPositiveInteger(candidate);
    if (parsed) return parsed;
  }
  return null;
}

/** Programmatically trigger a browser download from a blob URL. */
export function triggerBrowserDownload(objectUrl: string, filename: string) {
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

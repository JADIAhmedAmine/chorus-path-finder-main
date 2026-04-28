import type { Invoice, PublicCustomer, SupplierOrganization } from '@/types';

const CHORUS_LIVE_INVOICE_DETAILS_STORAGE_KEY = 'chorus.liveInvoiceDetails.v1';

export interface ChorusLiveInvoiceSearchContext {
  idFournisseur: number;
  fetchedAt: string;
  total: number;
  returned: number;
  requestedPageSize: number;
  payload?: unknown;
}

export interface ChorusLiveInvoiceDetailRecord {
  id: string;
  invoice: Invoice;
  supplier?: SupplierOrganization;
  customer?: PublicCustomer;
  raw: unknown;
  search: ChorusLiveInvoiceSearchContext;
}

function isRecord(value: unknown): value is Record<string, ChorusLiveInvoiceDetailRecord> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStoredDetails(): Record<string, ChorusLiveInvoiceDetailRecord> {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const rawValue = window.localStorage.getItem(CHORUS_LIVE_INVOICE_DETAILS_STORAGE_KEY);
    if (!rawValue) {
      return {};
    }

    const parsed = JSON.parse(rawValue);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function saveChorusLiveInvoiceDetails(records: ChorusLiveInvoiceDetailRecord[]): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const nextRecords = { ...readStoredDetails() };
    for (const record of records) {
      nextRecords[record.id] = record;
    }

    window.localStorage.setItem(CHORUS_LIVE_INVOICE_DETAILS_STORAGE_KEY, JSON.stringify(nextRecords));
  } catch {
    // Storage is best-effort: the list still displays even if the browser refuses persistence.
  }
}

export function getChorusLiveInvoiceDetail(id: string | undefined): ChorusLiveInvoiceDetailRecord | undefined {
  if (!id) {
    return undefined;
  }

  return readStoredDetails()[id];
}

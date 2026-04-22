import type { ApiExchangeLog, AuditLog, Invoice, InvoiceStatusHistory } from '@/types';

const INVOICE_RUNTIME_STATE_STORAGE_KEY = 'invoice.runtime.state';

interface InvoiceRuntimeState {
  invoicePatchesById: Record<string, Partial<Invoice>>;
  statusHistoryByInvoiceId: Record<string, InvoiceStatusHistory[]>;
  apiLogsByInvoiceId: Record<string, ApiExchangeLog[]>;
  auditLogsByEntityId: Record<string, AuditLog[]>;
}

function createEmptyState(): InvoiceRuntimeState {
  return {
    invoicePatchesById: {},
    statusHistoryByInvoiceId: {},
    apiLogsByInvoiceId: {},
    auditLogsByEntityId: {},
  };
}

function loadRuntimeState(): InvoiceRuntimeState {
  if (typeof window === 'undefined') {
    return createEmptyState();
  }

  const raw = window.localStorage.getItem(INVOICE_RUNTIME_STATE_STORAGE_KEY);
  if (!raw) {
    return createEmptyState();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<InvoiceRuntimeState>;
    return {
      invoicePatchesById: parsed.invoicePatchesById ?? {},
      statusHistoryByInvoiceId: parsed.statusHistoryByInvoiceId ?? {},
      apiLogsByInvoiceId: parsed.apiLogsByInvoiceId ?? {},
      auditLogsByEntityId: parsed.auditLogsByEntityId ?? {},
    };
  } catch {
    return createEmptyState();
  }
}

function saveRuntimeState(state: InvoiceRuntimeState): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(INVOICE_RUNTIME_STATE_STORAGE_KEY, JSON.stringify(state));
}

function mergeById<T extends { id: string }>(baseItems: T[], runtimeItems: T[]): T[] {
  const map = new Map<string, T>();

  for (const item of baseItems) {
    map.set(item.id, item);
  }

  for (const item of runtimeItems) {
    map.set(item.id, item);
  }

  return Array.from(map.values());
}

export function applyInvoiceRuntimePatches(invoices: Invoice[]): Invoice[] {
  const state = loadRuntimeState();

  return invoices.map((invoice) => {
    const patch = state.invoicePatchesById[invoice.id];
    return patch ? { ...invoice, ...patch } : invoice;
  });
}

export function applyStatusHistoryRuntimeEntries(
  history: InvoiceStatusHistory[],
  invoiceId?: string,
): InvoiceStatusHistory[] {
  const state = loadRuntimeState();
  const runtimeEntries = invoiceId
    ? state.statusHistoryByInvoiceId[invoiceId] ?? []
    : Object.values(state.statusHistoryByInvoiceId).flat();

  return mergeById(history, runtimeEntries);
}

export function applyApiLogRuntimeEntries(apiLogs: ApiExchangeLog[], invoiceId?: string): ApiExchangeLog[] {
  const state = loadRuntimeState();
  const runtimeEntries = invoiceId
    ? state.apiLogsByInvoiceId[invoiceId] ?? []
    : Object.values(state.apiLogsByInvoiceId).flat();

  return mergeById(apiLogs, runtimeEntries);
}

export function applyAuditLogRuntimeEntries(auditLogs: AuditLog[], entityId?: string): AuditLog[] {
  const state = loadRuntimeState();
  const runtimeEntries = entityId
    ? state.auditLogsByEntityId[entityId] ?? []
    : Object.values(state.auditLogsByEntityId).flat();

  return mergeById(auditLogs, runtimeEntries);
}

export function upsertInvoiceRuntimePatch(invoiceId: string, patch: Partial<Invoice>): void {
  const state = loadRuntimeState();
  state.invoicePatchesById[invoiceId] = {
    ...state.invoicePatchesById[invoiceId],
    ...patch,
  };
  saveRuntimeState(state);
}

export function appendInvoiceStatusHistory(invoiceId: string, entry: InvoiceStatusHistory): void {
  const state = loadRuntimeState();
  const entries = state.statusHistoryByInvoiceId[invoiceId] ?? [];
  state.statusHistoryByInvoiceId[invoiceId] = mergeById(entries, [entry]);
  saveRuntimeState(state);
}

export function appendInvoiceApiLog(invoiceId: string, entry: ApiExchangeLog): void {
  const state = loadRuntimeState();
  const entries = state.apiLogsByInvoiceId[invoiceId] ?? [];
  state.apiLogsByInvoiceId[invoiceId] = mergeById(entries, [entry]);
  saveRuntimeState(state);
}

export function appendInvoiceAuditLog(entityId: string, entry: AuditLog): void {
  const state = loadRuntimeState();
  const entries = state.auditLogsByEntityId[entityId] ?? [];
  state.auditLogsByEntityId[entityId] = mergeById(entries, [entry]);
  saveRuntimeState(state);
}

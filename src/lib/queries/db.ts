import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authenticatedFetch, clearAuthSession } from '@/lib/auth/session';
import type { Invoice, PublicCustomer, SupplierOrganization } from '@/types';

export interface DbInvoiceFilters {
  supplierId?: string;
  publicCustomerId?: string;
  statusInternal?: string;
  statusChorus?: string;
  page?: number;
  pageSize?: number;
}

export type SyncMode = 'recent' | 'delta' | 'full';

export interface SyncTriggerInput {
  mode?: SyncMode;
  pageSize?: number;
  supplierId?: number;
  environment?: string;
}

export interface SyncRunResult {
  id: string;
  entity: string;
  status: string;
  rowsFetched: number;
  rowsUpserted: number;
  rowsFailed: number;
  errorMessage?: string | null;
  startedAt: string;
  finishedAt?: string | null;
  payloadSummary?: Record<string, unknown> | null;
}

const DB_API_BASE = '/api/db';

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  const response = await authenticatedFetch(`${DB_API_BASE}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearAuthSession();
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.assign('/login');
      }
    }
    const text = await response.text().catch(() => '');
    throw new Error(`${path} ${response.status}: ${text || response.statusText}`);
  }

  return (await response.json()) as T;
}

function buildInvoicesUrl(filters: DbInvoiceFilters): string {
  const search = new URLSearchParams();
  if (filters.supplierId) search.set('supplierId', filters.supplierId);
  if (filters.publicCustomerId) search.set('publicCustomerId', filters.publicCustomerId);
  if (filters.statusInternal) search.set('statusInternal', filters.statusInternal);
  if (filters.statusChorus) search.set('statusChorus', filters.statusChorus);
  search.set('page', String(filters.page ?? 1));
  search.set('pageSize', String(filters.pageSize ?? 200));
  return `/invoices?${search.toString()}`;
}

interface PaginatedInvoicesPayload {
  total: number;
  page: number;
  pageSize: number;
  items: Invoice[];
}

interface PaginatedSuppliersPayload {
  total: number;
  page: number;
  pageSize: number;
  items: SupplierOrganization[];
}

export interface InvoicesQueryResult {
  total: number;
  page: number;
  pageSize: number;
  items: Invoice[];
}

export const dbQueryKeys = {
  invoices: (filters: DbInvoiceFilters) => ['db', 'invoices', filters] as const,
  invoiceDetail: (id: string | undefined) => ['db', 'invoice', id ?? 'none'] as const,
  suppliers: () => ['db', 'suppliers'] as const,
  publicCustomers: () => ['db', 'public-customers'] as const,
  syncRuns: (entity?: string) => ['db', 'sync-runs', entity ?? 'all'] as const,
};

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function normalizeInvoice(invoice: Invoice): Invoice {
  return {
    ...invoice,
    totalHt: asNumber(invoice.totalHt),
    totalVat: asNumber(invoice.totalVat),
    totalTtc: asNumber(invoice.totalTtc),
    amountToPay: invoice.amountToPay === undefined
      ? undefined
      : asNumber(invoice.amountToPay),
    extractionConfidence: invoice.extractionConfidence === undefined
      ? undefined
      : asNumber(invoice.extractionConfidence),
  };
}

export function useInvoicesQuery(filters: DbInvoiceFilters = {}) {
  return useQuery<InvoicesQueryResult>({
    queryKey: dbQueryKeys.invoices(filters),
    queryFn: async () => {
      const pageSize = Math.min(filters.pageSize ?? 500, 500);
      const firstPayload = await fetchJson<PaginatedInvoicesPayload>(
        buildInvoicesUrl({ ...filters, page: filters.page ?? 1, pageSize }),
      );

      if (filters.page !== undefined) {
        return {
          total: firstPayload.total,
          page: firstPayload.page,
          pageSize: firstPayload.pageSize,
          items: (firstPayload.items ?? []).map(normalizeInvoice),
        };
      }

      const totalPages = Math.ceil(firstPayload.total / firstPayload.pageSize);
      const remainingPages = Array.from(
        { length: Math.max(totalPages - 1, 0) },
        (_, index) => index + 2,
      );
      const remainingPayloads = await Promise.all(
        remainingPages.map((page) =>
          fetchJson<PaginatedInvoicesPayload>(
            buildInvoicesUrl({ ...filters, page, pageSize: firstPayload.pageSize }),
          ),
        ),
      );
      const items = [
        ...(firstPayload.items ?? []),
        ...remainingPayloads.flatMap((payload) => payload.items ?? []),
      ].map(normalizeInvoice);

      return {
        total: firstPayload.total,
        page: 1,
        pageSize: firstPayload.pageSize,
        items,
      };
    },
  });
}

export function useInvoiceDetailQuery(id: string | undefined) {
  return useQuery<Invoice | null>({
    queryKey: dbQueryKeys.invoiceDetail(id),
    enabled: typeof id === 'string' && id.length > 0,
    queryFn: async () => {
      if (!id) return null;
      const raw = await fetchJson<Invoice>(`/invoices/${encodeURIComponent(id)}`);
      return normalizeInvoice(raw);
    },
  });
}

export function useSuppliersQuery() {
  return useQuery<SupplierOrganization[]>({
    queryKey: dbQueryKeys.suppliers(),
    queryFn: async () => {
      const payload = await fetchJson<PaginatedSuppliersPayload>('/suppliers?pageSize=500');
      return payload.items ?? [];
    },
  });
}

export function usePublicCustomersQuery() {
  return useQuery<PublicCustomer[]>({
    queryKey: dbQueryKeys.publicCustomers(),
    queryFn: () => fetchJson<PublicCustomer[]>('/public-customers'),
  });
}

export function useSyncInvoicesMutation() {
  const queryClient = useQueryClient();
  return useMutation<SyncRunResult[], Error, SyncTriggerInput | undefined>({
    mutationFn: async (input) => {
      const body: Record<string, unknown> = {
        mode: input?.mode ?? 'delta',
      };
      if (input?.pageSize !== undefined) body.pageSize = input.pageSize;
      if (input?.supplierId !== undefined) body.supplierId = input.supplierId;
      if (input?.environment) body.environment = input.environment;

      return fetchJson<SyncRunResult[]>('/sync/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['db', 'invoices'] });
      void queryClient.invalidateQueries({ queryKey: dbQueryKeys.publicCustomers() });
      void queryClient.invalidateQueries({ queryKey: dbQueryKeys.syncRuns() });
    },
  });
}

export function useSyncSuppliersMutation() {
  const queryClient = useQueryClient();
  return useMutation<SyncRunResult, Error, { environment?: string } | undefined>({
    mutationFn: async (input) =>
      fetchJson<SyncRunResult>('/sync/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input ?? {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dbQueryKeys.suppliers() });
      void queryClient.invalidateQueries({ queryKey: dbQueryKeys.syncRuns() });
    },
  });
}

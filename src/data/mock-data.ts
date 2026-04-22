import type {
  ApiExchangeLog,
  AsyncJob,
  AuditLog,
  Invoice,
  InvoiceAttachment,
  InvoiceExtractionResult,
  InvoiceLine,
  InvoiceStatusHistory,
  PublicCustomer,
  PublicService,
  SupplierOrganization,
  Tenant,
  User,
} from '@/types';
import { BackendDataClient } from '@/data/backend-client';
import {
  applyApiLogRuntimeEntries,
  applyAuditLogRuntimeEntries,
  applyInvoiceRuntimePatches,
  applyStatusHistoryRuntimeEntries,
} from '@/data/invoice-runtime-state';

const client = new BackendDataClient();
const cache = new Map<string, Promise<unknown>>();

function withCache<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const existing = cache.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const nextPromise = loader().catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, nextPromise);
  return nextPromise;
}

export function invalidateDataCache(keys?: string[]): void {
  if (!keys || keys.length === 0) {
    cache.clear();
    return;
  }

  for (const key of keys) {
    cache.delete(key);
  }
}

export async function getTenant(): Promise<Tenant> {
  return withCache('tenant', () => client.fetchTenant());
}

export async function getCurrentUser(): Promise<User> {
  return withCache('currentUser', () => client.fetchCurrentUser());
}

export async function getSuppliers(): Promise<SupplierOrganization[]> {
  return withCache('suppliers', () => client.fetchSuppliers());
}

export async function getPublicCustomers(): Promise<PublicCustomer[]> {
  return withCache('publicCustomers', () => client.fetchPublicCustomers());
}

export async function getPublicServices(): Promise<PublicService[]> {
  return withCache('publicServices', () => client.fetchPublicServices());
}

export async function getInvoices(): Promise<Invoice[]> {
  return withCache('invoices', async () => applyInvoiceRuntimePatches(await client.fetchInvoices()));
}

export async function getInvoiceLines(invoiceId?: string): Promise<InvoiceLine[]> {
  return withCache(`invoiceLines:${invoiceId ?? 'all'}`, () => client.fetchInvoiceLines(invoiceId));
}

export async function getInvoiceAttachments(invoiceId?: string): Promise<InvoiceAttachment[]> {
  return withCache(`invoiceAttachments:${invoiceId ?? 'all'}`, () => client.fetchInvoiceAttachments(invoiceId));
}

export async function getStatusHistory(invoiceId?: string): Promise<InvoiceStatusHistory[]> {
  return withCache(
    `statusHistory:${invoiceId ?? 'all'}`,
    async () => applyStatusHistoryRuntimeEntries(await client.fetchStatusHistory(invoiceId), invoiceId),
  );
}

export async function getApiExchangeLogs(invoiceId?: string): Promise<ApiExchangeLog[]> {
  return withCache(
    `apiExchangeLogs:${invoiceId ?? 'all'}`,
    async () => applyApiLogRuntimeEntries(await client.fetchApiExchangeLogs(invoiceId), invoiceId),
  );
}

export async function getAsyncJobs(): Promise<AsyncJob[]> {
  return withCache('asyncJobs', () => client.fetchAsyncJobs());
}

export async function getAuditLogs(entityId?: string): Promise<AuditLog[]> {
  return withCache(
    `auditLogs:${entityId ?? 'all'}`,
    async () => applyAuditLogRuntimeEntries(await client.fetchAuditLogs(entityId), entityId),
  );
}

export async function getExtractionResults(invoiceId?: string): Promise<InvoiceExtractionResult[]> {
  return withCache(`extractionResults:${invoiceId ?? 'all'}`, () => client.fetchExtractionResults(invoiceId));
}

export async function getSupplier(id: string): Promise<SupplierOrganization | undefined> {
  const suppliers = await getSuppliers();
  return suppliers.find((supplier) => supplier.id === id);
}

export async function getCustomer(id: string): Promise<PublicCustomer | undefined> {
  const customers = await getPublicCustomers();
  return customers.find((customer) => customer.id === id);
}

export async function getService(id: string): Promise<PublicService | undefined> {
  const services = await getPublicServices();
  return services.find((service) => service.id === id);
}

export async function getInvoice(invoiceId: string): Promise<Invoice | undefined> {
  const invoices = await getInvoices();
  return invoices.find((invoice) => invoice.id === invoiceId);
}

export async function getInvoiceHistory(invoiceId: string): Promise<InvoiceStatusHistory[]> {
  const history = await getStatusHistory(invoiceId);
  return [...history].sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime());
}

export async function getInvoiceApiLogs(invoiceId: string): Promise<ApiExchangeLog[]> {
  return getApiExchangeLogs(invoiceId);
}

export async function getServicesForCustomer(customerId: string): Promise<PublicService[]> {
  const services = await getPublicServices();
  return services.filter((service) => service.publicCustomerId === customerId);
}

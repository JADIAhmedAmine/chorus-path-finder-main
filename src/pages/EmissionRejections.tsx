import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ExternalLink, RefreshCw, Search, XCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyState } from '@/components/common/EmptyState';
import { SkeletonTable } from '@/components/common/LoadingSkeleton';
import {
  useInvoicesQuery,
  usePublicCustomersQuery,
  useSuppliersQuery,
} from '@/lib/queries/db';
import { isRejectedChorusStatus } from '@/lib/chorus/actionableInvoices';
import { formatCurrency, formatDate, getChorusRawStatusConfig } from '@/lib/status-utils';
import type { Invoice } from '@/types';

type RejectionFilters = {
  query: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  minAmount: string;
  maxAmount: string;
};

const ALL = 'all';
const EMPTY_FILTERS: RejectionFilters = {
  query: '',
  status: ALL,
  dateFrom: '',
  dateTo: '',
  minAmount: '',
  maxAmount: '',
};

function invoiceStatus(invoice: Invoice): string {
  return invoice.statusChorus || invoice.statusInternal;
}

function normalize(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function timestamp(value: string | undefined, endOfDay = false): number | null {
  if (!value) return null;
  const suffix = endOfDay ? 'T23:59:59.999' : 'T00:00:00.000';
  const parsed = new Date(`${value}${value.includes('T') ? '' : suffix}`).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function numberFilter(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function statusPill(status: string) {
  const config = getChorusRawStatusConfig(status);
  return (
    <span className={`inline-flex max-w-[220px] items-center rounded px-2 py-1 text-xs font-medium ${config.bgClass} ${config.textClass}`}>
      <span className="mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: config.color }} />
      <span className="truncate">{config.label}</span>
    </span>
  );
}

export default function EmissionRejectionsPage() {
  const [filters, setFilters] = useState<RejectionFilters>(EMPTY_FILTERS);
  const invoicesQuery = useInvoicesQuery({ pageSize: 500 });
  const suppliersQuery = useSuppliersQuery();
  const customersQuery = usePublicCustomersQuery();

  const suppliersById = useMemo(
    () => new Map((suppliersQuery.data ?? []).map((supplier) => [supplier.id, supplier])),
    [suppliersQuery.data],
  );
  const customersById = useMemo(
    () => new Map((customersQuery.data ?? []).map((customer) => [customer.id, customer])),
    [customersQuery.data],
  );

  const rejectionRows = useMemo(
    () => (invoicesQuery.data?.items ?? [])
      .filter((invoice) => isRejectedChorusStatus(invoiceStatus(invoice)))
      .sort((left, right) =>
        new Date(right.lastStatusSyncAt || right.statusChangedAt || right.updatedAt).getTime()
        - new Date(left.lastStatusSyncAt || left.statusChangedAt || left.updatedAt).getTime(),
      ),
    [invoicesQuery.data?.items],
  );

  const statusOptions = useMemo(
    () => [...new Set(rejectionRows.map(invoiceStatus).filter(Boolean))].sort(),
    [rejectionRows],
  );

  const filteredRows = useMemo(() => {
    const query = normalize(filters.query);
    const from = timestamp(filters.dateFrom);
    const to = timestamp(filters.dateTo, true);
    const minAmount = numberFilter(filters.minAmount);
    const maxAmount = numberFilter(filters.maxAmount);

    return rejectionRows.filter((invoice) => {
      const supplier = suppliersById.get(invoice.supplierOrganizationId);
      const customer = customersById.get(invoice.publicCustomerId);
      const status = invoiceStatus(invoice);
      const rowDate = new Date(invoice.lastStatusSyncAt || invoice.statusChangedAt || invoice.updatedAt).getTime();
      const haystack = normalize([
        invoice.supplierInvoiceNumber,
        invoice.chorusInvoiceNumber,
        status,
        invoice.statusReasonCode,
        invoice.statusReasonLabel,
        supplier?.legalName,
        supplier?.siret,
        customer?.legalName,
        customer?.siret,
        customer?.codeDestinataire,
      ].filter(Boolean).join(' '));

      if (filters.status !== ALL && status !== filters.status) return false;
      if (query && !haystack.includes(query)) return false;
      if (from !== null && (!Number.isFinite(rowDate) || rowDate < from)) return false;
      if (to !== null && (!Number.isFinite(rowDate) || rowDate > to)) return false;
      if (minAmount !== null && invoice.totalTtc < minAmount) return false;
      if (maxAmount !== null && invoice.totalTtc > maxAmount) return false;
      return true;
    });
  }, [customersById, filters, rejectionRows, suppliersById]);

  const loading = invoicesQuery.isLoading || suppliersQuery.isLoading || customersQuery.isLoading;
  const hasFilters = filters.query.trim()
    || filters.status !== ALL
    || filters.dateFrom
    || filters.dateTo
    || filters.minAmount.trim()
    || filters.maxAmount.trim();

  const updateFilter = (key: keyof RejectionFilters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="space-y-1">
        <div className="flex items-center gap-3">
          <XCircle className="h-6 w-6 text-destructive" />
          <h1 className="text-2xl font-semibold">Rejets / refus d’émission</h1>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Factures émises rejetées ou refusées dans Chorus Pro. Cette page lit le suivi des émissions,
          pas la file de réception.
        </p>
      </header>

      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Analyse des rejets d’émission</AlertTitle>
        <AlertDescription>
          Ces rejets ne sont pas des factures reçues à traiter. Consultez le motif, corrigez l’émission,
          puis préparez une nouvelle soumission ou une action adaptée.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center text-base">
            <XCircle className="mr-2 h-4 w-4 text-destructive" />
            Rejets / refus ({filteredRows.length}/{rejectionRows.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border bg-muted/20 p-3">
            <div className="grid gap-3 lg:grid-cols-[minmax(220px,1.5fr)_minmax(150px,0.8fr)_repeat(4,minmax(130px,0.65fr))_auto]">
              <div className="space-y-1.5">
                <Label htmlFor="emission-reject-search">Recherche</Label>
                <Input
                  id="emission-reject-search"
                  value={filters.query}
                  onChange={(event) => updateFilter('query', event.target.value)}
                  placeholder="N° facture, motif, fournisseur, client..."
                />
              </div>
              <div className="space-y-1.5">
                <Label>Statut</Label>
                <Select value={filters.status} onValueChange={(value) => updateFilter('status', value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Tous les statuts</SelectItem>
                    {statusOptions.map((status) => (
                      <SelectItem key={status} value={status}>{status}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="emission-reject-from">Depuis</Label>
                <Input id="emission-reject-from" type="date" value={filters.dateFrom} onChange={(event) => updateFilter('dateFrom', event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="emission-reject-to">Jusqu'à</Label>
                <Input id="emission-reject-to" type="date" value={filters.dateTo} onChange={(event) => updateFilter('dateTo', event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="emission-reject-min">TTC min</Label>
                <Input id="emission-reject-min" inputMode="decimal" value={filters.minAmount} onChange={(event) => updateFilter('minAmount', event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="emission-reject-max">TTC max</Label>
                <Input id="emission-reject-max" inputMode="decimal" value={filters.maxAmount} onChange={(event) => updateFilter('maxAmount', event.target.value)} />
              </div>
              <div className="flex items-end">
                <Button type="button" variant="outline" className="w-full" disabled={!hasFilters} onClick={() => setFilters(EMPTY_FILTERS)}>
                  Réinitialiser
                </Button>
              </div>
            </div>
          </div>

          {loading ? (
            <SkeletonTable rows={5} columns={9} />
          ) : filteredRows.length > 0 ? (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr className="border-b bg-muted/30 text-left">
                    <th className="p-3 font-medium">N° facture</th>
                    <th className="p-3 font-medium">Statut</th>
                    <th className="p-3 font-medium">Fournisseur</th>
                    <th className="p-3 font-medium">Client public</th>
                    <th className="p-3 font-medium">Motif</th>
                    <th className="p-3 font-medium text-right">TTC</th>
                    <th className="p-3 font-medium">Dernier statut</th>
                    <th className="p-3 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((invoice) => {
                    const supplier = suppliersById.get(invoice.supplierOrganizationId);
                    const customer = customersById.get(invoice.publicCustomerId);
                    return (
                      <tr key={invoice.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="p-3 font-medium">{invoice.supplierInvoiceNumber}</td>
                        <td className="p-3">{statusPill(invoiceStatus(invoice))}</td>
                        <td className="p-3">
                          <div>{supplier?.legalName || invoice.supplierChorusName || '-'}</div>
                          <div className="text-xs text-muted-foreground">{supplier?.siret || invoice.supplierChorusCode || '-'}</div>
                        </td>
                        <td className="p-3">
                          <div>{customer?.legalName || invoice.recipientChorusName || '-'}</div>
                          <div className="text-xs text-muted-foreground">{customer?.siret || invoice.recipientChorusCode || '-'}</div>
                        </td>
                        <td className="max-w-[360px] p-3 text-xs text-muted-foreground">
                          {invoice.statusReasonLabel || invoice.statusReasonCode || 'Motif à consulter dans le détail'}
                        </td>
                        <td className="p-3 text-right font-medium">{formatCurrency(invoice.totalTtc)}</td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {invoice.lastStatusSyncAt ? formatDate(invoice.lastStatusSyncAt) : '-'}
                        </td>
                        <td className="p-3 text-right">
                          <Button variant="ghost" size="sm" asChild>
                            <Link to={`/invoices/chorus/${encodeURIComponent(invoice.id)}`} target="_blank" rel="noreferrer">
                              <ExternalLink className="mr-1 h-3.5 w-3.5" />
                              Détail
                            </Link>
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : rejectionRows.length > 0 ? (
            <EmptyState
              title="Aucun rejet ne correspond aux filtres"
              description="Modifie les filtres pour retrouver les rejets d’émission."
            />
          ) : (
            <EmptyState
              title="Aucun rejet d’émission"
              description="Les factures émises rejetées ou refusées apparaîtront ici après synchronisation du suivi des émissions."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

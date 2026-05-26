import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, Clock3, ExternalLink, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChorusStatusBadge } from '@/components/chorus/ChorusStatusBadge';
import { EmptyState } from '@/components/common/EmptyState';
import { SkeletonTable } from '@/components/common/LoadingSkeleton';
import { SyncRunProgress, SyncRunSummary } from '@/components/common/SyncRunSummary';
import { getStatusHistory } from '@/data/mock-data';
import {
  getInvoiceChorusStatus,
  isRejectedChorusStatus,
} from '@/lib/chorus/actionableInvoices';
import { loadChorusConfig } from '@/lib/chorus/storage';
import {
  type SyncRunResult,
  useInvoicesQuery,
  usePublicCustomersQuery,
  useSuppliersQuery,
  useSyncInvoicesMutation,
  useSyncSuppliersMutation,
} from '@/lib/queries/db';
import { formatCurrency, formatDateTime } from '@/lib/status-utils';
import type { Invoice, InvoiceStatusHistory, PublicCustomer, SupplierOrganization } from '@/types';

type NotificationFilters = {
  query: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  source: string;
};

type NotificationRow = {
  invoice: Invoice;
  status: string;
  previousStatus?: string;
  eventAt: string;
  eventLabel: string;
  source: 'HISTORY' | 'ACTION' | 'SYNC' | 'STATUS_DATE';
  motif: string;
  historyEvents: InvoiceStatusHistory[];
  latestAction?: InvoiceStatusHistory;
  supplier?: SupplierOrganization;
  customer?: PublicCustomer;
};

const ALL = 'all';
const EMPTY_FILTERS: NotificationFilters = {
  query: '',
  status: ALL,
  dateFrom: '',
  dateTo: '',
  source: ALL,
};

function parseConfiguredSupplierId(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}

function normalize(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function dateBoundaryTimestamp(value: string, endOfDay = false): number | null {
  if (!value) return null;
  const suffix = endOfDay ? 'T23:59:59.999' : 'T00:00:00.000';
  const parsed = new Date(`${value}${value.includes('T') ? '' : suffix}`).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function toTimestamp(value: string | undefined): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function rawPayload(invoice: Invoice): Record<string, unknown> {
  return typeof invoice.rawPayload === 'object' && invoice.rawPayload !== null && !Array.isArray(invoice.rawPayload)
    ? invoice.rawPayload
    : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isReceptionDerivedInvoice(invoice: Invoice): boolean {
  const raw = rawPayload(invoice);
  const classification = raw.receptionClassification;
  const kind = isRecord(classification) ? String(classification.kind ?? '').toUpperCase() : '';

  return Boolean(raw.receptionNormalized)
    || Boolean(raw.receptionProcessing)
    || kind.includes('FACTURE_RECUE')
    || kind.includes('RECEPTION');
}

function isEmittedChorusInvoice(invoice: Invoice): boolean {
  return Boolean(
    invoice.statusChorus
    || invoice.chorusInvoiceNumber
    || invoice.lastStatusSyncAt
    || invoice.submittedAt,
  );
}

function latestHistoryEvent(history: InvoiceStatusHistory[]): InvoiceStatusHistory | undefined {
  return [...history].sort((left, right) => toTimestamp(right.occurredAt) - toTimestamp(left.occurredAt))[0];
}

function normalizedStatus(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_');
}

function isAvailabilityOnlyStatus(status: string): boolean {
  const normalized = normalizedStatus(status);
  return normalized.includes('MISE_A_DISPOSITION')
    || normalized.includes('MISE_A_DIPOSITION');
}

function isDestinationTreatmentStatus(status: string): boolean {
  const normalized = normalizedStatus(status);
  if (!normalized || isAvailabilityOnlyStatus(normalized)) {
    return false;
  }

  return normalized.includes('REJET')
    || normalized.includes('REFUS')
    || normalized.includes('SUSPEND')
    || normalized.includes('RECYCL')
    || normalized.includes('MISE_EN_PAIEMENT')
    || normalized.includes('MANDAT')
    || normalized.includes('COMPTABIL')
    || normalized.includes('SERVICE_FAIT')
    || normalized.includes('PAY')
    || normalized.includes('PAIE');
}

function hasTreatmentActionMarker(value: string): boolean {
  return value.includes('trait')
    || value.includes('valid')
    || value.includes('rejet')
    || value.includes('refus')
    || value.includes('suspend')
    || value.includes('recycl')
    || value.includes('mandat')
    || value.includes('paiement')
    || value.includes('comptabil')
    || value.includes('service fait');
}

function eventText(event: InvoiceStatusHistory): string {
  return normalize([
    event.source,
    event.eventCode,
    event.eventLabel,
    event.previousStatus,
    event.newStatus,
    event.rawSnapshot ? JSON.stringify(event.rawSnapshot) : '',
  ].join(' '));
}

function isDestinationTreatmentAction(event: InvoiceStatusHistory): boolean {
  if (isDestinationTreatmentStatus(event.newStatus)) {
    return true;
  }

  const text = eventText(event);
  if (!hasTreatmentActionMarker(text)) {
    return false;
  }

  return event.source === 'CHORUS'
    || text.includes('destinataire')
    || text.includes('valideur');
}

function latestDestinationActionEvent(history: InvoiceStatusHistory[]): InvoiceStatusHistory | undefined {
  return [...history]
    .filter(isDestinationTreatmentAction)
    .sort((left, right) => toTimestamp(right.occurredAt) - toTimestamp(left.occurredAt))[0];
}

function isNotificationWorthy(status: string, history: InvoiceStatusHistory[], invoice: Invoice): boolean {
  if (isDestinationTreatmentStatus(status)) {
    return true;
  }

  if (latestDestinationActionEvent(history)) {
    return true;
  }

  if (isAvailabilityOnlyStatus(status)) {
    return false;
  }

  const reason = normalize([invoice.statusReasonCode, invoice.statusReasonLabel].filter(Boolean).join(' '));
  return reason.includes('rejet')
    || reason.includes('refus')
    || reason.includes('suspend')
    || reason.includes('recycl');
}

function sourceLabel(source: NotificationRow['source']): string {
  if (source === 'ACTION') return 'Action Chorus';
  if (source === 'HISTORY') return 'Historique statut';
  if (source === 'STATUS_DATE') return 'Changement détecté';
  return 'Synchronisation Chorus';
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = asString(record[key]);
    if (value) return value;
  }
  return undefined;
}

function toRecordArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  return isRecord(value) ? [value] : [];
}

function rawActionEvents(invoice: Invoice, currentStatus: string): InvoiceStatusHistory[] {
  const raw = rawPayload(invoice);
  const actionSection = [
    raw.historiquesDesActionsUtilisateurs,
    raw.historiqueActions,
    raw.actions,
  ].find(isRecord);

  const actionItems = [
    ...(isRecord(actionSection) ? toRecordArray(actionSection.histoAction) : []),
    ...toRecordArray(raw.histoAction),
    ...toRecordArray(raw.derniereAction),
  ];

  return actionItems
    .map((action, index): InvoiceStatusHistory | null => {
      const code = firstString(action, [
        'histoActionCode',
        'derniereActionCode',
        'actionCode',
        'codeAction',
        'code',
      ]);
      if (!code) return null;

      const occurredAt = firstString(action, [
        'histoActionDateHeure',
        'derniereActionDateHeure',
        'dateAction',
        'dateHeureAction',
        'occurredAt',
      ]) || invoice.statusChangedAt || invoice.lastStatusSyncAt || invoice.updatedAt;

      return {
        id: `${invoice.id}-raw-action-${index}`,
        tenantId: invoice.tenantId,
        invoiceId: invoice.id,
        source: 'CHORUS',
        previousStatus: undefined,
        newStatus: currentStatus,
        eventCode: code,
        eventLabel: firstString(action, ['histoActionLibelle', 'derniereActionLibelle', 'actionLabel', 'libelle']) || code,
        rawSnapshot: action,
        occurredAt,
      };
    })
    .filter((event): event is InvoiceStatusHistory => event !== null);
}

function notificationDate(invoice: Invoice, history?: InvoiceStatusHistory): string | null {
  return history?.occurredAt
    || invoice.statusChangedAt
    || invoice.lastStatusSyncAt
    || null;
}

function notificationStatus(invoice: Invoice, history?: InvoiceStatusHistory): string {
  return history?.newStatus || getInvoiceChorusStatus(invoice);
}

function notificationMotif(invoice: Invoice, history?: InvoiceStatusHistory): string {
  return invoice.statusReasonLabel
    || invoice.statusReasonCode
    || history?.eventLabel
    || history?.eventCode
    || 'Statut mis à jour par Chorus. Ouvre la fiche pour consulter le détail.';
}

function buildNotificationRows(
  invoices: Invoice[],
  histories: InvoiceStatusHistory[],
  suppliersById: Map<string, SupplierOrganization>,
  customersById: Map<string, PublicCustomer>,
): NotificationRow[] {
  const historyByInvoiceId = histories.reduce((map, event) => {
    if (!event.invoiceId) return map;
    const list = map.get(event.invoiceId) ?? [];
    list.push(event);
    map.set(event.invoiceId, list);
    return map;
  }, new Map<string, InvoiceStatusHistory[]>());

  return invoices
    .filter((invoice) => !isReceptionDerivedInvoice(invoice))
    .filter(isEmittedChorusInvoice)
    .map((invoice) => {
      const currentStatus = getInvoiceChorusStatus(invoice);
      const historyEvents = [
        ...(historyByInvoiceId.get(invoice.id) ?? []),
        ...rawActionEvents(invoice, currentStatus),
      ];
      const history = latestHistoryEvent(historyEvents);
      const eventAt = notificationDate(invoice, history);
      const status = notificationStatus(invoice, history);
      const latestAction = latestDestinationActionEvent(historyEvents);

      if (!eventAt || !status) {
        return null;
      }

      if (!isNotificationWorthy(status, historyEvents, invoice)) {
        return null;
      }

      return {
        invoice,
        status,
        previousStatus: history?.previousStatus,
        eventAt,
        eventLabel: history?.eventLabel || 'Mise à jour du statut Chorus',
        source: latestAction && latestAction.id === history?.id ? 'ACTION' : history ? 'HISTORY' : invoice.statusChangedAt ? 'STATUS_DATE' : 'SYNC',
        motif: notificationMotif(invoice, history),
        historyEvents,
        latestAction,
        supplier: suppliersById.get(invoice.supplierOrganizationId),
        customer: customersById.get(invoice.publicCustomerId),
      } satisfies NotificationRow;
    })
    .filter((row): row is NotificationRow => row !== null)
    .sort((left, right) => toTimestamp(right.eventAt) - toTimestamp(left.eventAt));
}

export default function InvoiceNotificationsPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<NotificationFilters>(EMPTY_FILTERS);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const invoicesQuery = useInvoicesQuery({ pageSize: 500 });
  const suppliersQuery = useSuppliersQuery();
  const customersQuery = usePublicCustomersQuery();
  const syncInvoices = useSyncInvoicesMutation();
  const syncSuppliers = useSyncSuppliersMutation();
  const historyQuery = useQuery({
    queryKey: ['invoice-status-history', 'notifications'],
    queryFn: async () => getStatusHistory().catch(() => [] as InvoiceStatusHistory[]),
    staleTime: 5 * 60 * 1000,
  });

  const suppliersById = useMemo(
    () => new Map((suppliersQuery.data ?? []).map((supplier) => [supplier.id, supplier])),
    [suppliersQuery.data],
  );
  const customersById = useMemo(
    () => new Map((customersQuery.data ?? []).map((customer) => [customer.id, customer])),
    [customersQuery.data],
  );

  const notificationRows = useMemo(
    () => buildNotificationRows(
      invoicesQuery.data?.items ?? [],
      historyQuery.data ?? [],
      suppliersById,
      customersById,
    ),
    [customersById, historyQuery.data, invoicesQuery.data?.items, suppliersById],
  );

  const statusOptions = useMemo(
    () => [...new Set(notificationRows.map((row) => row.status).filter(Boolean))].sort(),
    [notificationRows],
  );

  const filteredRows = useMemo(() => {
    const query = normalize(filters.query);
    const from = dateBoundaryTimestamp(filters.dateFrom);
    const to = dateBoundaryTimestamp(filters.dateTo, true);

    return notificationRows.filter((row) => {
      const invoice = row.invoice;
      const haystack = normalize([
        invoice.supplierInvoiceNumber,
        invoice.chorusInvoiceNumber,
        row.status,
        row.previousStatus,
        row.motif,
        row.eventLabel,
        row.supplier?.legalName,
        row.supplier?.siret,
        row.customer?.legalName,
        row.customer?.siret,
        invoice.recipientChorusName,
        invoice.supplierChorusName,
      ].filter(Boolean).join(' '));
      const rowDate = toTimestamp(row.eventAt);

      if (filters.status !== ALL && row.status !== filters.status) return false;
      if (filters.source !== ALL && row.source !== filters.source) return false;
      if (query && !haystack.includes(query)) return false;
      if (from !== null && (!rowDate || rowDate < from)) return false;
      if (to !== null && (!rowDate || rowDate > to)) return false;
      return true;
    });
  }, [filters, notificationRows]);

  const stats = useMemo(() => {
    const rejected = notificationRows.filter((row) => isRejectedChorusStatus(row.status)).length;
    const suspended = notificationRows.filter((row) => row.status.toUpperCase().includes('SUSPEND')).length;
    const actions = notificationRows.filter((row) => row.latestAction).length;
    const latest = notificationRows[0]?.eventAt ?? null;
    return {
      total: notificationRows.length,
      rejected,
      suspended,
      actions,
      statuses: new Set(notificationRows.map((row) => row.status)).size,
      latest,
    };
  }, [notificationRows]);

  const loading = invoicesQuery.isLoading || suppliersQuery.isLoading || customersQuery.isLoading || historyQuery.isLoading;
  const syncing = syncInvoices.isPending || syncSuppliers.isPending;
  const error = syncError || invoicesQuery.error?.message || suppliersQuery.error?.message || customersQuery.error?.message || null;
  const lastSyncRuns: SyncRunResult[] = syncInvoices.data ?? [];
  const hasFilters = Boolean(
    filters.query.trim()
    || filters.status !== ALL
    || filters.dateFrom
    || filters.dateTo
    || filters.source !== ALL,
  );

  const updateFilter = (key: keyof NotificationFilters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  async function handleRefresh() {
    setSyncError(null);
    try {
      const config = loadChorusConfig();
      const supplierId = parseConfiguredSupplierId(config.submissionSupplierId);
      const syncInput = {
        environment: config.environment,
        ...(supplierId !== undefined ? { supplierId } : {}),
      };

      await syncSuppliers.mutateAsync(syncInput).catch((supplierSyncError) => {
        console.warn('[notifications] sync suppliers skipped', supplierSyncError);
      });
      const runs = await syncInvoices.mutateAsync({ ...syncInput, mode: 'full' });
      const lastRun = runs[runs.length - 1];
      setLastSyncAt(lastRun?.finishedAt || lastRun?.startedAt || new Date().toISOString());
    } catch (refreshError) {
      setSyncError(refreshError instanceof Error ? refreshError.message : 'Synchronisation impossible.');
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Bell className="h-7 w-7 text-primary" />
            <div>
              <h1 className="text-2xl font-semibold">Notifications d’émission</h1>
              <p className="max-w-4xl text-sm text-muted-foreground">
                Ici on suit les factures émises dont Chorus a remonté un changement de statut côté destinataire.
                La page est en lecture seule : on observe le retour, puis on ouvre la fiche complète si besoin.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Émission</Badge>
            <Badge variant="outline">Lecture seule</Badge>
            <Badge variant="outline">Basé sur le statut Chorus et l’historique disponible</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void handleRefresh()} disabled={syncing}>
            {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Actualiser Chorus
          </Button>
        </div>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Synchronisation indisponible</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {syncing && lastSyncRuns.length > 0 && (
        <div className="rounded-md border bg-card p-3">
          <div className="space-y-3">
            <SyncRunProgress runs={lastSyncRuns} />
          </div>
        </div>
      )}

      {lastSyncAt && !syncing && lastSyncRuns.length > 0 && (
        <div className="rounded-md border bg-card p-3">
          <SyncRunSummary runs={lastSyncRuns} title={`Dernière actualisation : ${formatDateTime(lastSyncAt)}`} />
        </div>
      )}

      <Alert>
        <Clock3 className="h-4 w-4" />
        <AlertTitle>Aucune action métier directe ici</AlertTitle>
        <AlertDescription>
          Une notification signale un changement de statut sur une facture émise. Les corrections, compléments ou rejets
          se traitent depuis les pages Émissions à traiter, Rejets / refus ou depuis la fiche de facture.
          L’historique et les actions connues restent affichés ici pour comprendre le contexte.
          MISE_A_DISPOSITION seule reste du suivi normal : elle n’apparaît pas comme notification tant que le destinataire n’a pas traité.
        </AlertDescription>
      </Alert>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground">Notifications</div>
            <div className="mt-2 text-3xl font-semibold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground">Rejets / refus</div>
            <div className="mt-2 text-3xl font-semibold text-destructive">{stats.rejected}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground">Suspendues</div>
            <div className="mt-2 text-3xl font-semibold">{stats.suspended}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground">Actions connues</div>
            <div className="mt-2 text-3xl font-semibold">{stats.actions}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground">Statuts observés</div>
            <div className="mt-2 text-3xl font-semibold">{stats.statuses}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground">Dernière notification</div>
            <div className="mt-2 text-sm font-medium">{stats.latest ? formatDateTime(stats.latest) : '-'}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center text-base">
            <Bell className="mr-2 h-4 w-4 text-primary" />
            Changements de statut ({filteredRows.length}/{notificationRows.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border bg-muted/20 p-3">
            <div className="grid gap-3 lg:grid-cols-[minmax(260px,1.5fr)_minmax(170px,0.8fr)_minmax(170px,0.8fr)_repeat(2,minmax(140px,0.65fr))_auto]">
              <div className="space-y-1.5">
                <Label htmlFor="notification-search">Recherche</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="notification-search"
                    className="pl-9"
                    value={filters.query}
                    onChange={(event) => updateFilter('query', event.target.value)}
                    placeholder="N° facture, statut, motif, fournisseur, destinataire..."
                  />
                </div>
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
                <Label>Source</Label>
                <Select value={filters.source} onValueChange={(value) => updateFilter('source', value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Toutes</SelectItem>
                    <SelectItem value="ACTION">Actions Chorus</SelectItem>
                    <SelectItem value="HISTORY">Historique</SelectItem>
                    <SelectItem value="STATUS_DATE">Changement</SelectItem>
                    <SelectItem value="SYNC">Synchronisation</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="notification-from">Depuis</Label>
                <Input id="notification-from" type="date" value={filters.dateFrom} onChange={(event) => updateFilter('dateFrom', event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="notification-to">Jusqu'à</Label>
                <Input id="notification-to" type="date" value={filters.dateTo} onChange={(event) => updateFilter('dateTo', event.target.value)} />
              </div>
              <div className="flex items-end">
                <Button type="button" variant="outline" className="w-full" disabled={!hasFilters} onClick={() => setFilters(EMPTY_FILTERS)}>
                  <X className="mr-2 h-4 w-4" />
                  Réinitialiser
                </Button>
              </div>
            </div>
          </div>

          {loading ? (
            <SkeletonTable rows={5} columns={9} />
          ) : filteredRows.length > 0 ? (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[1260px] text-sm">
                <thead>
                  <tr className="border-b bg-muted/30 text-left">
                    <th className="p-3 font-medium">Facture émise</th>
                    <th className="p-3 font-medium">Nouveau statut</th>
                    <th className="p-3 font-medium">Fournisseur</th>
                    <th className="p-3 font-medium">Destinataire</th>
                    <th className="p-3 font-medium">Notification</th>
                    <th className="p-3 font-medium">Motif / retour</th>
                    <th className="p-3 font-medium">Historique / actions</th>
                    <th className="p-3 font-medium text-right">TTC</th>
                    <th className="p-3 font-medium">Source</th>
                    <th className="p-3 font-medium text-right">Fiche</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => {
                    const invoice = row.invoice;
                    const detailPath = `/invoices/chorus/${encodeURIComponent(invoice.id)}`;
                    return (
                      <tr
                        key={`${invoice.id}-${row.eventAt}-${row.status}`}
                        role="button"
                        tabIndex={0}
                        className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/30 focus:bg-muted/30 focus:outline-none"
                        onClick={() => navigate(detailPath)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            navigate(detailPath);
                          }
                        }}
                      >
                        <td className="p-3">
                          <div className="font-medium text-primary">
                            {invoice.supplierInvoiceNumber || invoice.chorusInvoiceNumber || invoice.id}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {invoice.chorusInvoiceNumber ? `Chorus ${invoice.chorusInvoiceNumber}` : `ID ${invoice.id}`}
                          </div>
                        </td>
                        <td className="p-3">
                          <div className="space-y-1">
                            <ChorusStatusBadge value={row.status} />
                            {row.previousStatus && (
                              <div className="text-[11px] text-muted-foreground">avant : {row.previousStatus}</div>
                            )}
                          </div>
                        </td>
                        <td className="p-3">
                          <div>{row.supplier?.legalName || invoice.supplierChorusName || '-'}</div>
                          <div className="text-xs text-muted-foreground">{row.supplier?.siret || invoice.supplierChorusCode || '-'}</div>
                        </td>
                        <td className="p-3">
                          <div>{row.customer?.legalName || invoice.recipientChorusName || '-'}</div>
                          <div className="text-xs text-muted-foreground">{row.customer?.siret || invoice.recipientChorusCode || '-'}</div>
                        </td>
                        <td className="p-3">
                          <div className="font-medium">{formatDateTime(row.eventAt)}</div>
                          <div className="text-xs text-muted-foreground">{row.eventLabel}</div>
                        </td>
                        <td className="max-w-[360px] p-3 text-xs text-muted-foreground">
                          <span className="line-clamp-2">{row.motif}</span>
                        </td>
                        <td className="max-w-[280px] p-3 text-xs">
                          <div className="font-medium">{row.historyEvents.length} événement(s)</div>
                          <div className="mt-1 text-muted-foreground">
                            {row.latestAction
                              ? `${row.latestAction.eventLabel || row.latestAction.eventCode} - ${formatDateTime(row.latestAction.occurredAt)}`
                              : 'Aucune action utilisateur connue'}
                          </div>
                        </td>
                        <td className="p-3 text-right font-medium">{formatCurrency(invoice.totalTtc)}</td>
                        <td className="p-3 text-xs text-muted-foreground">{sourceLabel(row.source)}</td>
                        <td className="p-3 text-right" onClick={(event) => event.stopPropagation()}>
                          <Button variant="ghost" size="sm" asChild>
                            <Link to={detailPath}>
                              <ExternalLink className="mr-1 h-3.5 w-3.5" />
                              Afficher la fiche complète
                            </Link>
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : notificationRows.length > 0 ? (
            <EmptyState
              title="Aucune notification ne correspond aux filtres"
              description="Modifie les filtres pour retrouver un changement de statut."
            />
          ) : (
            <EmptyState
              icon={Bell}
              title="Aucune notification d’émission"
              description="Les changements de statut sur les factures émises apparaîtront ici après synchronisation Chorus."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

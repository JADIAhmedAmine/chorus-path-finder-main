import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  Clock3,
  ExternalLink,
  Euro,
  FileWarning,
  Filter as FilterIcon,
  MessageSquareWarning,
  X,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import { ProcessExplanationCard } from '@/components/flux/ProcessExplanationCard';
import { PAGE_EXPLANATIONS } from '@/lib/flux/content';
import { KpiCard } from '@/components/common/KpiCard';
import { ApiErrorCard } from '@/components/common/ApiErrorCard';
import { SkeletonTable } from '@/components/common/LoadingSkeleton';
import { InvoiceDownloadMenu } from '@/components/chorus/InvoiceDownloadMenu';
import { InvoiceContextBadge } from '@/components/chorus/InvoiceContextBadge';
import { InvoiceOverviewDrawer } from '@/components/chorus/InvoiceOverviewDrawer';
import {
  useInvoicesQuery,
  usePublicCustomersQuery,
  useSuppliersQuery,
} from '@/lib/queries/db';
import { toDisplayInvoiceFromInvoice } from '@/lib/chorus/invoiceDisplay';
import { isRejectedChorusStatus } from '@/lib/chorus/actionableInvoices';
import { formatCurrency, formatDate, getChorusRawStatusConfig } from '@/lib/status-utils';
import type { Invoice } from '@/types';
import { cn } from '@/lib/utils';

type RejectionFilters = {
  query: string;
  status: string;
  reasonKey: string;
  dateFrom: string;
  dateTo: string;
  minAmount: string;
  maxAmount: string;
};

const ALL = 'all';
const EMPTY_FILTERS: RejectionFilters = {
  query: '',
  status: ALL,
  reasonKey: ALL,
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
    .replace(/[̀-ͯ]/g, '')
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

function reasonKeyOf(invoice: Invoice): string {
  return (invoice.statusReasonCode || invoice.statusReasonLabel || 'INCONNU').trim();
}

function reasonLabelOf(invoice: Invoice): string {
  return invoice.statusReasonLabel
    || invoice.statusReasonCode
    || 'Motif non communiqué';
}

function lastActivity(invoice: Invoice): string | undefined {
  return invoice.lastStatusSyncAt || invoice.statusChangedAt || invoice.updatedAt;
}

/** Heuristic friendly suggestion based on common Chorus rejection patterns. */
function suggestionFor(invoice: Invoice): string {
  const reason = `${invoice.statusReasonCode ?? ''} ${invoice.statusReasonLabel ?? ''}`.toLowerCase();
  if (reason.includes('siret')) {
    return 'Vérifier le SIRET destinataire (annuaire Chorus) ou demander la mise à jour côté client.';
  }
  if (reason.includes('engagement')) {
    return 'Renseigner un numéro d’engagement valide communiqué par le client.';
  }
  if (reason.includes('commande') || reason.includes('marche') || reason.includes('marché')) {
    return 'Joindre le bon de commande / marché correspondant et resoumettre.';
  }
  if (reason.includes('montant') || reason.includes('tva') || reason.includes('ttc')) {
    return 'Contrôler les montants HT/TVA/TTC et la cohérence des taux avant nouvelle émission.';
  }
  if (reason.includes('doublon')) {
    return 'Cette facture existe déjà côté Chorus. Vérifier l’historique avant de la resoumettre.';
  }
  if (reason.includes('signature')) {
    return 'Le PDF doit être signé selon la politique attendue (PAdES). Régénérer le PDF/A-3 signé.';
  }
  if (reason.includes('format') || reason.includes('xml') || reason.includes('schema')) {
    return 'Le format XML / Factur-X est invalide. Régénérer la facture via l’ERP ou l’assistant de saisie.';
  }
  return 'Consulter le détail Chorus pour identifier l’élément invalide et préparer une nouvelle émission.';
}

function StatusPill({ status }: { status: string }) {
  const config = getChorusRawStatusConfig(status);
  return (
    <span
      className={cn(
        'inline-flex max-w-[220px] items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset',
        config.bgClass,
        config.textClass,
        'ring-current/10',
      )}
    >
      <span className="mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: config.color }} />
      <span className="truncate">{config.label}</span>
    </span>
  );
}

export default function EmissionRejectionsPage() {
  const [filters, setFilters] = useState<RejectionFilters>(EMPTY_FILTERS);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
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
  const selectedDisplayInvoice = useMemo(
    () => selectedInvoice
      ? toDisplayInvoiceFromInvoice(
          selectedInvoice,
          suppliersById.get(selectedInvoice.supplierOrganizationId),
          customersById.get(selectedInvoice.publicCustomerId),
          {
            context: 'emission',
            source: 'Rejets / refus d’émission',
            detailHref: `/invoices/chorus/${encodeURIComponent(selectedInvoice.id)}`,
          },
        )
      : null,
    [customersById, selectedInvoice, suppliersById],
  );

  const rejectionRows = useMemo(
    () => (invoicesQuery.data?.items ?? [])
      .filter((invoice) => isRejectedChorusStatus(invoiceStatus(invoice)))
      .sort((left, right) =>
        new Date(lastActivity(right) ?? 0).getTime()
        - new Date(lastActivity(left) ?? 0).getTime(),
      ),
    [invoicesQuery.data?.items],
  );

  const statusOptions = useMemo(
    () => [...new Set(rejectionRows.map(invoiceStatus).filter(Boolean))].sort(),
    [rejectionRows],
  );

  const reasonGroups = useMemo(() => {
    const map = new Map<string, { label: string; count: number; amount: number }>();
    for (const invoice of rejectionRows) {
      const key = reasonKeyOf(invoice);
      const current = map.get(key) ?? { label: reasonLabelOf(invoice), count: 0, amount: 0 };
      current.count += 1;
      current.amount += invoice.totalTtc;
      map.set(key, current);
    }
    return [...map.entries()]
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => b.count - a.count || b.amount - a.amount);
  }, [rejectionRows]);

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
      const rowDate = new Date(lastActivity(invoice) ?? 0).getTime();
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
      if (filters.reasonKey !== ALL && reasonKeyOf(invoice) !== filters.reasonKey) return false;
      if (query && !haystack.includes(query)) return false;
      if (from !== null && (!Number.isFinite(rowDate) || rowDate < from)) return false;
      if (to !== null && (!Number.isFinite(rowDate) || rowDate > to)) return false;
      if (minAmount !== null && invoice.totalTtc < minAmount) return false;
      if (maxAmount !== null && invoice.totalTtc > maxAmount) return false;
      return true;
    });
  }, [customersById, filters, rejectionRows, suppliersById]);

  const loading = invoicesQuery.isLoading || suppliersQuery.isLoading || customersQuery.isLoading;
  const error = invoicesQuery.error?.message || suppliersQuery.error?.message || customersQuery.error?.message;
  const hasFilters = filters.query.trim()
    || filters.status !== ALL
    || filters.reasonKey !== ALL
    || filters.dateFrom
    || filters.dateTo
    || filters.minAmount.trim()
    || filters.maxAmount.trim();

  const updateFilter = (key: keyof RejectionFilters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  // KPIs
  const totalAmount = rejectionRows.reduce((sum, i) => sum + i.totalTtc, 0);
  const filteredAmount = filteredRows.reduce((sum, i) => sum + i.totalTtc, 0);
  const topReason = reasonGroups[0];
  const oldest = rejectionRows.reduce<Invoice | null>((acc, inv) => {
    const accTs = acc ? new Date(lastActivity(acc) ?? 0).getTime() : Infinity;
    const ts = new Date(lastActivity(inv) ?? 0).getTime();
    return Number.isFinite(ts) && ts < accTs ? inv : acc;
  }, null);

  return (
    <div className="space-y-7 animate-fade-in">
      <PageHeader
        eyebrow={
          <>
            <MessageSquareWarning className="h-3 w-3" />
            Émission · rejets
          </>
        }
        title="Rejets / refus d’émission"
        description="Factures émises rejetées ou refusées dans Chorus Pro. Comprends les motifs, télécharge le détail, prépare une nouvelle émission."
        actions={
          <Button asChild>
            <Link to="/invoices/new">
              <ArrowRight className="mr-2 h-4 w-4" />
              Nouvelle émission
            </Link>
          </Button>
        }
      />

      <ProcessExplanationCard {...PAGE_EXPLANATIONS.erreurs} />

      {error && (
        <ApiErrorCard
          severity="error"
          title="Lecture du cache impossible"
          explanation="Impossible de charger les factures rejetées depuis la base locale."
          technicalDetails={error}
        />
      )}

      {/* KPI strip */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 stagger-children">
        <KpiCard
          label="Factures rejetées"
          value={loading ? '—' : rejectionRows.length.toLocaleString('fr-FR')}
          hint={`${filteredRows.length} après filtres`}
          icon={XCircle}
          tone="danger"
          loading={loading}
        />
        <KpiCard
          label="Montant à risque"
          value={loading ? '—' : formatCurrency(totalAmount)}
          hint={`${formatCurrency(filteredAmount)} filtré`}
          icon={Euro}
          tone="warning"
          loading={loading}
        />
        <KpiCard
          label="Motif principal"
          value={topReason ? topReason.label : '—'}
          hint={topReason ? `${topReason.count} occurrence${topReason.count > 1 ? 's' : ''}` : 'Aucun rejet'}
          icon={FileWarning}
          tone="primary"
          loading={loading}
        />
        <KpiCard
          label="Plus ancien rejet"
          value={oldest ? formatDate(lastActivity(oldest) ?? '') : '—'}
          hint={oldest ? oldest.supplierInvoiceNumber : 'Aucun rejet'}
          icon={Clock3}
          tone="info"
          loading={loading}
        />
      </section>

      {/* Patterns + List */}
      <section className="grid gap-5 xl:grid-cols-[320px_1fr]">
        {/* Pattern panel */}
        <Card className="card-elevated self-start xl:sticky xl:top-20">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-[15px]">Motifs de rejet</CardTitle>
                <CardDescription className="text-[12px]">Regroupement par cause Chorus.</CardDescription>
              </div>
              {filters.reasonKey !== ALL && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => updateFilter('reasonKey', ALL)}
                >
                  <X className="mr-1 h-3 w-3" /> Tout
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <div className="space-y-2">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
                ))}
              </div>
            ) : reasonGroups.length === 0 ? (
              <EmptyState icon={MessageSquareWarning} title="Aucun motif" description="Aucun rejet identifié dans le cache." />
            ) : (
              <ScrollArea className="h-[460px] pr-2">
                <ul className="space-y-1.5">
                  {reasonGroups.map((group) => {
                    const active = filters.reasonKey === group.key;
                    const max = reasonGroups[0]?.count ?? 1;
                    const ratio = Math.max(8, Math.round((group.count / max) * 100));
                    return (
                      <li key={group.key}>
                        <button
                          type="button"
                          onClick={() => updateFilter('reasonKey', active ? ALL : group.key)}
                          className={cn(
                            'group relative w-full overflow-hidden rounded-lg border bg-card p-3 text-left transition-all',
                            'hover:-translate-y-px hover:border-destructive/40 hover:shadow-soft',
                            active && 'border-destructive bg-destructive-soft/40 ring-1 ring-destructive/40',
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="line-clamp-2 text-[12.5px] font-medium leading-snug text-foreground">
                                {group.label}
                              </p>
                              <p className="mt-1 text-[11px] text-muted-foreground">
                                {formatCurrency(group.amount)}
                              </p>
                            </div>
                            <span
                              className={cn(
                                'ml-1 flex h-6 min-w-[28px] shrink-0 items-center justify-center rounded-full px-1.5 text-[11.5px] font-semibold tabular-nums',
                                active
                                  ? 'bg-destructive text-destructive-foreground'
                                  : 'bg-destructive-soft text-destructive',
                              )}
                            >
                              {group.count}
                            </span>
                          </div>
                          <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn(
                                'h-full rounded-full transition-all',
                                active ? 'bg-destructive' : 'bg-destructive/60',
                              )}
                              style={{ width: `${ratio}%` }}
                            />
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        {/* List */}
        <div className="space-y-4">
          {/* Filter bar */}
          <Card className="card-surface">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 pb-3">
                <FilterIcon className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-[13px] font-semibold">Filtres</h3>
                {hasFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-7 px-2 text-[11.5px]"
                    onClick={() => setFilters(EMPTY_FILTERS)}
                  >
                    <X className="mr-1 h-3 w-3" /> Réinitialiser
                  </Button>
                )}
              </div>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                <div className="space-y-1.5 lg:col-span-2 xl:col-span-2">
                  <Label htmlFor="r-search" className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Recherche
                  </Label>
                  <Input
                    id="r-search"
                    value={filters.query}
                    onChange={(event) => updateFilter('query', event.target.value)}
                    placeholder="N° facture, motif, fournisseur, client…"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Statut
                  </Label>
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
                  <Label htmlFor="r-from" className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Depuis
                  </Label>
                  <Input id="r-from" type="date" value={filters.dateFrom} onChange={(event) => updateFilter('dateFrom', event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="r-to" className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Jusqu’à
                  </Label>
                  <Input id="r-to" type="date" value={filters.dateTo} onChange={(event) => updateFilter('dateTo', event.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-2 lg:col-span-1 xl:col-span-1">
                  <div className="space-y-1.5">
                    <Label htmlFor="r-min" className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      Min €
                    </Label>
                    <Input id="r-min" inputMode="decimal" value={filters.minAmount} onChange={(event) => updateFilter('minAmount', event.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="r-max" className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      Max €
                    </Label>
                    <Input id="r-max" inputMode="decimal" value={filters.maxAmount} onChange={(event) => updateFilter('maxAmount', event.target.value)} />
                  </div>
                </div>
              </div>

              {/* Active filter chips */}
              {hasFilters && (
                <>
                  <Separator className="my-3" />
                  <div className="flex flex-wrap gap-1.5">
                    {filters.query && (
                      <FilterChip label={`« ${filters.query} »`} onClear={() => updateFilter('query', '')} />
                    )}
                    {filters.status !== ALL && (
                      <FilterChip label={`Statut : ${filters.status}`} onClear={() => updateFilter('status', ALL)} />
                    )}
                    {filters.reasonKey !== ALL && (
                      <FilterChip
                        label={`Motif : ${reasonGroups.find((g) => g.key === filters.reasonKey)?.label ?? filters.reasonKey}`}
                        onClear={() => updateFilter('reasonKey', ALL)}
                      />
                    )}
                    {filters.dateFrom && (
                      <FilterChip label={`Depuis : ${filters.dateFrom}`} onClear={() => updateFilter('dateFrom', '')} />
                    )}
                    {filters.dateTo && (
                      <FilterChip label={`Jusqu’à : ${filters.dateTo}`} onClear={() => updateFilter('dateTo', '')} />
                    )}
                    {filters.minAmount && (
                      <FilterChip label={`Min : ${filters.minAmount} €`} onClear={() => updateFilter('minAmount', '')} />
                    )}
                    {filters.maxAmount && (
                      <FilterChip label={`Max : ${filters.maxAmount} €`} onClear={() => updateFilter('maxAmount', '')} />
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* List header */}
          <div className="flex items-center justify-between px-1">
            <p className="text-[13px] text-muted-foreground">
              <span className="font-semibold text-foreground">{filteredRows.length}</span> facture{filteredRows.length > 1 ? 's' : ''} affichée{filteredRows.length > 1 ? 's' : ''}
              {filteredRows.length !== rejectionRows.length && ` sur ${rejectionRows.length}`}
              {filteredAmount > 0 && (
                <> · <span className="font-semibold text-foreground">{formatCurrency(filteredAmount)}</span></>
              )}
            </p>
          </div>

          {/* Result list */}
          {loading ? (
            <SkeletonTable rows={5} columns={6} />
          ) : filteredRows.length === 0 ? (
            <EmptyState
              variant="card"
              icon={MessageSquareWarning}
              title={rejectionRows.length === 0 ? 'Aucun rejet d’émission' : 'Aucun rejet ne correspond aux filtres'}
              description={
                rejectionRows.length === 0
                  ? 'Les factures émises rejetées ou refusées apparaîtront ici après synchronisation Chorus.'
                  : 'Ajuste ou réinitialise les filtres pour retrouver des résultats.'
              }
              action={
                hasFilters ? (
                  <Button variant="outline" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
                    <X className="mr-1.5 h-3.5 w-3.5" /> Effacer les filtres
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="space-y-2.5">
              {filteredRows.map((invoice) => {
                const supplier = suppliersById.get(invoice.supplierOrganizationId);
                const customer = customersById.get(invoice.publicCustomerId);
                const detailHref = `/invoices/chorus/${encodeURIComponent(invoice.id)}`;
                return (
                  <article
                    key={invoice.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Aperçu rejet d’émission ${invoice.supplierInvoiceNumber}`}
                    onClick={() => {
                      setSelectedInvoice(invoice);
                      setDrawerOpen(true);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedInvoice(invoice);
                        setDrawerOpen(true);
                      }
                    }}
                    className="group relative cursor-pointer overflow-hidden rounded-xl border bg-card p-4 shadow-soft transition-all hover:-translate-y-px hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
                      {/* identity */}
                      <div className="min-w-[200px] flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[15px] font-semibold text-foreground">
                            {invoice.supplierInvoiceNumber}
                          </span>
                          <InvoiceContextBadge context="emission" />
                          <StatusPill status={invoiceStatus(invoice)} />
                        </div>
                        <p className="mt-1 text-[12.5px] text-muted-foreground">
                          {supplier?.legalName || invoice.supplierChorusName || '—'}
                          {supplier?.siret && (
                            <span className="ml-1.5 font-mono text-[11.5px]">· {supplier.siret}</span>
                          )}
                        </p>
                        <p className="text-[12.5px] text-muted-foreground">
                          → {customer?.legalName || invoice.recipientChorusName || '—'}
                          {customer?.codeDestinataire && (
                            <span className="ml-1.5 font-mono text-[11.5px]">· {customer.codeDestinataire}</span>
                          )}
                        </p>
                      </div>

                      {/* reason + suggestion */}
                      <div className="min-w-[260px] max-w-[460px] flex-1 rounded-lg border bg-destructive-soft/40 p-3 text-[12.5px] ring-1 ring-inset ring-destructive/15">
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-destructive">
                          <AlertTriangle className="h-3 w-3" />
                          Motif
                        </div>
                        <p className="mt-1 line-clamp-2 leading-snug text-foreground">
                          {reasonLabelOf(invoice)}
                        </p>
                        <Separator className="my-2 bg-destructive/15" />
                        <p className="line-clamp-2 leading-snug text-muted-foreground">
                          <span className="mr-1 font-semibold text-foreground">💡 Suggéré :</span>
                          {suggestionFor(invoice)}
                        </p>
                      </div>

                      {/* meta + actions */}
                      <div className="ml-auto flex w-full max-w-[200px] flex-col items-end gap-2" onClick={(event) => event.stopPropagation()}>
                        <p className="text-right text-[18px] font-semibold tabular-nums leading-none">
                          {formatCurrency(invoice.totalTtc)}
                        </p>
                        <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          {lastActivity(invoice) ? formatDate(lastActivity(invoice)!) : '—'}
                        </p>
                        <div className="flex flex-wrap justify-end gap-1.5 pt-1">
                          <InvoiceDownloadMenu invoice={invoice} compact />
                          <Button size="sm" variant="outline" asChild className="h-8 px-2.5">
                            <Link to={detailHref} target="_blank" rel="noreferrer">
                              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                              Détail
                            </Link>
                          </Button>
                          <Button size="sm" asChild className="h-8 px-2.5">
                            <Link to="/invoices/new">
                              <ArrowRight className="mr-1 h-3.5 w-3.5" />
                              Resoumettre
                            </Link>
                          </Button>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
      <InvoiceOverviewDrawer
        invoice={selectedDisplayInvoice}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </div>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <Badge variant="secondary" className="gap-1 rounded-full pl-2 pr-1 py-0.5 font-normal">
      {label}
      <button
        type="button"
        onClick={onClear}
        className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full hover:bg-foreground/10"
        aria-label="Retirer ce filtre"
      >
        <X className="h-3 w-3" />
      </button>
    </Badge>
  );
}

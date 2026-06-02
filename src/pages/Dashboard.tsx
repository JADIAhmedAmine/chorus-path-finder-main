import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Euro,
  Filter,
  FileText,
  Inbox,
  Loader2,
  MessageSquareWarning,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { KpiCard } from '@/components/common/KpiCard';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { ApiErrorCard } from '@/components/common/ApiErrorCard';
import { SyncRunProgress, SyncRunSummary } from '@/components/common/SyncRunSummary';
import { DashboardPilotagePanel } from '@/components/chorus/DashboardPilotagePanel';
import {
  getInvoiceChorusStatus,
  isActionableInvoice,
  isPaidChorusStatus,
  isRejectedChorusStatus,
} from '@/lib/chorus/actionableInvoices';
import { loadChorusConfig } from '@/lib/chorus/storage';
import {
  type SyncRunResult,
  useInvoicesQuery,
  usePublicCustomersQuery,
  useSyncInvoicesMutation,
  useSyncSuppliersMutation,
} from '@/lib/queries/db';
import { formatCurrency, formatDate, formatDateTime, getChorusRawStatusConfig } from '@/lib/status-utils';
import type { Invoice } from '@/types';
import { cn } from '@/lib/utils';

const ALL_FILTER_VALUE = '__all__';
const MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat('fr-FR', { month: 'short', year: 'numeric' });

function formatDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getCurrentYearStartDateInput(): string {
  const now = new Date();
  return `${now.getFullYear()}-01-01`;
}

function getTodayDateInput(): string {
  return formatDateInput(new Date());
}

function getLastDaysStartDateInput(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - Math.max(days - 1, 0));
  return formatDateInput(date);
}

function dateOnly(value: string | undefined | null): string | null {
  if (!value) return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? formatDateInput(parsed) : null;
}

function monthKeyFromDate(value: string | undefined | null): string | null {
  const normalized = dateOnly(value);
  return normalized ? normalized.slice(0, 7) : null;
}

function buildMonthKeys(startKey: string, endKey: string): string[] {
  const [startYear, startMonth] = startKey.split('-').map(Number);
  const [endYear, endMonth] = endKey.split('-').map(Number);
  if (!startYear || !startMonth || !endYear || !endMonth) return [];

  const out: string[] = [];
  const cursor = new Date(startYear, startMonth - 1, 1);
  const end = new Date(endYear, endMonth - 1, 1);

  while (cursor <= end) {
    out.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return out;
}

function formatMonthKey(key: string): string {
  const [year, month] = key.split('-').map(Number);
  if (!year || !month) return key;
  return MONTH_LABEL_FORMATTER.format(new Date(year, month - 1, 1));
}

function invoiceMatchesDateRange(invoice: Invoice, fromDate: string, toDate: string): boolean {
  const invoiceDate = dateOnly(invoice.invoiceDate);
  if (!invoiceDate) return false;
  if (fromDate && invoiceDate < fromDate) return false;
  if (toDate && invoiceDate > toDate) return false;
  return true;
}

function parseConfiguredSupplierId(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}

function rawPayload(invoice: Invoice): Record<string, unknown> {
  return typeof invoice.rawPayload === 'object' && invoice.rawPayload !== null && !Array.isArray(invoice.rawPayload)
    ? invoice.rawPayload
    : {};
}

function isReceptionCached(invoice: Invoice): boolean {
  const raw = rawPayload(invoice);
  const classification = raw.receptionClassification;
  const kind = typeof classification === 'object' && classification !== null && !Array.isArray(classification)
    ? (classification as Record<string, unknown>).kind
    : null;
  return !!raw.receptionNormalized || kind === 'FACTURE_RECUE';
}

function isReceptionProcessed(invoice: Invoice): boolean {
  const processing = rawPayload(invoice).receptionProcessing;
  return typeof processing === 'object'
    && processing !== null
    && !Array.isArray(processing)
    && (processing as Record<string, unknown>).processed === true;
}

function isSuspendedStatus(status: string): boolean {
  return status.toUpperCase().includes('SUSPEND');
}

function invoiceActivityDate(invoice: Invoice): string {
  return invoice.lastStatusSyncAt || invoice.statusChangedAt || invoice.updatedAt || invoice.submittedAt || invoice.invoiceDate;
}

function invoiceDisplayNumber(invoice: Invoice): string {
  return invoice.supplierInvoiceNumber || invoice.chorusInvoiceNumber || invoice.id;
}

/** Returns a 12-bucket sparkline of monthly counts matching a predicate. */
function makeSparkline(invoices: Invoice[], predicate: (i: Invoice) => boolean, buckets = 12): number[] {
  const now = new Date();
  const out = Array<number>(buckets).fill(0);
  for (const invoice of invoices) {
    if (!predicate(invoice)) continue;
    const ts = new Date(invoiceActivityDate(invoice));
    if (!Number.isFinite(ts.getTime())) continue;
    const diffMonths = (now.getFullYear() - ts.getFullYear()) * 12 + (now.getMonth() - ts.getMonth());
    if (diffMonths < 0 || diffMonths >= buckets) continue;
    out[buckets - 1 - diffMonths] += 1;
  }
  return out;
}

export default function Dashboard() {
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState(getCurrentYearStartDateInput);
  const [dateTo, setDateTo] = useState(getTodayDateInput);
  const [statusFilter, setStatusFilter] = useState(ALL_FILTER_VALUE);
  const [customerFilter, setCustomerFilter] = useState(ALL_FILTER_VALUE);
  const invoicesQuery = useInvoicesQuery({ pageSize: 500 });
  const customersQuery = usePublicCustomersQuery();
  const syncInvoices = useSyncInvoicesMutation();
  const syncSuppliers = useSyncSuppliersMutation();

  const allInvoices = invoicesQuery.data?.items ?? [];
  const customers = customersQuery.data ?? [];
  const lastSyncRuns: SyncRunResult[] = (syncInvoices.data ?? []) as SyncRunResult[];
  const loading = invoicesQuery.isLoading || customersQuery.isLoading;
  const syncing = syncInvoices.isPending || syncSuppliers.isPending;
  const error = syncError || invoicesQuery.error?.message || customersQuery.error?.message || null;

  const customerById = useMemo(
    () => new Map(customers.map((customer) => [customer.id, customer])),
    [customers],
  );

  const statusOptions = useMemo(
    () => [...new Set(allInvoices.map(getInvoiceChorusStatus).filter((status): status is string => Boolean(status)))]
      .sort((left, right) =>
        getChorusRawStatusConfig(left).label.localeCompare(getChorusRawStatusConfig(right).label, 'fr'),
      ),
    [allInvoices],
  );

  const customerOptions = useMemo(() => {
    const ids = [...new Set(allInvoices.map((invoice) => invoice.publicCustomerId).filter(Boolean))];
    return ids
      .map((id) => ({
        id,
        label: customerById.get(id)?.legalName || id,
      }))
      .sort((left, right) => left.label.localeCompare(right.label, 'fr'));
  }, [allInvoices, customerById]);

  const invoices = useMemo(
    () => allInvoices.filter((invoice) =>
      invoiceMatchesDateRange(invoice, dateFrom, dateTo)
      && (statusFilter === ALL_FILTER_VALUE || getInvoiceChorusStatus(invoice) === statusFilter)
      && (customerFilter === ALL_FILTER_VALUE || invoice.publicCustomerId === customerFilter),
    ),
    [allInvoices, customerFilter, dateFrom, dateTo, statusFilter],
  );

  const activeSecondaryFilters = [
    statusFilter !== ALL_FILTER_VALUE,
    customerFilter !== ALL_FILTER_VALUE,
  ].filter(Boolean).length;

  const periodLabel = dateFrom || dateTo
    ? `${dateFrom ? formatDate(dateFrom) : 'début'} -> ${dateTo ? formatDate(dateTo) : 'aujourd’hui'}`
    : 'Toutes les dates';

  function applyCurrentYearPeriod() {
    setDateFrom(getCurrentYearStartDateInput());
    setDateTo(getTodayDateInput());
  }

  function applyLast30DaysPeriod() {
    setDateFrom(getLastDaysStartDateInput(30));
    setDateTo(getTodayDateInput());
  }

  function clearPeriod() {
    setDateFrom('');
    setDateTo('');
  }

  function resetFilters() {
    applyCurrentYearPeriod();
    setStatusFilter(ALL_FILTER_VALUE);
    setCustomerFilter(ALL_FILTER_VALUE);
  }

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
        console.warn('[dashboard] sync suppliers skipped', supplierSyncError);
      });
      const runs = await syncInvoices.mutateAsync({ ...syncInput, mode: 'full' });
      const lastRun = runs[runs.length - 1];
      if (lastRun) {
        setLastSyncAt(lastRun.finishedAt || lastRun.startedAt);
      }
      await invoicesQuery.refetch();
    } catch (refreshError) {
      setSyncError(
        refreshError instanceof Error
          ? refreshError.message
          : 'Synchronisation Chorus impossible.',
      );
    }
  }

  const totals = useMemo(() => {
    const total = invoices.length;
    const paid = invoices.filter((i) => isPaidChorusStatus(getInvoiceChorusStatus(i))).length;
    const rejected = invoices.filter((i) => isRejectedChorusStatus(getInvoiceChorusStatus(i)));
    const suspended = invoices.filter((i) => isSuspendedStatus(getInvoiceChorusStatus(i))).length;
    const actionable = invoices.filter((i) => isActionableInvoice(i));
    const totalTtc = invoices.reduce((s, i) => s + i.totalTtc, 0);
    const successRate = total > 0 ? Math.round((paid / total) * 100) : 0;
    return {
      total,
      paid,
      rejected: rejected.length,
      rejectedAmount: rejected.reduce((s, i) => s + i.totalTtc, 0),
      suspended,
      actionable: actionable.length,
      actionableAmount: actionable.reduce((s, i) => s + i.totalTtc, 0),
      totalTtc,
      successRate,
    };
  }, [invoices]);

  const sparklines = useMemo(() => ({
    total: makeSparkline(invoices, () => true),
    paid: makeSparkline(invoices, (i) => isPaidChorusStatus(getInvoiceChorusStatus(i))),
    rejected: makeSparkline(invoices, (i) => isRejectedChorusStatus(getInvoiceChorusStatus(i))),
    suspended: makeSparkline(invoices, (i) => isSuspendedStatus(getInvoiceChorusStatus(i))),
  }), [invoices]);

  const operationalStats = useMemo(() => {
    const receptionInvoices = invoices.filter(isReceptionCached);
    const receptionOpen = receptionInvoices.filter((invoice) =>
      !isReceptionProcessed(invoice)
      && !isRejectedChorusStatus(getInvoiceChorusStatus(invoice)),
    ).length;
    const suspended = receptionInvoices.filter((invoice) => isSuspendedStatus(getInvoiceChorusStatus(invoice))).length;
    const processed = invoices.filter(isReceptionProcessed).length;
    const rejected = invoices.filter((invoice) => isRejectedChorusStatus(getInvoiceChorusStatus(invoice)));
    const corrections = invoices.filter(isActionableInvoice);
    const paid = invoices.filter((invoice) => isPaidChorusStatus(getInvoiceChorusStatus(invoice))).length;

    return [
      {
        label: 'Réception non traitée',
        value: receptionOpen,
        description: 'Factures reçues encore visibles côté réception.',
        href: '/invoices/reception',
      },
      {
        label: 'Suspendues',
        value: suspended,
        description: 'Complément attendu : commentaire ou pièce jointe.',
        href: '/invoices/reception',
      },
      {
        label: 'Rejets / refus émission',
        value: rejected.length,
        description: `${formatCurrency(rejected.reduce((sum, invoice) => sum + invoice.totalTtc, 0))} à analyser.`,
        href: '/invoices/rejections',
      },
      {
        label: 'Émissions à traiter',
        value: corrections.length,
        description: `${formatCurrency(corrections.reduce((sum, invoice) => sum + invoice.totalTtc, 0))} hors rejets/refus.`,
        href: '/invoices/to-process',
      },
      {
        label: 'Réception traitée',
        value: processed,
        description: 'Actions explicitement réalisées depuis Chorus Pilot.',
        href: '/invoices/reception/processed',
      },
      {
        label: 'Payées / paiement',
        value: paid,
        description: 'Factures avec statut Chorus de paiement.',
        href: '/invoices',
      },
    ];
  }, [invoices]);

  const topStatuses = useMemo(() => {
    const buckets = new Map<string, { count: number; amount: number }>();
    for (const invoice of invoices) {
      const status = getInvoiceChorusStatus(invoice) || 'INCONNU';
      const current = buckets.get(status) ?? { count: 0, amount: 0 };
      current.count += 1;
      current.amount += invoice.totalTtc;
      buckets.set(status, current);
    }
    return [...buckets.entries()]
      .sort((left, right) => right[1].count - left[1].count || right[1].amount - left[1].amount)
      .slice(0, 5)
      .map(([status, data]) => ({
        status,
        ...data,
        config: getChorusRawStatusConfig(status),
      }));
  }, [invoices]);

  const statusPieData = useMemo(() => topStatuses.map((item) => ({
    name: item.config.label,
    value: item.count,
    color: item.config.color,
  })), [topStatuses]);

  const topCustomers = useMemo(() => {
    const buckets = new Map<string, { count: number; amount: number; label: string }>();
    for (const invoice of invoices) {
      const key = invoice.publicCustomerId || invoice.recipientChorusCode || invoice.recipientChorusName || 'unknown';
      const current = buckets.get(key) ?? {
        count: 0,
        amount: 0,
        label: customerById.get(invoice.publicCustomerId)?.legalName
          || invoice.recipientChorusName
          || invoice.recipientChorusCode
          || 'Destinataire inconnu',
      };
      current.count += 1;
      current.amount += invoice.totalTtc;
      buckets.set(key, current);
    }
    return [...buckets.entries()]
      .map(([id, data]) => ({ id, ...data }))
      .sort((left, right) => right.amount - left.amount)
      .slice(0, 5);
  }, [customerById, invoices]);

  const recentActivity = useMemo(
    () => [...invoices]
      .sort((left, right) =>
        new Date(invoiceActivityDate(right)).getTime() - new Date(invoiceActivityDate(left)).getTime(),
      )
      .slice(0, 6),
    [invoices],
  );

  const monthlyActivity = useMemo(() => {
    const buckets = new Map<string, { count: number; amount: number }>();
    for (const invoice of invoices) {
      const key = monthKeyFromDate(invoice.invoiceDate);
      if (!key) continue;
      const current = buckets.get(key) ?? { count: 0, amount: 0 };
      current.count += 1;
      current.amount += invoice.totalTtc;
      buckets.set(key, current);
    }

    const populatedKeys = [...buckets.keys()].sort();
    const fromKey = monthKeyFromDate(dateFrom);
    const toKey = monthKeyFromDate(dateTo);
    const startKey = fromKey ?? populatedKeys[0] ?? toKey;
    const endKey = toKey ?? populatedKeys[populatedKeys.length - 1] ?? fromKey;
    if (!startKey || !endKey || startKey > endKey) return [];

    return buildMonthKeys(startKey, endKey).map((key) => {
      const value = buckets.get(key) ?? { count: 0, amount: 0 };
      return {
        key,
        month: formatMonthKey(key),
        count: value.count,
        amount: value.amount,
      };
    });
  }, [dateFrom, dateTo, invoices]);

  const alerts = useMemo(() => {
    const items: Array<{
      id: string;
      tone: 'danger' | 'warning' | 'info';
      title: string;
      description: string;
      href: string;
      cta: string;
    }> = [];
    if (totals.rejected > 0) {
      items.push({
        id: 'rejected',
        tone: 'danger',
        title: `${totals.rejected} facture${totals.rejected > 1 ? 's' : ''} refusée${totals.rejected > 1 ? 's' : ''}`,
        description: `${formatCurrency(totals.rejectedAmount)} à analyser et corriger.`,
        href: '/invoices/rejections',
        cta: 'Analyser',
      });
    }
    if (totals.suspended > 0) {
      items.push({
        id: 'suspended',
        tone: 'warning',
        title: `${totals.suspended} facture${totals.suspended > 1 ? 's' : ''} suspendue${totals.suspended > 1 ? 's' : ''}`,
        description: 'Complément attendu pour reprendre le workflow Chorus.',
        href: '/invoices/reception',
        cta: 'Compléter',
      });
    }
    if (totals.actionable > 0) {
      items.push({
        id: 'actionable',
        tone: 'info',
        title: `${totals.actionable} émission${totals.actionable > 1 ? 's' : ''} à traiter`,
        description: `${formatCurrency(totals.actionableAmount)} hors rejets/refus.`,
        href: '/invoices/to-process',
        cta: 'Traiter',
      });
    }
    return items;
  }, [totals]);

  const featureCards = [
    {
      title: 'Réception',
      description: 'Consulter les factures reçues, ouvrir les PDF/XML et traiter uniquement les factures actionnables.',
      href: '/invoices/reception',
      icon: Inbox,
      badge: 'Factures reçues',
    },
    {
      title: 'Émission',
      description: 'Suivre les factures déposées ou synchronisées depuis Chorus Pro.',
      href: '/invoices',
      icon: Send,
      badge: 'Suivi',
    },
    {
      title: 'Rejets / refus',
      description: 'Analyser les rejets issus du suivi des émissions sans les mélanger avec la réception.',
      href: '/invoices/rejections',
      icon: MessageSquareWarning,
      badge: 'Analyse',
    },
    {
      title: 'Nouvelle émission',
      description: 'Préparer une facture, joindre les documents et lancer la soumission Chorus.',
      href: '/invoices/new',
      icon: Plus,
      badge: 'Action',
    },
  ];

  return (
    <div className="space-y-7 animate-fade-in">
      <PageHeader
        eyebrow={
          <>
            <Sparkles className="h-3 w-3" />
            Chorus Pilot · cockpit
          </>
        }
        title="Tableau de bord"
        description="Vue unifiée : réception des factures, suivi des émissions, rejets/refus et nouvelles soumissions. Les actions métier restent dans les pages dédiées."
        meta={
          loading
            ? 'Chargement depuis la base locale…'
            : lastSyncAt
              ? <span className="inline-flex items-center gap-1.5"><span className="live-dot" />Dernière sync Chorus : {formatDateTime(lastSyncAt)}</span>
              : 'Données depuis le cache local.'
        }
        actions={
          <>
            <Button variant="outline" onClick={handleRefresh} disabled={syncing || loading}>
              {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Actualiser Chorus
            </Button>
            <Button asChild>
              <Link to="/invoices/new">
                <Plus className="mr-2 h-4 w-4" />
                Nouvelle émission
              </Link>
            </Button>
          </>
        }
      />

      {error && (
        <ApiErrorCard
          severity="error"
          title="Synchronisation Chorus indisponible"
          explanation="Les données affichées proviennent du dernier cache local. Vérifie ta connexion ou la configuration PISTE."
          suggestion="Ouvre les paramètres pour contrôler les clés API et l'environnement (sandbox ou production)."
          technicalDetails={error}
          onRetry={handleRefresh}
        />
      )}

      {syncing && <SyncRunProgress />}
      {lastSyncRuns.length > 0 && <SyncRunSummary runs={lastSyncRuns} />}

      <Card className="card-elevated">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-[15px]">
                <Filter className="h-4 w-4 text-primary" />
                Filtres du tableau de bord
              </CardTitle>
              <CardDescription className="text-[12.5px]">
                Période affichée : {periodLabel}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                {loading ? 'Chargement...' : `${invoices.length.toLocaleString('fr-FR')} / ${allInvoices.length.toLocaleString('fr-FR')} factures`}
              </Badge>
              {activeSecondaryFilters > 0 && (
                <Badge variant="outline">{activeSecondaryFilters} filtre{activeSecondaryFilters > 1 ? 's' : ''} actif{activeSecondaryFilters > 1 ? 's' : ''}</Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="dashboard-date-from" className="text-[11.5px] text-muted-foreground">Du</Label>
              <Input
                id="dashboard-date-from"
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dashboard-date-to" className="text-[11.5px] text-muted-foreground">Au</Label>
              <Input
                id="dashboard-date-to"
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dashboard-status-filter" className="text-[11.5px] text-muted-foreground">Statut Chorus</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger id="dashboard-status-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER_VALUE}>Tous les statuts</SelectItem>
                  {statusOptions.map((status) => (
                    <SelectItem key={status} value={status}>
                      {getChorusRawStatusConfig(status).label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dashboard-customer-filter" className="text-[11.5px] text-muted-foreground">Destinataire</Label>
              <Select value={customerFilter} onValueChange={setCustomerFilter}>
                <SelectTrigger id="dashboard-customer-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER_VALUE}>Tous les destinataires</SelectItem>
                  {customerOptions.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>
                      {customer.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap items-end gap-2 lg:justify-end">
              <Button variant="outline" size="sm" onClick={applyCurrentYearPeriod}>
                <CalendarDays className="mr-1.5 h-3.5 w-3.5" />
                Année en cours
              </Button>
              <Button variant="outline" size="sm" onClick={applyLast30DaysPeriod}>
                30 jours
              </Button>
              <Button variant="outline" size="sm" onClick={clearPeriod}>
                Tout
              </Button>
              <Button variant="ghost" size="icon" onClick={resetFilters} aria-label="Réinitialiser les filtres">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPI strip */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5 stagger-children">
        <KpiCard
          label="Total factures"
          value={loading ? '—' : totals.total.toLocaleString('fr-FR')}
          hint="Cache Chorus synchronisé"
          icon={FileText}
          tone="primary"
          sparkline={sparklines.total}
          loading={loading}
          href="/invoices"
        />
        <KpiCard
          label="Montant TTC cumulé"
          value={loading ? '—' : formatCurrency(totals.totalTtc)}
          hint="Toutes factures confondues"
          icon={Euro}
          tone="info"
          loading={loading}
        />
        <KpiCard
          label="Taux de succès"
          value={loading ? '—' : `${totals.successRate}%`}
          hint={`${totals.paid} factures payées`}
          icon={CheckCircle2}
          tone="success"
          sparkline={sparklines.paid}
          loading={loading}
        />
        <KpiCard
          label="Rejets / refus"
          value={loading ? '—' : totals.rejected.toLocaleString('fr-FR')}
          hint={formatCurrency(totals.rejectedAmount)}
          icon={MessageSquareWarning}
          tone="danger"
          sparkline={sparklines.rejected}
          loading={loading}
          href="/invoices/rejections"
        />
        <KpiCard
          label="Suspendues"
          value={loading ? '—' : totals.suspended.toLocaleString('fr-FR')}
          hint="Complément attendu"
          icon={AlertTriangle}
          tone="warning"
          sparkline={sparklines.suspended}
          loading={loading}
          href="/invoices/reception"
        />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">Pilotage opérationnel</h2>
          <p className="text-[12.5px] text-muted-foreground">
            Synthèse agrégée calculée sur la période sélectionnée.
          </p>
        </div>
        <DashboardPilotagePanel fromDate={dateFrom || undefined} toDate={dateTo || undefined} />
      </section>

      {/* Alerts + Activity */}
      {(alerts.length > 0 || recentActivity.length > 0) && (
        <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
          <Card className="card-elevated">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-[15px]">Alertes à traiter</CardTitle>
                  <CardDescription className="text-[12.5px]">Les actions prioritaires détectées dans Chorus.</CardDescription>
                </div>
                {alerts.length > 0 && (
                  <Badge variant="outline" className="border-destructive/30 bg-destructive-soft text-destructive">
                    {alerts.length} alerte{alerts.length > 1 ? 's' : ''}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {alerts.length === 0 ? (
                <EmptyState
                  icon={CheckCircle2}
                  title="Aucune alerte active"
                  description="Toutes les factures Chorus sont à jour. Continue comme ça."
                />
              ) : (
                <div className="space-y-2.5">
                  {alerts.map((alert) => {
                    const toneStyles =
                      alert.tone === 'danger'
                        ? 'border-destructive/25 bg-destructive-soft/60'
                        : alert.tone === 'warning'
                          ? 'border-warning/25 bg-warning-soft/60'
                          : 'border-info/25 bg-info-soft/60';
                    const iconColor =
                      alert.tone === 'danger' ? 'text-destructive' : alert.tone === 'warning' ? 'text-warning' : 'text-info';
                    return (
                      <Link
                        key={alert.id}
                        to={alert.href}
                        className={cn(
                          'group flex items-start gap-3 rounded-xl border p-3.5 transition-all hover:-translate-y-px hover:shadow-soft',
                          toneStyles,
                        )}
                      >
                        <div className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-card shadow-soft', iconColor)}>
                          <AlertTriangle className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13.5px] font-semibold text-foreground">{alert.title}</p>
                          <p className="mt-0.5 text-[12.5px] leading-5 text-muted-foreground">{alert.description}</p>
                        </div>
                        <span className="ml-2 inline-flex shrink-0 items-center gap-1 self-center rounded-md border bg-card px-2 py-1 text-[12px] font-medium text-foreground shadow-soft transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                          {alert.cta}
                          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="card-elevated">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-[15px]">Activité récente</CardTitle>
                  <CardDescription className="text-[12.5px]">Les derniers mouvements Chorus synchronisés.</CardDescription>
                </div>
                <Clock3 className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {recentActivity.length === 0 ? (
                <EmptyState icon={Clock3} title="Aucune activité récente" description="Lance une synchronisation Chorus pour récupérer les derniers événements." />
              ) : (
                <ol className="-mt-1 space-y-0.5">
                  {recentActivity.map((invoice) => {
                    const status = getInvoiceChorusStatus(invoice) || 'INCONNU';
                    const config = getChorusRawStatusConfig(status);
                    return (
                      <li key={invoice.id}>
                        <Link
                          to={`/invoices/chorus/${encodeURIComponent(invoice.id)}`}
                          className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/50"
                        >
                          <span
                            className="mt-0.5 h-2 w-2 shrink-0 rounded-full ring-4 ring-card"
                            style={{ backgroundColor: config.color }}
                            aria-hidden
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-medium text-foreground">
                              {invoiceDisplayNumber(invoice)}
                            </p>
                            <p className="truncate text-[11.5px] text-muted-foreground">
                              {config.label} · {formatCurrency(invoice.totalTtc)}
                            </p>
                          </div>
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {formatDate(invoiceActivityDate(invoice))}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {/* Charts row */}
      <section className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Card className="card-elevated">
          <CardHeader className="pb-2">
            <div>
              <CardTitle className="text-[15px]">Évolution mensuelle (nombre + montant TTC)</CardTitle>
              <CardDescription className="text-[12.5px]">Nombre de factures et montant TTC par mois sur la période filtrée.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {monthlyActivity.length > 0 ? (
              <div className="h-[340px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={monthlyActivity} margin={{ top: 14, right: 24, left: 8, bottom: 6 }} barCategoryGap="24%">
                    <defs>
                      <linearGradient id="barFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.95} />
                        <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0.55} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis
                      dataKey="month"
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickLine={false}
                      axisLine={{ stroke: 'hsl(var(--border))' }}
                    />
                    <YAxis
                      yAxisId="left"
                      allowDecimals={false}
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickLine={false}
                      axisLine={{ stroke: 'hsl(var(--border))' }}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      width={112}
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickLine={false}
                      axisLine={{ stroke: 'hsl(var(--border))' }}
                      tickFormatter={(value) => formatCurrency(Number(value))}
                    />
                    <Tooltip
                      cursor={{ fill: 'hsl(var(--muted) / 0.4)' }}
                      contentStyle={{
                        borderRadius: 10,
                        border: '1px solid hsl(var(--border))',
                        boxShadow: 'var(--shadow-lifted)',
                        fontSize: 12,
                      }}
                      formatter={(value, name, item) => {
                        const isAmount = item?.dataKey === 'amount' || name === 'Montant TTC';
                        return isAmount
                          ? [formatCurrency(Number(value)), 'Montant TTC']
                          : [`${value} facture(s)`, 'Factures'];
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar yAxisId="left" dataKey="count" name="Factures" fill="url(#barFill)" maxBarSize={72} radius={[6, 6, 0, 0]} />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="amount"
                      name="Montant TTC"
                      stroke="hsl(var(--chart-3))"
                      strokeWidth={2.5}
                      dot={{ r: 4, strokeWidth: 2, stroke: 'hsl(var(--chart-3))', fill: 'hsl(var(--card))' }}
                      activeDot={{ r: 5, strokeWidth: 2, stroke: 'hsl(var(--chart-3))', fill: 'hsl(var(--card))' }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState
                icon={FileText}
                title="Pas encore d'historique"
                description="Lance une synchronisation Chorus pour faire apparaître la courbe d'évolution."
              />
            )}
          </CardContent>
        </Card>

        <Card className="card-elevated">
          <CardHeader className="pb-2">
            <CardTitle className="text-[15px]">Répartition par statut Chorus</CardTitle>
            <CardDescription className="text-[12.5px]">Top 5 des statuts en volume.</CardDescription>
          </CardHeader>
          <CardContent>
            {statusPieData.length > 0 ? (
              <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-[180px_1fr]">
                <div className="relative h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={statusPieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={56}
                        outerRadius={82}
                        dataKey="value"
                        stroke="hsl(var(--card))"
                        strokeWidth={3}
                        paddingAngle={2}
                      >
                        {statusPieData.map((item) => (
                          <Cell key={item.name} fill={item.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          borderRadius: 10,
                          border: '1px solid hsl(var(--border))',
                          boxShadow: 'var(--shadow-lifted)',
                          fontSize: 12,
                        }}
                        formatter={(value) => [`${value} facture(s)`, 'Factures']}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-semibold tabular-nums">{totals.total.toLocaleString('fr-FR')}</span>
                    <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Factures</span>
                  </div>
                </div>
                <ul className="space-y-2 text-[12.5px]">
                  {statusPieData.map((item) => {
                    const pct = totals.total > 0 ? Math.round((item.value / totals.total) * 100) : 0;
                    return (
                      <li key={item.name} className="flex items-center gap-2.5">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: item.color }} />
                        <span className="min-w-0 flex-1 truncate text-foreground">{item.name}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">{item.value}</span>
                        <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground/80">{pct}%</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <EmptyState icon={FileText} title="Aucun statut Chorus chargé" />
            )}
          </CardContent>
        </Card>
      </section>

      {/* Operational stats + Top customers */}
      <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="card-elevated">
          <CardHeader className="pb-3">
            <CardTitle className="text-[15px]">Statistiques utiles</CardTitle>
            <CardDescription className="text-[12.5px]">Chiffres opérationnels pour savoir quoi traiter, analyser, ou suivre.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {operationalStats.map((stat) => (
                <Link
                  key={stat.label}
                  to={stat.href}
                  className="group rounded-xl border bg-card p-3.5 transition-all hover:-translate-y-px hover:border-primary/40 hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {stat.label}
                  </p>
                  <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
                    {loading ? '—' : stat.value}
                  </p>
                  <p className="mt-1.5 min-h-[36px] text-[12px] leading-5 text-muted-foreground">
                    {loading ? 'Chargement…' : stat.description}
                  </p>
                  <span className="mt-2 inline-flex items-center text-[11.5px] font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                    Ouvrir <ArrowRight className="ml-1 h-3 w-3" />
                  </span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="card-elevated">
          <CardHeader className="pb-3">
            <CardTitle className="text-[15px]">Top destinataires</CardTitle>
            <CardDescription className="text-[12.5px]">Clients publics avec le plus de volume facturé.</CardDescription>
          </CardHeader>
          <CardContent>
            {topCustomers.length === 0 ? (
              <EmptyState icon={Inbox} title="Aucun destinataire" />
            ) : (
              <div className="space-y-3.5">
                {topCustomers.map((customer, idx) => {
                  const max = topCustomers[0]?.amount ?? 0;
                  const ratio = max > 0 ? Math.max(6, Math.min(100, (customer.amount / max) * 100)) : 0;
                  return (
                    <div key={customer.id} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3 text-[13px]">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-muted text-[10.5px] font-semibold text-muted-foreground">
                            {idx + 1}
                          </span>
                          <span className="truncate font-medium text-foreground" title={customer.label}>{customer.label}</span>
                        </span>
                        <span className="shrink-0 tabular-nums font-semibold">{formatCurrency(customer.amount)}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-primary to-[hsl(262_83%_58%)]"
                          style={{ width: `${ratio}%` }}
                        />
                      </div>
                      <div className="text-[11px] text-muted-foreground">{customer.count} facture{customer.count > 1 ? 's' : ''}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Feature cards (navigation) */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-foreground">Fonctionnalités principales</h2>
            <p className="text-[12.5px] text-muted-foreground">
              Réception et émission séparées pour éviter toute confusion entre factures reçues, rejets et actions de correction.
            </p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {featureCards.map((feature) => (
            <Link
              key={feature.href}
              to={feature.href}
              className="group relative overflow-hidden rounded-xl border bg-card p-5 shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-gradient-to-br from-primary/10 to-transparent blur-2xl transition-opacity group-hover:opacity-100" />
              <div className="relative flex items-start justify-between gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <feature.icon className="h-5 w-5" />
                </div>
                <Badge variant="secondary" className="font-medium">{feature.badge}</Badge>
              </div>
              <h3 className="relative mt-4 text-[14.5px] font-semibold text-foreground">{feature.title}</h3>
              <p className="relative mt-1.5 min-h-[54px] text-[12.5px] leading-5 text-muted-foreground">
                {feature.description}
              </p>
              <span className="relative mt-3 inline-flex items-center text-[12.5px] font-medium text-primary">
                Ouvrir
                <ArrowRight className="ml-1 h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Empty global state */}
      {!loading && invoices.length === 0 && !error && (
        <EmptyState
          variant="card"
          icon={Inbox}
          title="Aucune facture en cache local"
          description="Lance une synchronisation Chorus pour alimenter les vues, ou crée une nouvelle émission de facture."
          action={
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleRefresh} disabled={syncing}>
                {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Synchroniser
              </Button>
              <Button asChild>
                <Link to="/invoices/new">
                  <Plus className="mr-2 h-4 w-4" />
                  Nouvelle émission
                </Link>
              </Button>
            </div>
          }
        />
      )}
    </div>
  );
}

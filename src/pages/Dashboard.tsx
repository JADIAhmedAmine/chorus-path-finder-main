import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Euro,
  FileText,
  Inbox,
  Loader2,
  MessageSquareWarning,
  Plus,
  RefreshCw,
  Send,
} from 'lucide-react';
import {
  Bar,
  BarChart,
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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SyncRunProgress, SyncRunSummary } from '@/components/common/SyncRunSummary';
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

export default function Dashboard() {
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const invoicesQuery = useInvoicesQuery({ pageSize: 500 });
  const customersQuery = usePublicCustomersQuery();
  const syncInvoices = useSyncInvoicesMutation();
  const syncSuppliers = useSyncSuppliersMutation();

  const invoices = invoicesQuery.data?.items ?? [];
  const customers = customersQuery.data ?? [];
  const lastSyncRuns: SyncRunResult[] = (syncInvoices.data ?? []) as SyncRunResult[];
  const loading = invoicesQuery.isLoading || customersQuery.isLoading;
  const syncing = syncInvoices.isPending || syncSuppliers.isPending;
  const error = syncError || invoicesQuery.error?.message || customersQuery.error?.message || null;

  const customerById = useMemo(
    () => new Map(customers.map((customer) => [customer.id, customer])),
    [customers],
  );

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

  const stats = useMemo(() => {
    const correctionCount = invoices.filter((invoice) => isActionableInvoice(invoice)).length;
    const totalTtc = invoices.reduce((sum, invoice) => sum + invoice.totalTtc, 0);
    const averageTtc = invoices.length > 0 ? totalTtc / invoices.length : 0;
    const paidCount = invoices.filter((invoice) => isPaidChorusStatus(getInvoiceChorusStatus(invoice))).length;

    return [
      {
        label: 'Total factures',
        value: invoices.length,
        hint: 'Cache DB Chorus',
        icon: FileText,
        tone: 'text-foreground',
      },
      {
        label: 'Montant TTC cumulé',
        value: formatCurrency(totalTtc),
        hint: 'Toutes factures synchronisées',
        icon: Euro,
        tone: 'text-sky-700',
      },
      {
        label: 'Montant moyen',
        value: formatCurrency(averageTtc),
        hint: 'Par facture',
        icon: Send,
        tone: 'text-primary',
      },
      {
        label: 'Paiement / payées',
        value: paidCount,
        hint: 'Statuts paiement Chorus',
        icon: CheckCircle2,
        tone: 'text-emerald-700',
      },
      {
        label: 'Émissions à traiter',
        value: correctionCount,
        hint: 'Hors rejets/refus',
        icon: AlertTriangle,
        tone: 'text-amber-600',
      },
    ];
  }, [invoices]);

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

  const amountPieData = useMemo(() => topStatuses.map((item) => ({
    name: item.config.label,
    value: item.amount,
    count: item.count,
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
      .slice(0, 5),
    [invoices],
  );

  const monthlyActivity = useMemo(() => {
    const buckets = new Map<string, { count: number; amount: number; timestamp: number }>();
    for (const invoice of invoices) {
      const parsed = new Date(invoiceActivityDate(invoice));
      const timestamp = parsed.getTime();
      if (!Number.isFinite(timestamp)) continue;
      const key = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`;
      const current = buckets.get(key) ?? { count: 0, amount: 0, timestamp };
      current.count += 1;
      current.amount += invoice.totalTtc;
      buckets.set(key, current);
    }

    return [...buckets.entries()]
      .sort((left, right) => left[1].timestamp - right[1].timestamp)
      .slice(-6)
      .map(([key, value]) => ({
        key,
        month: new Date(`${key}-01T00:00:00`).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }),
        count: value.count,
        amount: value.amount,
      }));
  }, [invoices]);

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
    <div className="space-y-6 animate-fade-in">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">Tableau de bord</h1>
            <Badge variant="outline">Chorus Pilot</Badge>
          </div>
          <p className="text-sm leading-6 text-muted-foreground">
            Vue simple pour savoir où aller : réception des factures, suivi des émissions,
            rejets/refus et nouvelles soumissions. Les actions métier restent dans les pages dédiées.
          </p>
          <p className="text-xs text-muted-foreground">
            {loading
              ? 'Chargement depuis la base locale...'
              : lastSyncAt
                ? `Dernière sync Chorus : ${formatDateTime(lastSyncAt)}`
                : 'Données depuis le cache local.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
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
        </div>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {syncing && <SyncRunProgress />}
      {lastSyncRuns.length > 0 && <SyncRunSummary runs={lastSyncRuns} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="pt-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  <p className={`mt-2 text-3xl font-semibold tabular-nums ${stat.tone}`}>
                    {loading ? '...' : stat.value}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{loading ? 'Chargement...' : stat.hint}</p>
                </div>
                <stat.icon className={`h-7 w-7 ${stat.tone}`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Répartition par statut Chorus</CardTitle>
            <CardDescription>Volume de factures par statut.</CardDescription>
          </CardHeader>
          <CardContent>
            {statusPieData.length > 0 ? (
              <>
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={statusPieData} cx="50%" cy="50%" innerRadius={58} outerRadius={92} dataKey="value" stroke="none">
                        {statusPieData.map((item) => (
                          <Cell key={item.name} fill={item.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => [`${value} facture(s)`, 'Factures']} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 flex flex-wrap justify-center gap-3 text-xs">
                  {statusPieData.map((item) => (
                    <div key={item.name} className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                      {item.name} ({item.value})
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">
                Aucun statut Chorus chargé.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Montant TTC par statut Chorus</CardTitle>
            <CardDescription>Poids financier par statut.</CardDescription>
          </CardHeader>
          <CardContent>
            {amountPieData.length > 0 ? (
              <>
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={amountPieData} cx="50%" cy="50%" innerRadius={58} outerRadius={92} dataKey="value" stroke="none">
                        {amountPieData.map((item) => (
                          <Cell key={item.name} fill={item.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => [formatCurrency(Number(value)), 'Montant TTC']} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 flex flex-wrap justify-center gap-3 text-xs">
                  {amountPieData.map((item) => (
                    <div key={item.name} className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                      {item.name} ({formatCurrency(item.value)})
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">
                Aucun montant Chorus chargé.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top 5 destinataires par montant</CardTitle>
            <CardDescription>Les clients publics les plus représentés.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {topCustomers.map((customer) => {
                const maxAmount = topCustomers[0]?.amount ?? 0;
                const ratio = maxAmount > 0 ? Math.max(4, Math.min(100, (customer.amount / maxAmount) * 100)) : 0;
                return (
                  <div key={customer.id} className="space-y-1">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate" title={customer.label}>{customer.label}</span>
                      <span className="shrink-0 font-medium">{formatCurrency(customer.amount)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${ratio}%` }} />
                    </div>
                    <div className="text-xs text-muted-foreground">{customer.count} facture(s)</div>
                  </div>
                );
              })}
              {topCustomers.length === 0 && (
                <p className="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">
                  Aucun destinataire dans le cache.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Évolution mensuelle (nombre + montant TTC)</CardTitle>
          <CardDescription>Volume de factures et valeur TTC synchronisée par mois.</CardDescription>
        </CardHeader>
        <CardContent>
          {monthlyActivity.length > 0 ? (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={monthlyActivity}>
                  <XAxis dataKey="month" />
                  <YAxis yAxisId="left" allowDecimals={false} />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    width={100}
                    tickFormatter={(value) => formatCurrency(Number(value))}
                  />
                  <Tooltip
                    formatter={(value, name, item) => {
                      const isAmount = item?.dataKey === 'amount' || name === 'Montant TTC';
                      return isAmount
                        ? [formatCurrency(Number(value)), 'Montant TTC']
                        : [`${value} facture(s)`, 'Factures'];
                    }}
                  />
                  <Legend />
                  <Bar yAxisId="left" dataKey="count" name="Factures" fill="hsl(220, 60%, 60%)" radius={[4, 4, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="amount" name="Montant TTC" stroke="hsl(160, 70%, 35%)" strokeWidth={2} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">
              Aucune donnée mensuelle exploitable.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Statistiques utiles</CardTitle>
            <CardDescription>
              Les chiffres utiles pour savoir quoi traiter, quoi analyser et ce qui est déjà fait.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {operationalStats.map((stat) => (
                <Link
                  key={stat.label}
                  to={stat.href}
                  className="rounded-md border bg-muted/20 p-3 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{stat.label}</p>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">{loading ? '...' : stat.value}</p>
                  <p className="mt-1 min-h-[36px] text-xs leading-5 text-muted-foreground">
                    {loading ? 'Chargement...' : stat.description}
                  </p>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Statuts & activité</CardTitle>
            <CardDescription>Un résumé court des derniers mouvements Chorus.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Euro className="h-4 w-4 text-primary" />
                Statuts principaux
              </div>
              <div className="space-y-2">
                {topStatuses.map((item) => (
                  <div key={item.status} className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.config.color }} />
                        <span className="truncate">{item.config.label}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{formatCurrency(item.amount)}</p>
                    </div>
                    <span className="shrink-0 font-semibold tabular-nums">{item.count}</span>
                  </div>
                ))}
                {topStatuses.length === 0 && (
                  <p className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
                    Aucun statut Chorus chargé.
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Clock3 className="h-4 w-4 text-primary" />
                Dernières activités
              </div>
              <div className="space-y-2">
                {recentActivity.map((invoice) => (
                  <Link
                    key={invoice.id}
                    to={`/invoices/chorus/${encodeURIComponent(invoice.id)}`}
                    className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2 text-sm transition-colors hover:bg-muted/40"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{invoiceDisplayNumber(invoice)}</p>
                      <p className="text-xs text-muted-foreground">{getInvoiceChorusStatus(invoice) || 'Statut inconnu'}</p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDate(invoiceActivityDate(invoice))}
                    </span>
                  </Link>
                ))}
                {recentActivity.length === 0 && (
                  <p className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
                    Aucune activité récente.
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fonctionnalités principales</CardTitle>
          <CardDescription>
            La réception et l’émission sont séparées pour éviter les confusions entre factures reçues,
            rejets d’émission et actions de correction.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {featureCards.map((feature) => (
              <Link
                key={feature.href}
                to={feature.href}
                className="group rounded-md border bg-card p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-start justify-between gap-3">
                  <feature.icon className="h-5 w-5 text-primary" />
                  <Badge variant="secondary">{feature.badge}</Badge>
                </div>
                <h2 className="mt-4 text-sm font-semibold">{feature.title}</h2>
                <p className="mt-2 min-h-[54px] text-sm leading-6 text-muted-foreground">
                  {feature.description}
                </p>
                <span className="mt-3 inline-flex items-center text-sm font-medium text-primary">
                  Ouvrir
                  <ArrowRight className="ml-1 h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      {!loading && invoices.length === 0 && !error && (
        <Card>
          <CardContent className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4" />
            Aucune facture en cache local. Lance une synchronisation Chorus pour alimenter les vues.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

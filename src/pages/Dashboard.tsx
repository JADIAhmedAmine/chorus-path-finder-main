import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { StatusBadge } from '@/components/common/StatusBadge';
import { formatCurrency, formatDate } from '@/lib/status-utils';
import { getAsyncJobs, getInvoices, getStatusHistory, getSuppliers } from '@/data/mock-data';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { FileText, AlertTriangle, CheckCircle, Clock, Upload, Ban, ArrowRight, Plus, Wrench } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

export default function Dashboard() {
  const { data, loading, error } = useAsyncResource(
    async () => {
      const [invoices, asyncJobs, statusHistory, suppliers] = await Promise.all([
        getInvoices(),
        getAsyncJobs(),
        getStatusHistory(),
        getSuppliers(),
      ]);

      return { invoices, asyncJobs, statusHistory, suppliers };
    },
    [],
    {
      invoices: [],
      asyncJobs: [],
      statusHistory: [],
      suppliers: [],
    },
  );

  const supplierById = useMemo(
    () => new Map(data.suppliers.map((supplier) => [supplier.id, supplier])),
    [data.suppliers],
  );

  const statusCounts = useMemo(() => {
    return data.invoices.reduce((acc, invoice) => {
      acc[invoice.statusInternal] = (acc[invoice.statusInternal] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }, [data.invoices]);

  const pieData = useMemo(() => [
    { name: 'Brouillons', value: (statusCounts['DRAFT_UPLOADED'] || 0) + (statusCounts['DRAFT_STRUCTURED'] || 0), color: '#6b7280' },
    { name: 'En attente', value: statusCounts['PENDING_HUMAN_REVIEW'] || 0, color: '#f59e0b' },
    { name: 'Prêt/Soumis', value: (statusCounts['READY_FOR_SUBMISSION'] || 0) + (statusCounts['SUBMISSION_REQUESTED'] || 0) + (statusCounts['SUBMITTED_TO_CHORUS'] || 0), color: '#3b82f6' },
    { name: 'Rejetés', value: (statusCounts['REJECTED_BUSINESS'] || 0) + (statusCounts['REJECTED_TECHNICAL'] || 0), color: '#ef4444' },
    { name: 'Acceptés/Payés', value: (statusCounts['ACCEPTED_BY_CHORUS'] || 0) + (statusCounts['PAID'] || 0), color: '#22c55e' },
    { name: 'Archivés', value: statusCounts['ARCHIVED'] || 0, color: '#9ca3af' },
  ].filter((item) => item.value > 0), [statusCounts]);

  const barData = useMemo(() => {
    const counts = new Map<string, number>();

    for (const invoice of data.invoices) {
      const key = invoice.invoiceDate.slice(0, 7);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return [...counts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([month, count]) => ({
        month: new Date(`${month}-01T00:00:00Z`).toLocaleDateString('fr-FR', { month: 'short' }),
        count,
      }));
  }, [data.invoices]);

  const failedJobs = useMemo(
    () => data.asyncJobs.filter((job) => job.status === 'FAILED' || job.status === 'DEAD'),
    [data.asyncJobs],
  );

  const recentEvents = useMemo(
    () => [...data.statusHistory].sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime()).slice(0, 5),
    [data.statusHistory],
  );

  const recentInvoices = useMemo(
    () => [...data.invoices].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()).slice(0, 5),
    [data.invoices],
  );

  const statCards = useMemo(() => [
    { label: 'Total factures', value: data.invoices.length, icon: FileText, color: 'text-foreground' },
    { label: 'En attente de revue', value: data.invoices.filter((invoice) => invoice.statusInternal === 'PENDING_HUMAN_REVIEW').length, icon: Clock, color: 'text-warning' },
    { label: 'Rejetées', value: data.invoices.filter((invoice) => invoice.statusInternal === 'REJECTED_BUSINESS' || invoice.statusInternal === 'REJECTED_TECHNICAL').length, icon: AlertTriangle, color: 'text-destructive' },
    { label: 'Acceptées / Payées', value: data.invoices.filter((invoice) => invoice.statusInternal === 'ACCEPTED_BY_CHORUS' || invoice.statusInternal === 'PAID').length, icon: CheckCircle, color: 'text-success' },
  ], [data.invoices]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Tableau de bord</h1>
          <p className="text-sm text-muted-foreground">Vue d'ensemble de votre activité de facturation</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link to="/invoices?status=REJECTED_BUSINESS,REJECTED_TECHNICAL">
              <Wrench className="mr-2 h-4 w-4" /> Traiter les rejets
            </Link>
          </Button>
          <Button asChild>
            <Link to="/invoices/new">
              <Plus className="mr-2 h-4 w-4" /> Déposer une facture
            </Link>
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  <p className={`text-3xl font-bold ${stat.color}`}>{stat.value}</p>
                </div>
                <stat.icon className={`h-8 w-8 ${stat.color} opacity-40`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Répartition par statut</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                    {pieData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-3 mt-2 justify-center">
              {pieData.map((d) => (
                <div key={d.name} className="flex items-center gap-1.5 text-xs">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                  {d.name} ({d.value})
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Factures par mois</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData}>
                  <XAxis dataKey="month" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="hsl(220, 60%, 20%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Invoices & Events */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Dernières factures</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/invoices">Voir tout <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentInvoices.map((inv) => {
                const supplier = supplierById.get(inv.supplierOrganizationId);
                return (
                  <Link key={inv.id} to={`/invoices/${inv.id}`} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors">
                    <div className="min-w-0">
                      <div className="font-medium text-sm">{inv.supplierInvoiceNumber}</div>
                      <div className="text-xs text-muted-foreground truncate">{supplier?.legalName}</div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-sm font-medium">{formatCurrency(inv.totalTtc)}</span>
                      <StatusBadge status={inv.statusInternal} />
                    </div>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Événements récents</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentEvents.map((event) => {
                const inv = data.invoices.find((invoice) => invoice.id === event.invoiceId);
                return (
                  <div key={event.id} className="flex items-start gap-3 py-2">
                    <div className="h-2 w-2 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: event.source === 'CHORUS' ? '#8b5cf6' : event.source === 'USER' ? '#3b82f6' : '#6b7280' }} />
                    <div className="min-w-0">
                      <div className="text-sm">{event.eventLabel}</div>
                      <div className="text-xs text-muted-foreground">
                        {inv?.supplierInvoiceNumber} · {formatDate(event.occurredAt)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Failed Jobs Alert */}
      {failedJobs.length > 0 && (
        <Card className="border-destructive/30">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Ban className="h-4 w-4 text-destructive" />
              Jobs en erreur ({failedJobs.length})
            </CardTitle>
            <Button variant="outline" size="sm" asChild>
              <Link to="/jobs">Voir les jobs</Link>
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {failedJobs.slice(0, 3).map((job) => {
                const inv = data.invoices.find((invoice) => invoice.id === job.invoiceId);
                return (
                  <div key={job.id} className="flex items-center justify-between text-sm py-1">
                    <span>{job.jobType} — {inv?.supplierInvoiceNumber || 'Batch'}</span>
                    <span className="text-xs text-destructive">{job.lastErrorMessage}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {!loading && data.invoices.length === 0 && !error && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Aucune donnée facture n&apos;a encore été chargée depuis le backend.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

import { Link } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Euro,
  Info,
  Loader2,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCurrency } from '@/lib/status-utils';
import {
  type DashboardInsight,
  type DashboardInsightSeverity,
  type DashboardSummary,
  useDashboardSummaryQuery,
} from '@/lib/queries/dashboard';
import { getChorusStateHumanLabel } from '@/lib/chorus/submissionState';

interface DashboardPilotagePanelProps {
  fromDate?: string;
  toDate?: string;
}

const AGING_COLORS: Record<string, string> = {
  '0-7': '#3b82f6',
  '8-15': '#eab308',
  '16-30': '#f97316',
  '30+': '#ef4444',
};

const SEVERITY_STYLES: Record<DashboardInsightSeverity, { className: string; Icon: typeof Info }> = {
  CRITICAL: { className: 'border-destructive/30 bg-destructive/5 text-destructive', Icon: AlertTriangle },
  HIGH: { className: 'border-destructive/30 bg-destructive/5 text-destructive', Icon: AlertCircle },
  MEDIUM: { className: 'border-warning/30 bg-warning/5 text-warning', Icon: AlertCircle },
  LOW: { className: 'border-info/30 bg-info/5 text-info', Icon: Info },
};

function formatPercent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)} %`;
}

function formatAge(days: number | null): string {
  if (days === null) return '—';
  if (days <= 1) return `${days} j`;
  return `${days} jours`;
}

export function DashboardPilotagePanel({ fromDate, toDate }: DashboardPilotagePanelProps) {
  const summaryQuery = useDashboardSummaryQuery({ from: fromDate, to: toDate });
  const summary = summaryQuery.data;

  if (summaryQuery.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Synthèse pilotage indisponible : {summaryQuery.error?.message ?? 'erreur inconnue.'}
        </AlertDescription>
      </Alert>
    );
  }

  if (!summary) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Calcul de la synthèse en cours...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <PilotageKpiStrip summary={summary} />
      {summary.insights.length > 0 && <PilotageInsights insights={summary.insights} />}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <AgingCard summary={summary} />
        <BlockedEntitiesCard summary={summary} />
        <RejectionReasonsCard summary={summary} />
      </div>
      <RecentIssuesCard summary={summary} />
    </div>
  );
}

function PilotageKpiStrip({ summary }: { summary: DashboardSummary }) {
  const { totals, apiHealth } = summary;
  const tiles = [
    {
      label: 'Montant soumis',
      value: formatCurrency(totals.totalAmount),
      hint: `${totals.invoiceCount} facture(s)`,
      Icon: Euro,
      tone: 'text-foreground',
    },
    {
      label: 'Encaissé',
      value: formatCurrency(totals.paidAmount),
      hint: `${totals.paidCount} payée(s)`,
      Icon: CheckCircle2,
      tone: 'text-success',
    },
    {
      label: 'Bloqué',
      value: formatCurrency(totals.blockedAmount),
      hint: `${totals.blockedCount} dossier(s)`,
      Icon: TrendingDown,
      tone: 'text-destructive',
    },
    {
      label: 'À traiter',
      value: totals.actionRequiredCount,
      hint: `${formatCurrency(totals.actionRequiredAmount)} concerné(s)`,
      Icon: AlertTriangle,
      tone: 'text-warning',
    },
    {
      label: 'Rejetées',
      value: totals.rejectedCount,
      hint: 'Action fournisseur attendue',
      Icon: AlertCircle,
      tone: 'text-destructive',
    },
    {
      label: 'API Chorus',
      value: formatPercent(apiHealth.successRate),
      hint:
        apiHealth.totalCalls === 0
          ? 'Aucun appel récent'
          : `${apiHealth.successCount}/${apiHealth.totalCalls} succès`,
      Icon: apiHealth.successRate !== null && apiHealth.successRate < 90 ? TrendingDown : ShieldCheck,
      tone:
        apiHealth.successRate === null
          ? 'text-muted-foreground'
          : apiHealth.successRate >= 95
            ? 'text-success'
            : apiHealth.successRate >= 80
              ? 'text-warning'
              : 'text-destructive',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
      {tiles.map((tile) => (
        <Card key={tile.label}>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{tile.label}</p>
                <p className={`mt-1 truncate text-2xl font-semibold ${tile.tone}`}>{tile.value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{tile.hint}</p>
              </div>
              <tile.Icon className={`h-7 w-7 shrink-0 ${tile.tone} opacity-50`} />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function PilotageInsights({ insights }: { insights: DashboardInsight[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {insights.map((insight) => {
        const config = SEVERITY_STYLES[insight.severity] ?? SEVERITY_STYLES.LOW;
        return (
          <div
            key={`${insight.title}-${insight.message}`}
            className={`rounded-md border p-3 ${config.className}`}
            data-testid="dashboard-insight"
          >
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide">
              <config.Icon className="h-3.5 w-3.5" />
              {insight.title}
            </div>
            <p className="mt-1 text-sm text-foreground">{insight.message}</p>
          </div>
        );
      })}
    </div>
  );
}

function AgingCard({ summary }: { summary: DashboardSummary }) {
  const data = summary.aging.map((entry) => ({
    label: entry.label,
    count: entry.count,
    amount: entry.amount,
    fill: AGING_COLORS[entry.label] ?? '#6b7280',
  }));
  const hasData = data.some((entry) => entry.count > 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center text-base">
          <Clock className="mr-2 h-4 w-4" />
          Ancienneté des dossiers
        </CardTitle>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 13%, 90%)" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
                <Tooltip
                  formatter={(value, name, item) => {
                    if (name === 'amount' || item?.dataKey === 'amount') {
                      return [formatCurrency(Number(value)), 'Montant TTC'];
                    }
                    return [`${value} dossier(s)`, 'Dossiers'];
                  }}
                />
                <Bar dataKey="count" name="Dossiers" radius={[4, 4, 0, 0]}>
                  {data.map((entry) => (
                    <Cell key={entry.label} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Aucun dossier en attente — toutes les factures sont soit payées soit fraîchement déposées.
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Tranches calculées sur la date de soumission (ou de dernier changement de statut) des factures non payées.
        </p>
      </CardContent>
    </Card>
  );
}

function BlockedEntitiesCard({ summary }: { summary: DashboardSummary }) {
  const top = summary.topEntitiesByBlocked;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center text-base">
          <TrendingUp className="mr-2 h-4 w-4" />
          Entités les plus exposées
        </CardTitle>
      </CardHeader>
      <CardContent>
        {top.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Aucun blocage actif côté destinataires.
          </p>
        ) : (
          <ul className="space-y-3">
            {top.map((entry) => (
              <li key={entry.publicCustomerId} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="truncate" title={entry.publicCustomerName}>
                    {entry.publicCustomerName || entry.publicCustomerId}
                  </span>
                  <span className="font-medium text-destructive">{formatCurrency(entry.blockedAmount)}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {entry.count} facture(s) — {formatCurrency(entry.totalAmount)} au total
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RejectionReasonsCard({ summary }: { summary: DashboardSummary }) {
  const reasons = summary.topRejectionReasons;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center text-base">
          <AlertCircle className="mr-2 h-4 w-4" />
          Motifs de blocage les plus fréquents
        </CardTitle>
      </CardHeader>
      <CardContent>
        {reasons.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Aucun motif renseigné côté Chorus.
          </p>
        ) : (
          <ul className="space-y-3">
            {reasons.map((reason, index) => (
              <li
                key={`${reason.reasonCode ?? 'motif'}-${index}`}
                className="rounded-md border bg-muted/30 p-3"
              >
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{reason.reasonCode || '—'}</span>
                  <span className="text-muted-foreground">{reason.count} dossier(s)</span>
                </div>
                {reason.reasonLabel && (
                  <p className="mt-1 text-xs text-muted-foreground">{reason.reasonLabel}</p>
                )}
                <p className="mt-1 text-xs text-destructive">
                  Montant bloqué : {formatCurrency(reason.blockedAmount)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RecentIssuesCard({ summary }: { summary: DashboardSummary }) {
  const issues = summary.recentIssues;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center text-base">
          <Activity className="mr-2 h-4 w-4" />
          Dossiers nécessitant une attention
        </CardTitle>
      </CardHeader>
      <CardContent>
        {issues.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Aucun dossier bloqué ou rejeté dans le périmètre courant — rien à traiter dans l'immédiat.
          </p>
        ) : (
          <ul className="space-y-2">
            {issues.map((issue) => (
              <li key={issue.invoiceId}>
                <Link
                  to={`/invoices/chorus/${encodeURIComponent(issue.invoiceId)}`}
                  className="flex flex-col gap-1 rounded-md border p-3 transition-colors hover:border-primary hover:bg-muted/40"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span>{issue.supplierInvoiceNumber}</span>
                      {issue.status && (
                        <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
                          {getChorusStateHumanLabel(issue.status)}
                        </span>
                      )}
                      {issue.requiresAction && (
                        <span className="rounded bg-warning/10 px-1.5 py-0.5 text-xs font-medium text-warning">
                          Action requise
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{formatCurrency(issue.totalTtc)}</span>
                      <span>{formatAge(issue.ageInDays)}</span>
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {issue.publicCustomerName || issue.publicCustomerId || 'Destinataire inconnu'}
                    {issue.statusReasonLabel && <> · {issue.statusReasonLabel}</>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 text-right">
          <Link
            to="/invoices?status=REJETEE"
            className="inline-flex items-center text-xs text-primary hover:underline"
          >
            Voir toutes les factures bloquées <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

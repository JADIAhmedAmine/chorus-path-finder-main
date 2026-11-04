import { useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileSearch,
  Info,
  Layers,
  Loader2,
  Network,
  Plug,
  RefreshCw,
  Workflow,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/common/PageHeader';
import { KpiCard } from '@/components/common/KpiCard';
import { ApiErrorCard } from '@/components/common/ApiErrorCard';
import { FluxPipeline } from '@/components/flux/FluxPipeline';
import { OfficialSourcesBox } from '@/components/flux/OfficialSourcesBox';
import {
  QUICK_ACCESS_CARDS,
  FLUX_TYPES,
  type FluxTone,
} from '@/lib/flux/content';
import { computeFluxHubStats, useInvoicesQuery } from '@/lib/flux/invoiceService';
import {
  FLUX_DEPOSITS_AUTH_ERROR,
  fetchFluxDepositsStats,
  refreshFluxDepositCrs,
} from '@/lib/flux/fluxDepositsService';
import { loadChorusConfig } from '@/lib/chorus/storage';
import { formatDateTime } from '@/lib/status-utils';
import { cn } from '@/lib/utils';

const QUICK_TONE: Record<FluxTone, { iconBg: string; ring: string }> = {
  info: { iconBg: 'bg-info-soft text-info', ring: 'group-hover:border-info/40' },
  warning: { iconBg: 'bg-warning-soft text-warning', ring: 'group-hover:border-warning/40' },
  error: { iconBg: 'bg-destructive-soft text-destructive', ring: 'group-hover:border-destructive/40' },
  success: { iconBg: 'bg-success-soft text-success', ring: 'group-hover:border-success/40' },
  neutral: { iconBg: 'bg-muted text-muted-foreground', ring: 'group-hover:border-primary/40' },
};

const FLUX_TYPE_TONE: Record<FluxTone, string> = {
  info: 'border-l-info',
  warning: 'border-l-warning',
  error: 'border-l-destructive',
  success: 'border-l-success',
  neutral: 'border-l-muted-foreground/40',
};

export default function FluxHub() {
  const invoicesQuery = useInvoicesQuery({ pageSize: 500 });
  const invoiceItems = invoicesQuery.data?.items;
  const loading = invoicesQuery.isLoading;
  const error = invoicesQuery.error?.message ?? null;

  const stats = useMemo(() => computeFluxHubStats(invoiceItems ?? []), [invoiceItems]);

  // Statistiques de dépôt de flux (P2-1) — branchées sur GET /api/chorus/flux/deposits/stats.
  const config = useMemo(() => loadChorusConfig(), []);
  const depositsStatsQuery = useQuery({
    queryKey: ['flux-deposits-stats'],
    queryFn: () => fetchFluxDepositsStats(config),
  });
  const depositStatsResult = depositsStatsQuery.data;
  const depositStats =
    depositStatsResult && depositStatsResult.available ? depositStatsResult.stats : null;
  const depositStatsLoading = depositsStatsQuery.isLoading;
  const depositStatsError = depositsStatsQuery.error?.message ?? null;
  const depositStatsAuthError = depositStatsError === FLUX_DEPOSITS_AUTH_ERROR;
  // « Connecté » dès qu'au moins un dépôt existe ; sinon on garde l'état vide.
  const hasDepositData = !!depositStats && depositStats.total > 0;
  const refreshCrMutation = useMutation({
    mutationFn: async () => {
      const result = await refreshFluxDepositCrs(config);
      if (!result.available) {
        throw new Error('La base des dépôts de flux est indisponible.');
      }
      if (!result.success) {
        throw new Error(result.reason ?? 'Actualisation des comptes rendus impossible.');
      }
      return result;
    },
    onSuccess: async () => {
      await depositsStatsQuery.refetch();
    },
  });
  const failedCrRefresh = refreshCrMutation.data?.items.find((item) => !item.crRefreshed);
  const refreshCrError = refreshCrMutation.error?.message ?? failedCrRefresh?.error ?? null;

  return (
    <div className="space-y-7 animate-fade-in">
      {/* 1. Header */}
      <PageHeader
        eyebrow={
          <>
            <Network className="h-3 w-3" />
            Pilotage Chorus Pro / PISTE
          </>
        }
        title="Flux Chorus Pro"
        description="Pilotez le dépôt, la validation, le suivi et la correction des flux transmis via Chorus Pro / PISTE."
      />

      <div className="flex items-start gap-3 rounded-xl border border-info/25 bg-info-soft/40 p-4">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-info" />
        <p className="text-[13px] leading-6 text-muted-foreground">
          Un <span className="font-medium text-foreground">flux</span> correspond à un échange structuré de données
          autour d'une facture : <span className="font-medium text-foreground">flux entrant</span> envoyé vers Chorus Pro,
          <span className="font-medium text-foreground"> flux pivot</span> transmis au destinataire public, ou
          <span className="font-medium text-foreground"> flux retour</span> permettant de suivre le cycle de vie et les statuts.
        </p>
      </div>

      {/* 2. Cartes d'accès rapide */}
      <section>
        <div className="mb-3">
          <h2 className="text-[15px] font-semibold text-foreground">Accès rapide</h2>
          <p className="text-[12.5px] text-muted-foreground">
            Les fonctionnalités existantes, regroupées dans un même parcours.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 stagger-children">
          {QUICK_ACCESS_CARDS.map((card) => {
            const tone = QUICK_TONE[card.tone];
            return (
              <Link
                key={card.id}
                to={card.to}
                className={cn(
                  'group relative overflow-hidden rounded-xl border bg-card p-5 shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  tone.ring,
                )}
              >
                <div className={cn('mb-3 inline-flex h-11 w-11 items-center justify-center rounded-xl', tone.iconBg)}>
                  <card.icon className="h-5 w-5" />
                </div>
                <h3 className="text-[14.5px] font-semibold text-foreground">{card.title}</h3>
                <p className="mt-1.5 text-[12.5px] leading-5 text-muted-foreground">{card.description}</p>
              </Link>
            );
          })}
        </div>
      </section>

      {/* 4. Statistiques de synthèse */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-foreground">État global des flux</h2>
            <p className="text-[12.5px] text-muted-foreground">
              Indicateurs calculés à partir des factures en cache et des dépôts de flux enregistrés.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => refreshCrMutation.mutate()}
            disabled={refreshCrMutation.isPending || depositStatsLoading || !hasDepositData}
          >
            {refreshCrMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {refreshCrMutation.isPending ? 'Actualisation…' : 'Actualiser les CR'}
          </Button>
        </div>

        {error && (
          <ApiErrorCard
            severity="warning"
            title="Données factures indisponibles"
            explanation="Les indicateurs s'appuient sur le dernier cache local. Vérifie ta connexion ou la configuration PISTE."
            technicalDetails={error}
            onRetry={() => invoicesQuery.refetch()}
          />
        )}

        {refreshCrError && (
          <ApiErrorCard
            severity="warning"
            title="Actualisation des comptes rendus incomplète"
            explanation="Au moins un compte rendu Chorus ou la relecture des KPI n’a pas pu aboutir."
            technicalDetails={refreshCrError}
            onRetry={() => refreshCrMutation.mutate()}
          />
        )}

        {depositStatsError && (
          <ApiErrorCard
            severity={depositStatsAuthError ? 'error' : 'warning'}
            title={depositStatsAuthError ? FLUX_DEPOSITS_AUTH_ERROR : 'Données de dépôt indisponibles'}
            explanation={
              depositStatsAuthError
                ? 'Reconnectez-vous pour consulter les dépôts et leurs KPI.'
                : 'Impossible de charger les statistiques des dépôts de flux.'
            }
            technicalDetails={depositStatsError}
            onRetry={() => depositsStatsQuery.refetch()}
          />
        )}

        {/* Indicateurs disponibles (dérivés des factures) */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Factures liées"
            value={loading ? '—' : stats.linkedInvoices.toLocaleString('fr-FR')}
            hint="Factures connues (cache Chorus)"
            icon={FileSearch}
            tone="primary"
            loading={loading}
            href="/invoices"
          />
          <KpiCard
            label="Rejets / refus"
            value={loading ? '—' : stats.rejected.toLocaleString('fr-FR')}
            hint="À analyser et corriger"
            icon={AlertTriangle}
            tone="danger"
            loading={loading}
            href="/invoices/rejections"
          />
          <KpiCard
            label="Corrections à faire"
            value={loading ? '—' : stats.corrections.toLocaleString('fr-FR')}
            hint="Émissions actionnables hors rejets"
            icon={Workflow}
            tone="warning"
            loading={loading}
            href="/invoices/to-process"
          />
          <KpiCard
            label="Taux de succès"
            value={loading || stats.successRate === null ? '—' : `${stats.successRate}%`}
            hint={`${stats.paid.toLocaleString('fr-FR')} factures payées`}
            icon={CheckCircle2}
            tone="success"
            loading={loading}
          />
        </div>

        {/* Indicateurs propres au dépôt de flux (P2-1) — GET /api/chorus/flux/deposits/stats */}
        {depositStatsLoading || hasDepositData ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <KpiCard
              label="Flux déposés"
              value={depositStatsLoading ? '—' : (depositStats?.total ?? 0).toLocaleString('fr-FR')}
              hint="Dépôts enregistrés"
              icon={Layers}
              tone="primary"
              loading={depositStatsLoading}
            />
            <KpiCard
              label="Flux en erreur"
              value={depositStatsLoading ? '—' : (depositStats?.totalErrors ?? 0).toLocaleString('fr-FR')}
              hint="Rejetés ou incidentés"
              icon={AlertTriangle}
              tone="danger"
              loading={depositStatsLoading}
            />
            <KpiCard
              label="Dernier dépôt"
              value={
                depositStatsLoading
                  ? '—'
                  : depositStats?.lastDepositAt
                    ? formatDateTime(depositStats.lastDepositAt)
                    : '—'
              }
              hint={
                depositStats && depositStats.successRate !== null
                  ? `Taux de réussite ${depositStats.successRate}%`
                  : 'Horodatage du dernier dépôt'
              }
              icon={Clock3}
              tone="info"
              loading={depositStatsLoading}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[
              { label: 'Flux déposés', icon: Layers },
              { label: 'Flux en erreur', icon: AlertTriangle },
              { label: 'Dernier dépôt', icon: Clock3 },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-dashed bg-dotted p-5">
                <div className="flex items-center justify-between">
                  <p className="text-[12px] font-medium uppercase tracking-wider text-muted-foreground">{item.label}</p>
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <item.icon className="h-[18px] w-[18px]" />
                  </span>
                </div>
                <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  <Plug className="h-3 w-3" />
                  {depositStatsAuthError
                    ? FLUX_DEPOSITS_AUTH_ERROR
                    : depositsStatsQuery.isError || depositStatsResult?.available === false
                    ? 'Données de dépôt indisponibles'
                    : 'Pas encore de dépôt de flux'}
                </p>
                <p className="mt-2 text-[12px] leading-5 text-muted-foreground">
                  {depositStatsAuthError
                    ? 'Reconnectez-vous pour charger les indicateurs de dépôt.'
                    : depositsStatsQuery.isError || depositStatsResult?.available === false
                    ? 'Le service de dépôt de flux n’est pas joignable pour le moment.'
                    : 'Les indicateurs apparaîtront dès le premier dépôt de flux enregistré.'}
                </p>
              </div>
            ))}
          </div>
        )}

        {stats.lastActivityAt && (
          <p className="text-[12px] text-muted-foreground">
            Dernier mouvement facture connu&nbsp;: {formatDateTime(stats.lastActivityAt)}
          </p>
        )}
      </section>

      {/* 3. Pipeline visuel */}
      <section className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <Card className="card-elevated">
          <CardHeader className="pb-3">
            <CardTitle className="text-[15px]">Pipeline de traitement du flux</CardTitle>
            <CardDescription className="text-[12.5px]">
              Du fichier importé jusqu'à l'archivage : chaque étape renvoie vers l'action correspondante.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FluxPipeline />
          </CardContent>
        </Card>

        {/* 5. Bloc pédagogique officiel */}
        <div className="space-y-4">
          <Card className="card-elevated">
            <CardHeader className="pb-3">
              <CardTitle className="text-[15px]">Comprendre les flux Chorus Pro</CardTitle>
              <CardDescription className="text-[12.5px]">
                Les notions clés, formulées simplement.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {FLUX_TYPES.map((type) => (
                <div
                  key={type.id}
                  className={cn('rounded-lg border border-l-[3px] bg-card p-3', FLUX_TYPE_TONE[type.tone])}
                >
                  <p className="text-[13px] font-semibold text-foreground">{type.title}</p>
                  <p className="mt-0.5 text-[12.5px] leading-5 text-muted-foreground">{type.description}</p>
                </div>
              ))}
            </CardContent>
          </Card>
          <OfficialSourcesBox />
        </div>
      </section>
    </div>
  );
}

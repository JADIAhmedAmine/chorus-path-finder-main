import { useMemo } from 'react';
import { Activity, AlertTriangle, RefreshCw, CheckCircle2, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useInvoicesQuery } from '@/lib/queries/db';
import { normalizeChorusState } from '@/lib/chorus/submissionState';

interface SubmissionStateOverviewProps {
  /** Met en évidence l'état correspondant à la facture courante (optionnel). */
  highlightedState?: string | null;
}

interface OverviewBucket {
  key: 'allowed' | 'rejected' | 'recyclable' | 'blocked' | 'total';
  label: string;
  description: string;
  count: number;
  Icon: typeof Activity;
  className: string;
}

const ALLOWED_STATES = new Set(['BROUILLON', 'ERREUR_FOURNISSEUR_SUR_VALIDEUR']);
const RECYCLABLE_STATES = new Set(['A_RECYCLER', 'EN_ATTENTE_RECYCLAGE_FOURNISSEUR']);
const REJECTED_STATES = new Set(['REJETEE']);

export function SubmissionStateOverview({ highlightedState }: SubmissionStateOverviewProps) {
  const invoicesQuery = useInvoicesQuery();
  const items = invoicesQuery.data?.items ?? [];

  const buckets = useMemo<OverviewBucket[]>(() => {
    let allowed = 0;
    let rejected = 0;
    let recyclable = 0;
    let blocked = 0;

    for (const invoice of items) {
      const state = normalizeChorusState(invoice.statusChorus);
      if (!state) {
        continue;
      }
      if (REJECTED_STATES.has(state)) {
        rejected += 1;
        blocked += 1;
        continue;
      }
      if (RECYCLABLE_STATES.has(state)) {
        recyclable += 1;
      }
      if (ALLOWED_STATES.has(state)) {
        allowed += 1;
      } else if (!RECYCLABLE_STATES.has(state)) {
        blocked += 1;
      }
    }

    return [
      {
        key: 'allowed',
        label: 'Prêtes à être soumises',
        description: 'BROUILLON ou ERREUR_FOURNISSEUR_SUR_VALIDEUR.',
        count: allowed,
        Icon: CheckCircle2,
        className: 'border-success/30 bg-success/5 text-success',
      },
      {
        key: 'recyclable',
        label: 'À recycler',
        description: 'Demandes en attente de recyclage côté fournisseur.',
        count: recyclable,
        Icon: RefreshCw,
        className: 'border-warning/30 bg-warning/5 text-warning',
      },
      {
        key: 'rejected',
        label: 'Rejetées',
        description: 'Bloquées tant que l’état reste REJETEE.',
        count: rejected,
        Icon: AlertTriangle,
        className: 'border-destructive/30 bg-destructive/5 text-destructive',
      },
      {
        key: 'blocked',
        label: 'Autres états bloquants',
        description: 'Hors statuts compatibles avec une soumission directe.',
        count: blocked - rejected,
        Icon: Activity,
        className: 'border-muted bg-muted/30 text-muted-foreground',
      },
    ];
  }, [items]);

  const highlightedNormalized = normalizeChorusState(highlightedState);
  const totalInvoices = items.length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Pilotage des demandes de paiement
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            {totalInvoices > 0 ? `${totalInvoices} facture(s) suivie(s)` : 'Aucune donnée chargée'}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {invoicesQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Chargement du portefeuille...
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {buckets.map((bucket) => {
              const isHighlighted =
                bucket.key === 'rejected' && highlightedNormalized === 'REJETEE';
              return (
                <div
                  key={bucket.key}
                  className={`flex flex-col gap-1 rounded-md border p-3 ${bucket.className} ${
                    isHighlighted ? 'ring-2 ring-offset-1' : ''
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide">
                    <bucket.Icon className="h-3.5 w-3.5" />
                    {bucket.label}
                  </div>
                  <div className="text-2xl font-semibold text-foreground">{bucket.count}</div>
                  <p className="text-xs text-muted-foreground">{bucket.description}</p>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

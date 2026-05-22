import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/status-utils';
import { cn } from '@/lib/utils';
import type { SyncRunResult } from '@/lib/queries/db';
import { AlertTriangle, CheckCircle, RefreshCw } from 'lucide-react';

interface SyncRunSummaryProps {
  runs: SyncRunResult[];
  className?: string;
}

function sumBy(runs: SyncRunResult[], selector: (run: SyncRunResult) => number): number {
  return runs.reduce((sum, run) => sum + selector(run), 0);
}

function payloadNumber(run: SyncRunResult, ...keys: string[]): number {
  for (const key of keys) {
    const value = run.payloadSummary?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }

  return 0;
}

function getRefreshedExistingCount(run: SyncRunResult): number {
  return payloadNumber(run, 'refreshed_existing', 'refreshedExisting');
}

function getLatestRunDate(runs: SyncRunResult[]): string | null {
  const timestamps = runs
    .map((run) => run.finishedAt || run.startedAt)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));

  if (timestamps.length === 0) {
    return null;
  }

  return new Date(Math.max(...timestamps)).toISOString();
}

function formatRunDuration(runs: SyncRunResult[]): string | null {
  const durations = runs
    .map((run) => {
      if (!run.finishedAt || !run.startedAt) {
        return null;
      }

      const startedAt = new Date(run.startedAt).getTime();
      const finishedAt = new Date(run.finishedAt).getTime();
      if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt < startedAt) {
        return null;
      }

      return finishedAt - startedAt;
    })
    .filter((value): value is number => value !== null);

  if (durations.length === 0) {
    return null;
  }

  const totalSeconds = Math.round(Math.max(...durations) / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds} s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes} min ${seconds} s` : `${minutes} min`;
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-md border bg-background/70 px-3 py-2">
      <div className="text-[11px] font-medium uppercase text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export function SyncRunSummary({ runs, className }: SyncRunSummaryProps) {
  if (runs.length === 0) {
    return null;
  }

  const rowsFetched = sumBy(runs, (run) => run.rowsFetched);
  const rowsUpserted = sumBy(runs, (run) => run.rowsUpserted);
  const rowsFailed = sumBy(runs, (run) => run.rowsFailed);
  const refreshedExisting = sumBy(runs, getRefreshedExistingCount);
  const latestDate = getLatestRunDate(runs);
  const duration = formatRunDuration(runs);
  const hasFailures = rowsFailed > 0 || runs.some((run) => run.status === 'failed' || run.status === 'partial');
  const allFailed = rowsUpserted === 0 && rowsFailed > 0;
  const Icon = hasFailures ? AlertTriangle : CheckCircle;

  return (
    <Alert
      className={cn(
        hasFailures ? 'border-destructive/40 bg-destructive/5' : 'border-success/30 bg-success/5',
        className,
      )}
    >
      <Icon className={cn('h-4 w-4', hasFailures ? 'text-destructive' : 'text-success')} />
      <AlertTitle className="flex flex-wrap items-center gap-2">
        {allFailed ? 'Actualisation à corriger' : hasFailures ? 'Actualisation partielle' : 'Actualisation terminée'}
        <Badge variant={hasFailures ? 'destructive' : 'default'}>
          {runs.length} fournisseur{runs.length > 1 ? 's' : ''}
        </Badge>
      </AlertTitle>
      <AlertDescription>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          <SummaryMetric label="Reçues" value={rowsFetched} />
          <SummaryMetric label="Upsertées" value={rowsUpserted} />
          <SummaryMetric label="Rafraîchies" value={refreshedExisting} />
          <SummaryMetric label="Échecs" value={rowsFailed} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {latestDate && (
            <span className="inline-flex items-center gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
              {formatDateTime(latestDate)}
            </span>
          )}
          {duration && <span>Durée {duration}</span>}
          {hasFailures && <span>Consultez les logs backend pour le détail des lignes refusées.</span>}
        </div>
      </AlertDescription>
    </Alert>
  );
}

export function SyncRunProgress({ className }: { className?: string }) {
  return (
    <Alert className={cn('border-info/30 bg-info/5', className)}>
      <RefreshCw className="h-4 w-4 animate-spin text-info" />
      <AlertTitle>Actualisation Chorus en cours</AlertTitle>
      <AlertDescription>
        Lecture complète des factures fournisseur et mise à jour du cache local.
      </AlertDescription>
    </Alert>
  );
}

import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { JobStatusBadge } from '@/components/common/JobStatusBadge';
import { PageHeader } from '@/components/common/PageHeader';
import { ApiErrorCard } from '@/components/common/ApiErrorCard';
import { EmptyState } from '@/components/common/EmptyState';
import { getAsyncJobs, getInvoices } from '@/data/mock-data';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { formatDateTime } from '@/lib/status-utils';
import { RotateCcw, Server, Settings2, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function Jobs() {
  const { toast } = useToast();
  const { data, error } = useAsyncResource(
    async () => {
      const [asyncJobs, invoices] = await Promise.all([getAsyncJobs(), getInvoices()]);
      return { asyncJobs, invoices };
    },
    [],
    {
      asyncJobs: [],
      invoices: [],
    },
  );
  const sorted = useMemo(
    () => [...data.asyncJobs].sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()),
    [data.asyncJobs],
  );

  return (
    <div className="space-y-7 animate-fade-in">
      <PageHeader
        eyebrow={<><Settings2 className="h-3 w-3" /> Système · jobs</>}
        title="Jobs techniques"
        description="Suivi des tâches asynchrones et gestion des retries Chorus."
      />

      {error && (
        <ApiErrorCard severity="error" title="Lecture impossible" technicalDetails={error} />
      )}

      <Card className="card-elevated overflow-hidden">
        <CardContent className="p-0">
          {sorted.length === 0 && !error ? (
            <EmptyState icon={Server} title="Aucun job en file" description="Les jobs asynchrones (retry de soumission, sync différée…) apparaîtront ici." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b bg-muted/20 text-left">
                    <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Type</th>
                    <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Facture</th>
                    <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Statut</th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tentatives</th>
                    <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Prochaine</th>
                    <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Dernière erreur</th>
                    <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">MAJ</th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((job) => {
                    const inv = data.invoices.find((i) => i.id === job.invoiceId);
                    return (
                      <tr key={job.id} className="border-b border-border/70 transition-colors last:border-0 hover:bg-primary/[0.025]">
                        <td className="px-4 py-2.5 font-mono text-[11.5px]">{job.jobType}</td>
                        <td className="px-4 py-2.5">{inv ? inv.supplierInvoiceNumber : <span className="text-muted-foreground italic">Batch</span>}</td>
                        <td className="px-4 py-2.5"><JobStatusBadge status={job.status} /></td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{job.attemptCount}/{job.maxAttempts}</td>
                        <td className="px-4 py-2.5 text-[11.5px] text-muted-foreground">{job.nextAttemptAt ? formatDateTime(job.nextAttemptAt) : '—'}</td>
                        <td className="max-w-[220px] truncate px-4 py-2.5 text-[11.5px] text-destructive">{job.lastErrorMessage || '—'}</td>
                        <td className="px-4 py-2.5 text-[11.5px] text-muted-foreground">{formatDateTime(job.updatedAt)}</td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex justify-end gap-1">
                            {(job.status === 'FAILED' || job.status === 'DEAD') && (
                              <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => toast({ title: 'Retry lancé', description: `Job ${job.id} relancé.` })}>
                                <RotateCcw className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {job.status !== 'DONE' && job.status !== 'DEAD' && (
                              <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground hover:text-destructive" onClick={() => toast({ title: 'Job annulé', description: `Job ${job.id} annulé.` })}>
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

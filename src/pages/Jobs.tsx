import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { JobStatusBadge } from '@/components/common/JobStatusBadge';
import { asyncJobs, invoices } from '@/data/mock-data';
import { formatDateTime } from '@/lib/status-utils';
import { RotateCcw, X, FileText } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function Jobs() {
  const { toast } = useToast();
  const sorted = [...asyncJobs].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold">Jobs techniques</h1>
        <p className="text-sm text-muted-foreground">Suivi des tâches asynchrones et gestion des retries</p>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left p-3 font-medium">Type</th>
                <th className="text-left p-3 font-medium">Facture</th>
                <th className="text-left p-3 font-medium">Statut</th>
                <th className="text-right p-3 font-medium">Tentatives</th>
                <th className="text-left p-3 font-medium">Prochaine</th>
                <th className="text-left p-3 font-medium">Dernière erreur</th>
                <th className="text-left p-3 font-medium">MAJ</th>
                <th className="text-left p-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(job => {
                const inv = invoices.find(i => i.id === job.invoiceId);
                return (
                  <tr key={job.id} className="border-b">
                    <td className="p-3 font-mono text-xs">{job.jobType}</td>
                    <td className="p-3">{inv ? inv.supplierInvoiceNumber : <span className="text-muted-foreground">Batch</span>}</td>
                    <td className="p-3"><JobStatusBadge status={job.status} /></td>
                    <td className="p-3 text-right">{job.attemptCount}/{job.maxAttempts}</td>
                    <td className="p-3 text-xs text-muted-foreground">{job.nextAttemptAt ? formatDateTime(job.nextAttemptAt) : '-'}</td>
                    <td className="p-3 text-xs text-destructive max-w-[200px] truncate">{job.lastErrorMessage || '-'}</td>
                    <td className="p-3 text-xs text-muted-foreground">{formatDateTime(job.updatedAt)}</td>
                    <td className="p-3">
                      <div className="flex gap-1">
                        {(job.status === 'FAILED' || job.status === 'DEAD') && (
                          <Button variant="ghost" size="sm" onClick={() => toast({ title: 'Retry lancé', description: `Job ${job.id} relancé.` })}>
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        )}
                        {job.status !== 'DONE' && job.status !== 'DEAD' && (
                          <Button variant="ghost" size="sm" onClick={() => toast({ title: 'Job annulé', description: `Job ${job.id} annulé.` })}>
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

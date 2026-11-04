import { useMemo } from 'react';
import { ScrollText } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/common/PageHeader';
import { ApiErrorCard } from '@/components/common/ApiErrorCard';
import { EmptyState } from '@/components/common/EmptyState';
import { getAuditLogs } from '@/data/mock-data';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { formatDateTime } from '@/lib/status-utils';

export default function AuditPage() {
  const { data: auditLogs, error } = useAsyncResource(
    () => getAuditLogs(),
    [],
    [],
  );
  const sorted = useMemo(
    () => [...auditLogs].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
    [auditLogs],
  );

  return (
    <div className="space-y-7 animate-fade-in">
      <PageHeader
        eyebrow={<><ScrollText className="h-3 w-3" /> Système · audit</>}
        title="Journal d'audit"
        description="Traçabilité complète des actions utilisateurs et système."
      />

      {error && <ApiErrorCard severity="error" title="Lecture impossible" technicalDetails={error} />}

      <Card className="card-elevated overflow-hidden">
        <CardContent className="p-0">
          {sorted.length === 0 && !error ? (
            <EmptyState icon={ScrollText} title="Aucun événement" description="Les actions utilisateurs et système s'afficheront ici." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b bg-muted/20 text-left">
                    <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Action</th>
                    <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Type acteur</th>
                    <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Acteur</th>
                    <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Entité</th>
                    <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Détail</th>
                    <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">IP</th>
                    <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((log) => (
                    <tr key={log.id} className="border-b border-border/70 transition-colors last:border-0 hover:bg-primary/[0.025]">
                      <td className="px-4 py-2.5 font-mono text-[11.5px]">{log.actionCode}</td>
                      <td className="px-4 py-2.5">{log.actorType}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{log.actorId}</td>
                      <td className="px-4 py-2.5">{log.entityType} / {log.entityId}</td>
                      <td className="max-w-[220px] truncate px-4 py-2.5 font-mono text-[11px] text-muted-foreground">{log.diff ? JSON.stringify(log.diff) : '—'}</td>
                      <td className="px-4 py-2.5 font-mono text-[11.5px] text-muted-foreground">{log.ipAddress || '—'}</td>
                      <td className="px-4 py-2.5 text-[11.5px] text-muted-foreground">{formatDateTime(log.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

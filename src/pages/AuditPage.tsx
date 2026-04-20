import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold">Journal d'audit</h1>
        <p className="text-sm text-muted-foreground">Traçabilité complète des actions utilisateurs et système</p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left p-3 font-medium">Action</th>
                <th className="text-left p-3 font-medium">Type acteur</th>
                <th className="text-left p-3 font-medium">Acteur</th>
                <th className="text-left p-3 font-medium">Entité</th>
                <th className="text-left p-3 font-medium">Détail</th>
                <th className="text-left p-3 font-medium">IP</th>
                <th className="text-left p-3 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(log => (
                <tr key={log.id} className="border-b">
                  <td className="p-3 font-mono text-xs">{log.actionCode}</td>
                  <td className="p-3">{log.actorType}</td>
                  <td className="p-3 text-muted-foreground">{log.actorId}</td>
                  <td className="p-3">{log.entityType} / {log.entityId}</td>
                  <td className="p-3 text-xs max-w-[200px] truncate">{log.diff ? JSON.stringify(log.diff) : '-'}</td>
                  <td className="p-3 text-xs text-muted-foreground">{log.ipAddress || '-'}</td>
                  <td className="p-3 text-xs text-muted-foreground">{formatDateTime(log.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

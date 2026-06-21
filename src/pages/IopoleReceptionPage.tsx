import { useEffect, useState } from 'react';
import { Download, Inbox, Loader2, RefreshCw, Send } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import {
  downloadIopoleInvoice,
  getIopoleStatus,
  listIopoleInbox,
  markIopoleSeen,
  type IopoleInbox,
  type IopoleStatus,
} from '@/lib/providers/iopole';

const DELIVERED = new Set(['DELIVERED', 'VALID', 'CONVERTED']);
const REJECTED = new Set(['INVALID', 'WRONG_ROUTING', 'NOT_DELIVERED', 'CONVERSION_FAILED']);
const variant = (s?: string | null) =>
  !s ? 'secondary' : DELIVERED.has(s) ? 'default' : REJECTED.has(s) ? 'destructive' : 'secondary';

export default function IopoleReceptionPage() {
  const { toast } = useToast();
  const [inbox, setInbox] = useState<IopoleInbox | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<IopoleStatus | null>(null);

  async function load() {
    setLoading(true);
    try {
      setInbox(await listIopoleInbox(50));
    } catch (e) {
      toast({ title: 'Erreur réception', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Inbox className="h-6 w-6" /> Iopole — Réception
          </h1>
          <p className="text-sm text-muted-foreground">Factures reçues (entrantes) via la PDP Iopole.</p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Actualiser
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Factures reçues {inbox ? `(${inbox.count})` : ''}
            {inbox && inbox.notSeen.length > 0 && (
              <Badge className="ml-2" variant="secondary">{inbox.notSeen.length} non vue(s)</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!inbox || inbox.received.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {loading ? 'Chargement…' : 'Aucune facture reçue.'}
            </p>
          ) : (
            <div className="divide-y">
              {inbox.received.map((inv) => {
                const meta = (inv.raw as { metadata?: { state?: string } } | undefined)?.metadata;
                const notSeen = inbox.notSeen.includes(inv.id);
                return (
                  <div key={inv.id} className="flex items-center justify-between py-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-xs">{inv.id}</div>
                      <div className="text-xs text-muted-foreground">{inv.reference ?? '—'}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      {notSeen && <Badge variant="secondary">non vue</Badge>}
                      <Badge variant={variant(meta?.state)}>{meta?.state ?? '—'}</Badge>
                      <Button variant="ghost" size="icon" title="Télécharger" onClick={() => downloadIopoleInvoice(inv.id)}>
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => getIopoleStatus(inv.id).then(setStatus)}>
                        <Send className="mr-1 h-3 w-3" /> Statut
                      </Button>
                      {notSeen && (
                        <Button variant="secondary" size="sm" onClick={() => markIopoleSeen(inv.id).then(load)}>
                          Marquer vue
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {status && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Statut — <span className="font-mono text-xs">{status.id}</span></CardTitle>
          </CardHeader>
          <CardContent>
            <div>Lifecycle : <Badge variant={variant(status.lifecycleStatus)}>{status.lifecycleStatus ?? '—'}</Badge></div>
            <div className="mt-1 text-xs text-muted-foreground">
              {status.history.map((h) => h.code).filter(Boolean).join(' → ') || '—'}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

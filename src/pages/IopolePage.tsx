import { useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw, Send, Upload } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import {
  emitIopoleInvoice,
  getIopoleStatus,
  iopoleHealth,
  listIopoleInvoices,
  type IopoleInvoice,
  type IopoleStatus,
} from '@/lib/providers/iopole';

const DELIVERED = new Set(['DELIVERED', 'VALID', 'CONVERTED']);
const REJECTED = new Set(['INVALID', 'WRONG_ROUTING', 'NOT_DELIVERED', 'CONVERSION_FAILED']);

function statusVariant(state: string | null | undefined): 'default' | 'secondary' | 'destructive' {
  if (!state) return 'secondary';
  if (DELIVERED.has(state)) return 'default';
  if (REJECTED.has(state)) return 'destructive';
  return 'secondary';
}

export default function IopolePage() {
  const { toast } = useToast();
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [query, setQuery] = useState('');
  const [invoices, setInvoices] = useState<IopoleInvoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [emitting, setEmitting] = useState(false);
  const [status, setStatus] = useState<IopoleStatus | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    setLoading(true);
    try {
      setInvoices(await listIopoleInvoices(query || undefined, 30));
    } catch (e) {
      toast({ title: 'Erreur Iopole', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    iopoleHealth().then(setHealthy);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onEmit(file: File) {
    setEmitting(true);
    try {
      const res = await emitIopoleInvoice(file);
      toast({ title: 'Facture envoyée à Iopole', description: `id: ${res.id}` });
      await refresh();
    } catch (e) {
      toast({ title: 'Échec émission', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setEmitting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function onStatus(id: string) {
    try {
      setStatus(await getIopoleStatus(id));
    } catch (e) {
      toast({ title: 'Erreur statut', description: (e as Error).message, variant: 'destructive' });
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Iopole — PDP</h1>
          <p className="text-sm text-muted-foreground">
            Émission et suivi des factures électroniques via la Plateforme Agréée Iopole.
          </p>
        </div>
        <Badge variant={healthy ? 'default' : healthy === false ? 'destructive' : 'secondary'}>
          {healthy === null ? 'Vérification…' : healthy ? 'Connecté' : 'Hors ligne'}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Émettre une facture</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.xml"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onEmit(f);
            }}
          />
          <Button onClick={() => fileRef.current?.click()} disabled={emitting}>
            {emitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            Choisir un Factur-X / UBL / CII
          </Button>
          <span className="text-xs text-muted-foreground">PDF (Factur-X) ou XML (UBL/CII), 50 Mo max.</span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Factures Iopole</CardTitle>
          <div className="flex items-center gap-2">
            <Input
              placeholder='Recherche (ex: invoice.state:"DELIVERED")'
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && refresh()}
              className="w-72"
            />
            <Button variant="outline" size="icon" onClick={refresh} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {loading ? 'Chargement…' : 'Aucune facture.'}
            </p>
          ) : (
            <div className="divide-y">
              {invoices.map((inv) => {
                const meta = (inv.raw as { metadata?: { state?: string; direction?: string } } | undefined)?.metadata;
                return (
                  <div key={inv.id} className="flex items-center justify-between py-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-xs">{inv.id}</div>
                      <div className="text-xs text-muted-foreground">
                        {meta?.direction ?? '—'} {inv.reference ? `· ${inv.reference}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={statusVariant(meta?.state)}>{meta?.state ?? '—'}</Badge>
                      <Button variant="ghost" size="sm" onClick={() => onStatus(inv.id)}>
                        <Send className="mr-1 h-3 w-3" /> Statut
                      </Button>
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
            <CardTitle className="text-base">
              Statut — <span className="font-mono text-xs">{status.id}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div>
              Lifecycle : <Badge variant={statusVariant(status.lifecycleStatus)}>{status.lifecycleStatus ?? '—'}</Badge>
            </div>
            <div className="text-sm text-muted-foreground">
              Historique :{' '}
              {status.history.length
                ? status.history.map((h) => h.code).filter(Boolean).join(' → ')
                : '—'}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

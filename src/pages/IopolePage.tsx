import { useEffect, useRef, useState } from 'react';
import { Download, FileText, Inbox, Loader2, RefreshCw, Search, Send, Upload } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import {
  downloadIopoleInvoice,
  emitIopoleInvoice,
  getIopoleHistory,
  getIopoleStatus,
  iopoleHealth,
  listIopoleInbox,
  listIopoleInvoices,
  markIopoleSeen,
  searchIopoleDirectory,
  type IopoleInvoice,
  type IopoleStatus,
  type IopoleStatusHistoryEntry,
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
  const [status, setStatus] = useState<(IopoleStatus & { detailed?: IopoleStatusHistoryEntry[] }) | null>(null);
  const [inbox, setInbox] = useState<{ notSeen: string[]; count: number } | null>(null);
  const [dirQuery, setDirQuery] = useState('');
  const [dirResults, setDirResults] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function err(e: unknown, title: string) {
    toast({ title, description: (e as Error).message, variant: 'destructive' });
  }

  async function refresh() {
    setLoading(true);
    try {
      setInvoices(await listIopoleInvoices(query || undefined, 30));
    } catch (e) {
      err(e, 'Erreur Iopole');
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
      err(e, 'Échec émission');
    } finally {
      setEmitting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function onStatus(id: string) {
    try {
      const [st, detailed] = await Promise.all([getIopoleStatus(id), getIopoleHistory(id).catch(() => [])]);
      setStatus({ ...st, detailed });
    } catch (e) {
      err(e, 'Erreur statut');
    }
  }

  async function onDownload(id: string, readable: boolean) {
    try {
      await downloadIopoleInvoice(id, readable);
    } catch (e) {
      err(e, 'Téléchargement indisponible');
    }
  }

  async function loadInbox() {
    try {
      setInbox(await listIopoleInbox());
    } catch (e) {
      err(e, 'Erreur réception');
    }
  }

  async function onMarkSeen(id: string) {
    try {
      await markIopoleSeen(id);
      toast({ title: 'Marquée comme vue', description: id });
      await loadInbox();
    } catch (e) {
      err(e, 'Échec markAsSeen');
    }
  }

  async function onDirectory() {
    if (!dirQuery.trim()) return;
    try {
      const r = await searchIopoleDirectory(dirQuery.trim());
      setDirResults(JSON.stringify(r, null, 2).slice(0, 4000));
    } catch (e) {
      err(e, 'Erreur annuaire');
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Iopole — PDP</h1>
          <p className="text-sm text-muted-foreground">
            Émission, réception et suivi des factures électroniques via la Plateforme Agréée Iopole.
          </p>
        </div>
        <Badge variant={healthy ? 'default' : healthy === false ? 'destructive' : 'secondary'}>
          {healthy === null ? 'Vérification…' : healthy ? 'Connecté' : 'Hors ligne'}
        </Badge>
      </div>

      {/* Émission */}
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

      {/* Réception (inbound, PULL) */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <Inbox className="h-4 w-4" /> Réception (factures reçues non vues)
          </CardTitle>
          <Button variant="outline" size="sm" onClick={loadInbox}>
            <RefreshCw className="mr-1 h-3 w-3" /> Charger
          </Button>
        </CardHeader>
        <CardContent>
          {inbox === null ? (
            <p className="text-sm text-muted-foreground">Cliquez « Charger » pour récupérer la boîte de réception.</p>
          ) : inbox.count === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune facture en attente (mode Push : statuts poussés par webhook).</p>
          ) : (
            <div className="divide-y">
              {inbox.notSeen.map((id) => (
                <div key={id} className="flex items-center justify-between py-2 text-sm">
                  <span className="truncate font-mono text-xs">{id}</span>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => onDownload(id, false)}>
                      <Download className="mr-1 h-3 w-3" /> Original
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => onMarkSeen(id)}>
                      Marquer vue
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Liste / recherche */}
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
                    <div className="flex items-center gap-1">
                      <Badge variant={statusVariant(meta?.state)}>{meta?.state ?? '—'}</Badge>
                      <Button variant="ghost" size="icon" title="Télécharger l'original" onClick={() => onDownload(inv.id, false)}>
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" title="Version lisible (Factur-X PDF)" onClick={() => onDownload(inv.id, true)}>
                        <FileText className="h-4 w-4" />
                      </Button>
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

      {/* Détail statut + historique */}
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
            <div className="text-sm">
              <div className="mb-1 text-muted-foreground">Historique des accusés :</div>
              {(status.detailed && status.detailed.length ? status.detailed : status.history).length ? (
                <ul className="space-y-1">
                  {(status.detailed && status.detailed.length ? status.detailed : status.history).map((h, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs">
                      <Badge variant="outline">{h.code ?? '—'}</Badge>
                      <span className="text-muted-foreground">{h.date ?? ''}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Annuaire */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="h-4 w-4" /> Annuaire (français)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Input
              placeholder="SIREN, SIRET ou nom du destinataire"
              value={dirQuery}
              onChange={(e) => setDirQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onDirectory()}
              className="w-80"
            />
            <Button variant="outline" onClick={onDirectory}>Rechercher</Button>
          </div>
          {dirResults && (
            <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">{dirResults}</pre>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

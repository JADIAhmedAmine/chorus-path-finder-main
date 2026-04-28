import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Building2, FileJson, Hash, Info } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatCurrency, formatDate, formatDateTime, getChorusRawStatusConfig } from '@/lib/status-utils';
import { getChorusLiveInvoiceDetail } from '@/lib/chorus/liveInvoiceDetails';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatOptionalDate(value: string | undefined, withTime = false): string {
  if (!value) {
    return '-';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  if (parsed.getTime() === 0) {
    return '-';
  }

  if (!withTime) {
    return formatDate(value);
  }

  const hasTime = parsed.getHours() !== 0
    || parsed.getMinutes() !== 0
    || parsed.getSeconds() !== 0
    || parsed.getMilliseconds() !== 0;

  return hasTime ? formatDateTime(value) : formatDate(value);
}

function formatRawValue(value: unknown): ReactNode {
  if (value === null || typeof value === 'undefined' || value === '') {
    return <span className="text-muted-foreground">-</span>;
  }

  if (typeof value === 'boolean') {
    return value ? 'Oui' : 'Non';
  }

  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }

  if (typeof value === 'string') {
    return value;
  }

  return (
    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2 text-xs">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export default function ChorusInvoiceDetail() {
  const { id } = useParams();
  const detail = getChorusLiveInvoiceDetail(id);

  if (!detail) {
    return (
      <div className="mx-auto max-w-3xl py-16">
        <Card>
          <CardHeader>
            <CardTitle>Facture Chorus non disponible</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <AlertDescription>
                Cette fiche n'est pas encore présente dans le navigateur. Recharge les factures Chorus depuis la liste,
                puis clique sur le N° facture.
              </AlertDescription>
            </Alert>
            <Button asChild>
              <Link to="/invoices">Retour aux factures</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { invoice, supplier, customer, raw, search } = detail;
  const rawEntries = isRecord(raw)
    ? Object.entries(raw).sort(([left], [right]) => left.localeCompare(right, 'fr'))
    : [];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/invoices"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold">{invoice.supplierInvoiceNumber}</h1>
              <ChorusStatusPill value={invoice.statusChorus || invoice.statusInternal} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {supplier?.legalName || `Fournisseur ${search.idFournisseur}`} → {customer?.legalName || 'Destinataire Chorus'}
            </p>
          </div>
        </div>
        <Button variant="outline" asChild>
          <Link to="/invoices">Liste des factures</Link>
        </Button>
      </div>

      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary"><Info className="mr-2 h-4 w-4" /> Synthèse</TabsTrigger>
          <TabsTrigger value="chorus"><Hash className="mr-2 h-4 w-4" /> Champs Chorus</TabsTrigger>
          <TabsTrigger value="json"><FileJson className="mr-2 h-4 w-4" /> JSON brut</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="mt-4">
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Informations facture</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <InfoRow label="N° facture fournisseur" value={invoice.supplierInvoiceNumber} />
                <InfoRow label="N° Chorus" value={invoice.chorusInvoiceNumber || '-'} />
                <InfoRow label="Date facture" value={formatOptionalDate(invoice.invoiceDate)} />
                <InfoRow label="Date dépôt / heure statut" value={formatOptionalDate(invoice.submittedAt, true)} />
                <InfoRow label="Dernier statut" value={formatOptionalDate(invoice.lastStatusSyncAt, true)} />
                <InfoRow label="Mode dépôt" value={invoice.depositMode || '-'} />
                <InfoRow label="Statut Chorus brut" value={invoice.statusChorus || '-'} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Montants</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <InfoRow label="Montant HT" value={formatCurrency(invoice.totalHt)} />
                <InfoRow label="TVA" value={formatCurrency(invoice.totalVat)} />
                <Separator />
                <InfoRow label="Montant TTC" value={formatCurrency(invoice.totalTtc)} bold />
                <InfoRow label="Devise" value={invoice.currencyCode} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Fournisseur</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <InfoRow label="Raison sociale" value={supplier?.legalName || '-'} />
                <InfoRow label="ID fournisseur Chorus" value={String(search.idFournisseur)} />
                <InfoRow label="Code fournisseur" value={supplier?.chorusSupplierCode || '-'} />
                <InfoRow label="SIRET" value={supplier?.siret || '-'} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center text-base"><Building2 className="mr-2 h-4 w-4" /> Destinataire public</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <InfoRow label="Raison sociale" value={customer?.legalName || '-'} />
                <InfoRow label="Code destinataire" value={customer?.codeDestinataire || '-'} />
                <InfoRow label="SIRET" value={customer?.siret || '-'} />
                <InfoRow label="Bon de commande" value={invoice.purchaseOrderNumber || '-'} />
                <InfoRow label="Marché" value={invoice.marketNumber || '-'} />
                <InfoRow label="Engagement" value={invoice.engagementNumber || '-'} />
              </CardContent>
            </Card>

            <Card className="xl:col-span-2">
              <CardHeader><CardTitle className="text-base">Contexte de récupération</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2 xl:grid-cols-5">
                <Metric label="Chargé le" value={formatOptionalDate(search.fetchedAt, true)} />
                <Metric label="Total Chorus" value={String(search.total)} />
                <Metric label="Lignes reçues" value={String(search.returned)} />
                <Metric label="Taille demandée" value={String(search.requestedPageSize)} />
                <Metric label="ID fournisseur" value={String(search.idFournisseur)} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="chorus" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tous les champs retournés par Chorus</CardTitle>
            </CardHeader>
            <CardContent>
              {rawEntries.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                  {rawEntries.map(([key, value]) => (
                    <div key={key} className="rounded-md border p-3">
                      <div className="mb-1 font-mono text-xs text-muted-foreground">{key}</div>
                      <div className="break-words text-sm">{formatRawValue(value)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">La réponse brute n'est pas un objet exploitable.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="json" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Réponse Chorus brute</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-4 text-xs">
                {JSON.stringify(raw, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function InfoRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={`text-right ${bold ? 'text-base font-semibold' : 'font-medium'}`}>{value}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-words font-medium">{value}</div>
    </div>
  );
}

function ChorusStatusPill({ value }: { value: string }) {
  const config = getChorusRawStatusConfig(value);

  return (
    <span className={`inline-flex max-w-[320px] items-center rounded px-2 py-1 text-sm font-medium ${config.bgClass} ${config.textClass}`}>
      <span className="mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: config.color }} />
      <span className="truncate">{config.label}</span>
    </span>
  );
}

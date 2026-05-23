import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Building2, CheckCircle2, FileJson, Hash, Info, Loader2, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useQueryClient } from '@tanstack/react-query';
import { ChorusBackendAutomationClient, ChorusBackendAutomationError } from '@/lib/chorus/backendAutomation';
import { loadChorusConfig, resolveChorusRuntimeConfig } from '@/lib/chorus/storage';
import { formatCurrency, formatDate, formatDateTime, getChorusRawStatusConfig } from '@/lib/status-utils';
import {
  dbQueryKeys,
  useInvoiceDetailQuery,
  usePublicCustomersQuery,
  useSuppliersQuery,
} from '@/lib/queries/db';
import type {
  ChorusRecycleInvoicePayload,
  ChorusTreatRejectionPayload,
} from '@/types/chorus';
import type { Invoice } from '@/types';

const SHOW_DEV_TOOLS = import.meta.env.VITE_SHOW_DEV_TOOLS === 'true';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstPresent(record: Record<string, unknown> | null | undefined, keys: string[]): unknown {
  if (!record) {
    return undefined;
  }

  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }

  return undefined;
}

function parsePositiveInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }

  if (typeof value === 'string' && value.trim()) {
    const digits = value.trim().replace(/\s/g, '');
    if (!/^\d+$/.test(digits)) {
      return undefined;
    }
    const parsed = Number(digits);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
  }

  return undefined;
}

function isRecycleStatus(value: string): boolean {
  return value.toUpperCase().includes('RECYCL');
}

function resolveChorusPaymentRequestId(invoice: Invoice, raw: Record<string, unknown> | Invoice | null): number | undefined {
  return parsePositiveInteger(
    firstPresent(isRecord(raw) ? raw : null, [
      'idDemandePaiement',
      'identifiantFactureCPP',
      'idFacture',
      'numeroFactureChorus',
      'numeroDemandePaiement',
      'numeroDp',
      'numeroDP',
    ]) ?? invoice.chorusInvoiceNumber,
  );
}

function extractResponseStatus(response: unknown): string | undefined {
  if (!isRecord(response)) {
    return undefined;
  }

  const status = response.statutFacture ?? response.statutCourant ?? response.statut;
  return typeof status === 'string' && status.trim() ? status.trim() : undefined;
}

interface RecycleFormState {
  codeDestinataire: string;
  commentaire: string;
}

const EMPTY_RECYCLE_FORM: RecycleFormState = {
  codeDestinataire: '',
  commentaire: '',
};

interface TreatRejectionFormState {
  motifRejet: string;
  cpltInfos: string;
}

const EMPTY_TREAT_REJECTION_FORM: TreatRejectionFormState = {
  motifRejet: '',
  cpltInfos: '',
};

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

export default function ChorusInvoiceDetail() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const invoiceQuery = useInvoiceDetailQuery(id);
  const suppliersQuery = useSuppliersQuery();
  const customersQuery = usePublicCustomersQuery();
  const [recycleForm, setRecycleForm] = useState<RecycleFormState>(EMPTY_RECYCLE_FORM);
  const [recycleLoading, setRecycleLoading] = useState(false);
  const [recycleError, setRecycleError] = useState<string | null>(null);
  const [recycleSuccess, setRecycleSuccess] = useState<string | null>(null);
  const [treatRejectionForm, setTreatRejectionForm] = useState<TreatRejectionFormState>(EMPTY_TREAT_REJECTION_FORM);
  const [treatRejectionLoading, setTreatRejectionLoading] = useState(false);
  const [treatRejectionError, setTreatRejectionError] = useState<string | null>(null);
  const [treatRejectionSuccess, setTreatRejectionSuccess] = useState<string | null>(null);

  const supplierById = useMemo(
    () => new Map((suppliersQuery.data ?? []).map((s) => [s.id, s])),
    [suppliersQuery.data],
  );
  const customerById = useMemo(
    () => new Map((customersQuery.data ?? []).map((c) => [c.id, c])),
    [customersQuery.data],
  );

  const isLoading = invoiceQuery.isLoading || suppliersQuery.isLoading || customersQuery.isLoading;
  const invoice = invoiceQuery.data ?? null;
  const supplier = invoice ? supplierById.get(invoice.supplierOrganizationId) : undefined;
  const customer = invoice ? customerById.get(invoice.publicCustomerId) : undefined;
  const raw = invoice && isRecord((invoice as { rawPayload?: unknown }).rawPayload)
    ? (invoice as { rawPayload?: Record<string, unknown> }).rawPayload
    : invoice;

  useEffect(() => {
    if (!invoice) {
      setRecycleForm(EMPTY_RECYCLE_FORM);
      setTreatRejectionForm(EMPTY_TREAT_REJECTION_FORM);
      return;
    }

    setRecycleForm({
      codeDestinataire: customer?.codeDestinataire || invoice.recipientChorusCode || '32242033407300',
      commentaire: 'Traitement recyclage : correction des données d’acheminement.',
    });
    setTreatRejectionForm({
      motifRejet: invoice.statusReasonCode || invoice.statusReasonLabel || 'TRAITE',
      cpltInfos: 'Rejet traité depuis Chorus Pilot.',
    });
    setRecycleError(null);
    setRecycleSuccess(null);
    setTreatRejectionError(null);
    setTreatRejectionSuccess(null);
  }, [
    customer?.codeDestinataire,
    invoice?.id,
    invoice?.recipientChorusCode,
    invoice?.serviceChorusCode,
    invoice?.statusReasonCode,
    invoice?.statusReasonLabel,
  ]);

  if (isLoading) {
    return (
      <div className="mx-auto flex max-w-3xl items-center justify-center py-16">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement de la facture...
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="mx-auto max-w-3xl py-16">
        <Card>
          <CardHeader>
            <CardTitle>Facture Chorus introuvable</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <AlertDescription>
                Aucune facture {id ? <code>{id}</code> : ''} dans la base. Synchronisez les factures Chorus depuis la liste.
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

  const rawStatus = (invoice.statusChorus || invoice.statusInternal).toUpperCase();
  const isRecyclable = isRecycleStatus(rawStatus);
  const isRejected = invoice.statusInternal === 'REJECTED_BUSINESS'
    || invoice.statusInternal === 'REJECTED_TECHNICAL'
    || rawStatus.includes('REJET')
    || rawStatus.includes('REFUS');
  const rawEntries = isRecord(raw)
    ? Object.entries(raw).sort(([left], [right]) => left.localeCompare(right, 'fr'))
    : [];
  const customerLabel = customer?.legalName || invoice.recipientChorusName || 'Destinataire Chorus';
  const customerSiret = customer?.siret || invoice.recipientChorusCode || '';
  const customerCode = customer?.codeDestinataire || invoice.recipientChorusCode || '';
  const chorusPaymentRequestId = resolveChorusPaymentRequestId(invoice, raw);

  async function handleRecycleInvoice() {
    setRecycleLoading(true);
    setRecycleError(null);
    setRecycleSuccess(null);

    try {
      const config = resolveChorusRuntimeConfig(loadChorusConfig());
      const identifiantFactureCPP = chorusPaymentRequestId;
      const codeDestinataire = recycleForm.codeDestinataire.trim();

      if (!identifiantFactureCPP) {
        throw new Error('Identifiant facture CPP introuvable dans la facture synchronisée.');
      }
      if (!codeDestinataire) {
        throw new Error('Code destinataire obligatoire pour recycler la facture.');
      }

      const payload: ChorusRecycleInvoicePayload = {
        commentaire: recycleForm.commentaire.trim() || undefined,
        destinataire: {
          codeDestinataire,
        },
        identifiantFactureCPP,
      };

      const result = await new ChorusBackendAutomationClient(config).recycleInvoice(payload);
      const nextStatus = extractResponseStatus(result.response);
      const statusMessage = nextStatus ? `Statut Chorus retourné : ${nextStatus}` : 'Recyclage envoyé à Chorus.';
      setRecycleSuccess(statusMessage);

      queryClient.setQueryData<Invoice | null>(dbQueryKeys.invoiceDetail(invoice.id), (current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          statusChorus: nextStatus ?? current.statusChorus,
          lastStatusSyncAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      });
      void queryClient.invalidateQueries({ queryKey: ['db', 'invoices'] });
    } catch (error) {
      const message = error instanceof ChorusBackendAutomationError || error instanceof Error
        ? error.message
        : 'Recyclage Chorus impossible.';
      setRecycleError(message);
    } finally {
      setRecycleLoading(false);
    }
  }

  async function handleTreatRejection() {
    setTreatRejectionLoading(true);
    setTreatRejectionError(null);
    setTreatRejectionSuccess(null);

    try {
      const idDemandePaiement = chorusPaymentRequestId;
      const motifRejet = treatRejectionForm.motifRejet.trim();

      if (!idDemandePaiement) {
        throw new Error('Identifiant demande de paiement introuvable dans la facture synchronisée.');
      }
      if (!motifRejet) {
        throw new Error('Motif de traitement du rejet obligatoire.');
      }

      const payload: ChorusTreatRejectionPayload = {
        cpltInfos: treatRejectionForm.cpltInfos.trim() || undefined,
        listeDemandePaiement: [{ idDemandePaiement }],
        motifRejet,
      };

      const config = resolveChorusRuntimeConfig(loadChorusConfig());
      await new ChorusBackendAutomationClient(config).treatRejection(payload);
      setTreatRejectionSuccess('Rejet marqué comme traité côté Chorus.');

      queryClient.setQueryData<Invoice | null>(dbQueryKeys.invoiceDetail(invoice.id), (current) => {
        if (!current) {
          return current;
        }
        const now = new Date().toISOString();
        return {
          ...current,
          rejectionProcessed: true,
          lastStatusSyncAt: now,
          updatedAt: now,
        };
      });
      void queryClient.invalidateQueries({ queryKey: ['db', 'invoices'] });
    } catch (error) {
      const message = error instanceof ChorusBackendAutomationError || error instanceof Error
        ? error.message
        : 'Traitement du rejet impossible.';
      setTreatRejectionError(message);
    } finally {
      setTreatRejectionLoading(false);
    }
  }

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
              {supplier?.legalName || invoice.supplierChorusName || 'Fournisseur'} → {customerLabel}
            </p>
          </div>
        </div>
        <Button variant="outline" asChild>
          <Link to="/invoices">Liste des factures</Link>
        </Button>
      </div>

      {isRejected && invoice.statusReasonLabel && (
        <Alert className="border-destructive/30 bg-destructive/5">
          <AlertDescription>
            <p className="font-medium text-destructive">
              {invoice.statusReasonCode ? `Motif de rejet : ${invoice.statusReasonCode}` : 'Motif de rejet'}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{invoice.statusReasonLabel}</p>
          </AlertDescription>
        </Alert>
      )}

      {isRejected && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center text-base">
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Traiter le rejet
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {invoice.rejectionProcessed && !treatRejectionSuccess && (
              <Alert className="border-success/30 bg-success/5">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <AlertDescription>Ce rejet est déjà marqué comme traité dans les données synchronisées.</AlertDescription>
              </Alert>
            )}
            {treatRejectionError && (
              <Alert variant="destructive">
                <AlertDescription>{treatRejectionError}</AlertDescription>
              </Alert>
            )}
            {treatRejectionSuccess && (
              <Alert className="border-success/30 bg-success/5">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <AlertDescription>{treatRejectionSuccess}</AlertDescription>
              </Alert>
            )}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="treat-rejection-payment-id">ID demande paiement</Label>
                <Input id="treat-rejection-payment-id" value={chorusPaymentRequestId ? String(chorusPaymentRequestId) : ''} disabled />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="treat-rejection-motif">Motif rejet</Label>
                <Input
                  id="treat-rejection-motif"
                  value={treatRejectionForm.motifRejet}
                  onChange={(event) => setTreatRejectionForm((current) => ({ ...current, motifRejet: event.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="treat-rejection-info">Complément d’information</Label>
              <Textarea
                id="treat-rejection-info"
                value={treatRejectionForm.cpltInfos}
                onChange={(event) => setTreatRejectionForm((current) => ({ ...current, cpltInfos: event.target.value }))}
                rows={3}
              />
            </div>
            <div className="flex justify-end">
              <Button
                onClick={() => void handleTreatRejection()}
                disabled={treatRejectionLoading || !chorusPaymentRequestId || invoice.rejectionProcessed === true}
              >
                {treatRejectionLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                Marquer le rejet traité
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isRecyclable && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center text-base">
              <RefreshCw className="mr-2 h-4 w-4" />
              Traiter le recyclage
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {recycleError && (
              <Alert variant="destructive">
                <AlertDescription>{recycleError}</AlertDescription>
              </Alert>
            )}
            {recycleSuccess && (
              <Alert className="border-success/30 bg-success/5">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <AlertDescription>{recycleSuccess}</AlertDescription>
              </Alert>
            )}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="recycle-cpp-id">Identifiant CPP</Label>
                <Input id="recycle-cpp-id" value={chorusPaymentRequestId ? String(chorusPaymentRequestId) : ''} disabled />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="recycle-destinataire">Code destinataire</Label>
                <Input
                  id="recycle-destinataire"
                  value={recycleForm.codeDestinataire}
                  onChange={(event) => setRecycleForm((current) => ({ ...current, codeDestinataire: event.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="recycle-comment">Commentaire</Label>
              <Textarea
                id="recycle-comment"
                value={recycleForm.commentaire}
                onChange={(event) => setRecycleForm((current) => ({ ...current, commentaire: event.target.value }))}
                rows={3}
              />
            </div>
            <div className="flex justify-end">
              <Button
                onClick={() => void handleRecycleInvoice()}
                disabled={recycleLoading || !chorusPaymentRequestId}
              >
                {recycleLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Recycler la facture
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary"><Info className="mr-2 h-4 w-4" /> Synthèse</TabsTrigger>
          {SHOW_DEV_TOOLS && <TabsTrigger value="chorus"><Hash className="mr-2 h-4 w-4" /> Champs Chorus</TabsTrigger>}
          {SHOW_DEV_TOOLS && <TabsTrigger value="json"><FileJson className="mr-2 h-4 w-4" /> JSON brut</TabsTrigger>}
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
                {invoice.statusReasonLabel && <InfoRow label="Motif de rejet" value={invoice.statusReasonLabel} />}
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
                <InfoRow label="Raison sociale" value={supplier?.legalName || invoice.supplierChorusName || '-'} />
                <InfoRow label="ID fournisseur Chorus" value={supplier?.chorusSupplierCode || '-'} />
                <InfoRow label="Code fournisseur" value={invoice.supplierChorusCode || supplier?.chorusSupplierCode || '-'} />
                <InfoRow label="SIRET" value={supplier?.siret || '-'} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="flex items-center"><Building2 className="mr-2 h-4 w-4" /> Destinataire public</span>
                  {(customerSiret || customerCode) && (
                    <Button variant="link" size="sm" asChild className="h-auto p-0">
                      <Link to={`/references/customers?siret=${encodeURIComponent(customerSiret || customerCode)}`}>
                        Voir la fiche client
                      </Link>
                    </Button>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <InfoRow label="Raison sociale" value={customerLabel} />
                <InfoRow label="Code destinataire" value={customerCode || '-'} />
                <InfoRow label="ID Chorus destinataire" value={invoice.recipientChorusId || '-'} />
                <InfoRow label="SIRET" value={customerSiret || '-'} />
                <InfoRow label="Bon de commande" value={invoice.purchaseOrderNumber || '-'} />
                <InfoRow label="Marché" value={invoice.marketNumber || '-'} />
                <InfoRow label="Engagement" value={invoice.engagementNumber || '-'} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Service exécutant</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <InfoRow label="Nom" value={invoice.serviceChorusName || '-'} />
                <InfoRow label="Code" value={invoice.serviceChorusCode || '-'} />
                <InfoRow label="ID Chorus" value={invoice.serviceChorusId || '-'} />
              </CardContent>
            </Card>

            <Card className="xl:col-span-2">
              <CardHeader><CardTitle className="text-base">Métadonnées Chorus</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                <InfoRow label="Type demande paiement" value={invoice.chorusInvoiceType || '-'} />
                <InfoRow label="Code fournisseur Chorus" value={invoice.supplierChorusCode || '-'} />
                <InfoRow label="Désignation fournisseur" value={invoice.supplierChorusName || '-'} />
                <InfoRow label="Montant à payer" value={invoice.amountToPay !== undefined ? formatCurrency(invoice.amountToPay) : '-'} />
                <InfoRow label="Créateur" value={invoice.createdByName || '-'} />
                <InfoRow label="Date / heure du statut" value={formatOptionalDate(invoice.statusChangedAt, true)} />
                <InfoRow label="Pièces jointes" value={invoice.attachmentCount !== undefined ? String(invoice.attachmentCount) : '-'} />
                <InfoRow label="Rejet traité" value={invoice.rejectionProcessed === undefined ? '-' : invoice.rejectionProcessed ? 'Oui' : 'Non'} />
                <InfoRow label="Référence externe" value={invoice.externalReference || '-'} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {SHOW_DEV_TOOLS && (
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
        )}

        {SHOW_DEV_TOOLS && (
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
        )}
      </Tabs>
    </div>
  );
}

function formatRawValue(value: unknown) {
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

function InfoRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={`text-right ${bold ? 'text-base font-semibold' : 'font-medium'}`}>{value}</span>
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

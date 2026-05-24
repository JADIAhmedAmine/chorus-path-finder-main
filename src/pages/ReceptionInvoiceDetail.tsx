import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, FileJson, Loader2, Receipt, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ProcessReceivedInvoiceCard } from '@/components/chorus/ProcessReceivedInvoiceCard';
import { ChorusBackendAutomationClient } from '@/lib/chorus/backendAutomation';
import { loadChorusConfig, resolveChorusRuntimeConfig } from '@/lib/chorus/storage';
import { useInvoicesQuery } from '@/lib/queries/db';
import type { Invoice } from '@/types';
import type { ReceptionConsultError, ReceptionInvoice } from '@/types/chorus';
import { InvoiceDetailPanel } from './ReceptionProcessing';

type DetailLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; invoice: ReceptionInvoice }
  | { status: 'error'; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asPositiveInteger(value: unknown): number | null {
  if (typeof value === 'boolean') return null;
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function emptyReceptionInvoice(identifier: number): ReceptionInvoice {
  return {
    identifiantFactureCPP: identifier,
    numeroFacture: null,
    statutFacture: null,
    modeDepot: null,
    rejetTraite: null,
    commentaire: null,
    cadreDeFacturation: null,
    fournisseur: null,
    destinataire: null,
    dates: {
      dateFacture: null,
      dateDepot: null,
      dateEcheancePaiement: null,
      dateCreationFacture: null,
    },
    montants: {
      ht: 0,
      tva: 0,
      ttc: 0,
      aPayer: 0,
      devise: 'EUR',
      remiseGlobaleTtc: 0,
      ttcAvantRemiseGlobale: null,
      libelleDevise: null,
    },
    references: {
      numeroBonCommande: null,
      numeroMarche: null,
      numeroDpMandat: null,
      numeroFactureOrigine: null,
      motifExonerationTva: null,
      modePaiement: null,
      typeFacture: null,
      typeTva: null,
      tailleTotalePiecesJointes: null,
    },
    piecesJointes: [],
    lignesDePoste: [],
    recapitulatifTva: [],
  };
}

function resolveInvoiceIdentifier(invoice: Invoice): number | null {
  const raw = isRecord(invoice.rawPayload) ? invoice.rawPayload : {};
  const candidates: unknown[] = [
    invoice.chorusInvoiceNumber,
    raw.identifiantFactureCPP,
    raw.idFactureCPP,
    raw.idFacture,
    raw.identifiantDemandePaiementCPP,
    raw.idDemandePaiementCPP,
    raw.idDemandePaiement,
    raw.identifiantDemandePaiement,
    invoice.id.startsWith('chorus-') ? invoice.id.slice('chorus-'.length) : invoice.id,
  ];
  for (const candidate of candidates) {
    const parsed = asPositiveInteger(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function storedReceptionInvoice(invoice: Invoice | undefined, identifier: number): ReceptionInvoice | null {
  const rawPayload = invoice?.rawPayload;
  const raw = isRecord(rawPayload) ? rawPayload : null;
  const stored = raw?.receptionNormalized;
  if (!isRecord(stored)) return null;

  const base = emptyReceptionInvoice(identifier);
  const detail = stored as unknown as ReceptionInvoice;
  return {
    ...base,
    ...detail,
    identifiantFactureCPP: asPositiveInteger(detail.identifiantFactureCPP) ?? identifier,
    fournisseur: isRecord(stored.fournisseur) ? detail.fournisseur : null,
    destinataire: isRecord(stored.destinataire) ? detail.destinataire : null,
    dates: isRecord(stored.dates) ? { ...base.dates, ...detail.dates } : base.dates,
    montants: isRecord(stored.montants) ? { ...base.montants, ...detail.montants } : base.montants,
    references: isRecord(stored.references) ? { ...base.references, ...detail.references } : base.references,
    piecesJointes: Array.isArray(stored.piecesJointes) ? detail.piecesJointes : [],
    lignesDePoste: Array.isArray(stored.lignesDePoste) ? detail.lignesDePoste : [],
    recapitulatifTva: Array.isArray(stored.recapitulatifTva) ? detail.recapitulatifTva : [],
  };
}

function errorMessageFromConsult(result: ReceptionConsultError): string {
  return result.human_message || result.raw_message || 'Détail réception Chorus indisponible.';
}

export default function ReceptionInvoiceDetail() {
  const { id } = useParams();
  const identifier = asPositiveInteger(id);
  const invoicesQuery = useInvoicesQuery({ pageSize: 500 });
  const [loadState, setLoadState] = useState<DetailLoadState>({ status: 'idle' });

  const dbInvoice = useMemo(
    () => (invoicesQuery.data?.items ?? []).find((invoice) => resolveInvoiceIdentifier(invoice) === identifier),
    [identifier, invoicesQuery.data?.items],
  );
  const cachedInvoice = useMemo(
    () => (identifier ? storedReceptionInvoice(dbInvoice, identifier) : null),
    [dbInvoice, identifier],
  );
  const displayedInvoice = cachedInvoice ?? (loadState.status === 'success' ? loadState.invoice : null);
  const dbRawPayload = dbInvoice?.rawPayload;
  const apiRawDetail = isRecord(dbRawPayload) ? dbRawPayload.receptionDetail : null;

  useEffect(() => {
    if (!identifier || invoicesQuery.isLoading || cachedInvoice || loadState.status !== 'idle') return;

    let cancelled = false;
    setLoadState({ status: 'loading' });
    const config = resolveChorusRuntimeConfig(loadChorusConfig());
    void new ChorusBackendAutomationClient(config)
      .consultInvoiceForReception(identifier)
      .then((result) => {
        if (cancelled) return;
        if (result.ok && result.success) {
          setLoadState({ status: 'success', invoice: result.facture });
          void invoicesQuery.refetch();
          return;
        }
        setLoadState({ status: 'error', error: errorMessageFromConsult(result) });
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadState({
          status: 'error',
          error: error instanceof Error ? error.message : 'Détail réception Chorus indisponible.',
        });
      });

    return () => {
      cancelled = true;
    };
  }, [cachedInvoice, identifier, invoicesQuery, loadState.status]);

  if (!identifier) {
    return (
      <div className="mx-auto max-w-3xl py-16">
        <Card>
          <CardHeader><CardTitle>Identifiant réception invalide</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <AlertDescription>L’identifiant de facture CPP est absent ou invalide.</AlertDescription>
            </Alert>
            <Button asChild><Link to="/invoices/reception">Retour aux factures reçues</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (invoicesQuery.isLoading || loadState.status === 'loading') {
    return (
      <div className="mx-auto flex max-w-3xl items-center justify-center py-16">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement du détail réception...
      </div>
    );
  }

  if (!displayedInvoice) {
    return (
      <div className="mx-auto max-w-3xl py-16">
        <Card>
          <CardHeader><CardTitle>Détail réception indisponible</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Alert variant="destructive">
              <AlertDescription>
                {loadState.status === 'error' ? loadState.error : 'Aucun détail réception retourné pour cette facture.'}
              </AlertDescription>
            </Alert>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link to="/invoices/reception"><ArrowLeft className="mr-2 h-4 w-4" /> Retour</Link>
              </Button>
              <Button onClick={() => setLoadState({ status: 'idle' })}>
                <RefreshCw className="mr-2 h-4 w-4" /> Réessayer
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/invoices/reception"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <Receipt className="h-5 w-5 text-primary" />
              <h1 className="text-2xl font-semibold">{displayedInvoice.numeroFacture ?? `Facture ${identifier}`}</h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Identifiant CPP {identifier}
            </p>
          </div>
        </div>
        <Button variant="outline" asChild>
          <Link to="/invoices/reception">Factures reçues</Link>
        </Button>
      </div>

      <Alert>
        <FileJson className="h-4 w-4" />
        <AlertTitle>{cachedInvoice ? 'Détail depuis PostgreSQL' : 'Détail chargé depuis Chorus'}</AlertTitle>
        <AlertDescription>
          {cachedInvoice
            ? 'Le détail réception est lu depuis le cache PostgreSQL.'
            : 'Le détail réception a été récupéré via l’API et sera conservé en PostgreSQL.'}
        </AlertDescription>
      </Alert>

      <ProcessReceivedInvoiceCard
        identifiantFactureCPP={identifier}
        currentStatus={displayedInvoice.statutFacture}
        onProcessed={() => {
          void invoicesQuery.refetch();
        }}
      />

      <InvoiceDetailPanel invoice={displayedInvoice} />

      {isRecord(apiRawDetail) && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Retour API réception stocké</CardTitle></CardHeader>
          <CardContent>
            <pre className="max-h-[420px] overflow-auto rounded-md border bg-muted/30 p-3 text-xs">
              {JSON.stringify(apiRawDetail, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

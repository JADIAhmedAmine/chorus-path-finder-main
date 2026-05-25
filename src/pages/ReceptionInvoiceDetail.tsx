import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, FileJson, History, Loader2, Receipt, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ProcessReceivedInvoiceCard } from '@/components/chorus/ProcessReceivedInvoiceCard';
import { ChorusBackendAutomationClient } from '@/lib/chorus/backendAutomation';
import { loadChorusConfig, resolveChorusRuntimeConfig } from '@/lib/chorus/storage';
import { useInvoicesQuery } from '@/lib/queries/db';
import type { Invoice } from '@/types';
import type {
  ChorusInvoiceHistoryAction,
  ChorusInvoiceHistoryPayload,
  ChorusInvoiceHistoryResponse,
  ChorusInvoiceHistoryStatus,
  ReceptionConsultError,
  ReceptionInvoice,
} from '@/types/chorus';
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

function buildInvoiceHistoryPayload(idFacture: number): ChorusInvoiceHistoryPayload {
  return {
    idFacture,
    nbResultatsMaximum: 10,
    paramRechercheHistoActionsUtilisateurs: {
      nbResultatsParPageListeHistoAction: 10,
      pageResultatDemandeeListeHistoAction: 1,
      triColonneListeHistoAction: 'HistoActionDateHeure',
      triSensListeHistoAction: 'Descendant',
    },
    paramRechercheHistoEvenementsComplementaires: {
      nbResultatsParPageListeHistoEvenement: 10,
      pageResultatDemandeeListeHistoEvenement: 1,
      triColonneListeHistoEvenement: 'EvenementLibelle',
      triSensListeHistoEvenement: 'Descendant',
    },
    paramRechercheHistoStatuts: {
      nbResultatsParPageListeHistoStatut: 10,
      pageResultatDemandeeListeHistoStatut: 1,
      triColonneListeHistoStatut: 'HistoStatutDatePassage',
      triSensListeHistoStatut: 'Descendant',
    },
  };
}

function parseChorusHistoryTimestamp(value?: string): number {
  if (!value) return 0;
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(trimmed);
  if (match) {
    const [, year, month, day, hour = '0', minute = '0', second = '0'] = match;
    return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)).getTime();
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortHistoryStatuses(items: ChorusInvoiceHistoryStatus[]): ChorusInvoiceHistoryStatus[] {
  return [...items].sort((left, right) =>
    parseChorusHistoryTimestamp(right.histoStatutDatePassage)
      - parseChorusHistoryTimestamp(left.histoStatutDatePassage)
      || (right.histoStatutId ?? 0) - (left.histoStatutId ?? 0),
  );
}

function sortHistoryActions(items: ChorusInvoiceHistoryAction[]): ChorusInvoiceHistoryAction[] {
  return [...items].sort((left, right) =>
    parseChorusHistoryTimestamp(right.histoActionDateHeure)
      - parseChorusHistoryTimestamp(left.histoActionDateHeure)
      || (right.histoActionId ?? 0) - (left.histoActionId ?? 0),
  );
}

function formatHistoryActor(first?: string, last?: string, email?: string): string {
  return [first, last, email].filter((value) => value && value.trim()).join(' ') || '—';
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
  const refreshStoredInvoice = useCallback(() => {
    void invoicesQuery.refetch();
  }, [invoicesQuery.refetch]);

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
          refreshStoredInvoice();
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
  }, [cachedInvoice, identifier, invoicesQuery.isLoading, loadState.status, refreshStoredInvoice]);

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
        onProcessed={refreshStoredInvoice}
      />

      <ReceptionHistoryCard identifiantFactureCPP={identifier} onHistorySynced={refreshStoredInvoice} />

      <InvoiceDetailPanel invoice={displayedInvoice} identifiantFactureCPP={identifier} />

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

function ReceptionHistoryCard({
  identifiantFactureCPP,
  onHistorySynced,
}: {
  identifiantFactureCPP: number;
  onHistorySynced?: () => void;
}) {
  const [historyResponse, setHistoryResponse] = useState<ChorusInvoiceHistoryResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const config = resolveChorusRuntimeConfig(loadChorusConfig());
      const result = await new ChorusBackendAutomationClient(config).getInvoiceHistory(
        buildInvoiceHistoryPayload(identifiantFactureCPP),
      );
      setHistoryResponse(result.response ?? null);
      if (result.historyStatusPersisted) {
        onHistorySynced?.();
      }
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'Historique Chorus indisponible.');
    } finally {
      setHistoryLoading(false);
    }
  }, [identifiantFactureCPP, onHistorySynced]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const historyStatuses = Array.isArray(historyResponse?.historiquesDesStatuts?.histoStatut)
    ? sortHistoryStatuses(historyResponse.historiquesDesStatuts.histoStatut)
    : [];
  const historyActions = Array.isArray(historyResponse?.historiquesDesActionsUtilisateurs?.histoAction)
    ? sortHistoryActions(historyResponse.historiquesDesActionsUtilisateurs.histoAction)
    : [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="flex items-center">
            <History className="mr-2 h-4 w-4" />
            Historique Chorus
          </span>
          <Button variant="outline" size="sm" onClick={() => void loadHistory()} disabled={historyLoading}>
            {historyLoading
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <RefreshCw className="mr-2 h-4 w-4" />}
            Actualiser
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {historyError && (
          <Alert variant="destructive">
            <AlertDescription>{historyError}</AlertDescription>
          </Alert>
        )}
        {historyResponse && (
          <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-4">
            <HistoryInfo label="Statut courant" value={historyResponse.statutCourantCode || '—'} />
            <HistoryInfo label="Dernière action" value={historyResponse.derniereAction?.derniereActionCode || '—'} />
            <HistoryInfo label="N° facture" value={historyResponse.numeroFacture || '—'} />
            <HistoryInfo
              label="Retour API"
              value={`${historyResponse.codeRetour ?? ''} ${historyResponse.libelle ?? ''}`.trim() || '—'}
            />
          </div>
        )}
        {historyLoading && !historyResponse ? (
          <p className="text-sm text-muted-foreground">Chargement de l’historique...</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Passages de statut</h3>
              <HistoryStatusTable items={historyStatuses} />
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Actions utilisateur</h3>
              <HistoryActionTable items={historyActions} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function HistoryInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 break-words font-medium">{value}</p>
    </div>
  );
}

function HistoryStatusTable({ items }: { items: ChorusInvoiceHistoryStatus[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Aucun statut retourné.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b bg-muted/30 text-left">
            <th className="p-3 font-medium">Date</th>
            <th className="p-3 font-medium">Statut</th>
            <th className="p-3 font-medium">Utilisateur</th>
            <th className="p-3 font-medium">Commentaire</th>
          </tr>
        </thead>
        <tbody>
          {items.map((status, index) => (
            <tr key={`${status.histoStatutId ?? index}-${status.histoStatutCode ?? 'statut'}`} className="border-b last:border-0">
              <td className="whitespace-nowrap p-3">{status.histoStatutDatePassage || '—'}</td>
              <td className="p-3 font-medium">{status.histoStatutCode || '—'}</td>
              <td className="p-3">{formatHistoryActor(status.histoStatutUtilisateurPrenom, status.histoStatutUtilisateurNom, status.histoStatutUtilisateurEmail)}</td>
              <td className="max-w-[280px] whitespace-normal break-words p-3 text-muted-foreground">{status.histoStatutCommentaire || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoryActionTable({ items }: { items: ChorusInvoiceHistoryAction[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Aucune action utilisateur retournée.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[540px] text-sm">
        <thead>
          <tr className="border-b bg-muted/30 text-left">
            <th className="p-3 font-medium">Date</th>
            <th className="p-3 font-medium">Action</th>
            <th className="p-3 font-medium">Utilisateur</th>
          </tr>
        </thead>
        <tbody>
          {items.map((action, index) => (
            <tr key={`${action.histoActionId ?? index}-${action.histoActionCode ?? 'action'}`} className="border-b last:border-0">
              <td className="whitespace-nowrap p-3">{action.histoActionDateHeure || '—'}</td>
              <td className="p-3 font-medium">{action.histoActionCode || '—'}</td>
              <td className="p-3">{formatHistoryActor(action.histoActionUtilisateurPrenom, action.histoActionUtilisateurNom, action.histoActionUtilisateurEmail)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

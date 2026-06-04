import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Building2, CheckCircle2, FileJson, Hash, History, Info, Loader2, RefreshCw, UserCheck } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useQueryClient } from '@tanstack/react-query';
import { ChorusBackendAutomationClient, ChorusBackendAutomationError } from '@/lib/chorus/backendAutomation';
import { loadChorusConfig, resolveChorusRuntimeConfig } from '@/lib/chorus/storage';
import { formatCurrency, formatDate, formatDateTime, getChorusRawStatusConfig } from '@/lib/status-utils';
import { CompleteSuspendedInvoiceCard } from '@/components/chorus/CompleteSuspendedInvoiceCard';
import { InvoiceActionGuide } from '@/components/chorus/InvoiceActionGuide';
import { InvoiceContextBadge } from '@/components/chorus/InvoiceContextBadge';
import { InvoiceDownloadMenu } from '@/components/chorus/InvoiceDownloadMenu';
import { SubmissionStateInsight } from '@/components/chorus/SubmissionStateInsight';
import {
  dbQueryKeys,
  useInvoiceDetailQuery,
  usePublicCustomersQuery,
  useSuppliersQuery,
} from '@/lib/queries/db';
import { toDisplayInvoiceFromInvoice } from '@/lib/chorus/invoiceDisplay';
import type {
  ChorusCorrectValidatorPayload,
  ChorusRecycleInvoicePayload,
  ChorusInvoiceHistoryAction,
  ChorusInvoiceHistoryPayload,
  ChorusInvoiceHistoryResponse,
  ChorusInvoiceHistoryStatus,
} from '@/types/chorus';
import type { Invoice } from '@/types';
import type { ChorusInvoiceType, ChorusPaymentMode, ChorusVatType } from '@/lib/chorus/types';

const SHOW_DEV_TOOLS = import.meta.env.VITE_SHOW_DEV_TOOLS === 'true';
const PAYMENT_MODES: ChorusPaymentMode[] = ['CHEQUE', 'ESPECE', 'VIREMENT', 'PRELEVEMENT', 'AUTRE', 'REPORT'];
const INVOICE_TYPES: ChorusInvoiceType[] = ['FACTURE', 'AVOIR'];
const VAT_TYPES: ChorusVatType[] = ['TVA_SUR_DEBIT', 'TVA_SUR_ENCAISSEMENT', 'EXONERATION', 'SANS_TVA'];

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

function firstString(record: Record<string, unknown> | null | undefined, keys: string[], fallback = ''): string {
  const value = firstPresent(record, keys);
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function nestedRecord(record: Record<string, unknown> | null | undefined, key: string): Record<string, unknown> | null {
  const value = record?.[key];
  return isRecord(value) ? value : null;
}

function pickPaymentMode(value: string | undefined, fallback: ChorusPaymentMode): ChorusPaymentMode {
  const normalized = value?.trim().toUpperCase() as ChorusPaymentMode | undefined;
  return normalized && PAYMENT_MODES.includes(normalized) ? normalized : fallback;
}

function pickInvoiceType(value: string | undefined, fallback: ChorusInvoiceType): ChorusInvoiceType {
  const normalized = value?.trim().toUpperCase() as ChorusInvoiceType | undefined;
  return normalized && INVOICE_TYPES.includes(normalized) ? normalized : fallback;
}

function pickVatType(value: string | undefined, fallback: ChorusVatType): ChorusVatType {
  const normalized = value?.trim().toUpperCase() as ChorusVatType | undefined;
  return normalized && VAT_TYPES.includes(normalized) ? normalized : fallback;
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

function resolveChorusHistoryInvoiceId(invoice: Invoice, raw: Record<string, unknown> | Invoice | null): number | undefined {
  return parsePositiveInteger(
    firstPresent(isRecord(raw) ? raw : null, [
      'idFacture',
      'identifiantFactureCPP',
      'idDemandePaiement',
      'numeroFactureChorus',
      'numeroDemandePaiement',
      'numeroDp',
      'numeroDP',
    ]) ?? invoice.chorusInvoiceNumber,
  );
}

function resolveValidatorStructureId(raw: Record<string, unknown> | Invoice | null): number | undefined {
  return parsePositiveInteger(
    firstPresent(isRecord(raw) ? raw : null, [
      'idStructureValideur',
      'idStructureCPPValideur',
      'idStructure',
      'idValideur',
    ]),
  );
}

function resolveValidatorStructureIdentifier(raw: Record<string, unknown> | Invoice | null, fallback?: string): string {
  const value = firstPresent(isRecord(raw) ? raw : null, [
    'identifiantStructureValideur',
    'codeStructureValideur',
    'siretStructureValideur',
    'siretValideur',
  ]);
  return typeof value === 'string' && value.trim() ? value.trim() : fallback?.trim() || '';
}

function isWrongValidatorRejectionText(...values: Array<string | undefined>): boolean {
  const text = values
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
  return text.includes('VALIDEUR');
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
  if (!value) {
    return 0;
  }

  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(trimmed);
  if (match) {
    const [, year, month, day, hour = '0', minute = '0', second = '0'] = match;
    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ).getTime();
  }

  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortHistoryStatuses(items: ChorusInvoiceHistoryStatus[]): ChorusInvoiceHistoryStatus[] {
  return [...items].sort((left, right) => {
    const dateDiff = parseChorusHistoryTimestamp(right.histoStatutDatePassage)
      - parseChorusHistoryTimestamp(left.histoStatutDatePassage);
    if (dateDiff !== 0) {
      return dateDiff;
    }
    return (right.histoStatutId ?? 0) - (left.histoStatutId ?? 0);
  });
}

function sortHistoryActions(items: ChorusInvoiceHistoryAction[]): ChorusInvoiceHistoryAction[] {
  return [...items].sort((left, right) => {
    const dateDiff = parseChorusHistoryTimestamp(right.histoActionDateHeure)
      - parseChorusHistoryTimestamp(left.histoActionDateHeure);
    if (dateDiff !== 0) {
      return dateDiff;
    }
    return (right.histoActionId ?? 0) - (left.histoActionId ?? 0);
  });
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
  codeServiceExecutant: string;
  idUtilisateurCourant: string;
  deviseFacture: string;
  modePaiement: ChorusPaymentMode;
  motifExonerationTva: string;
  numeroBonCommande: string;
  numeroFactureOrigine: string;
  numeroMarche: string;
  typeFacture: ChorusInvoiceType;
  typeTva: ChorusVatType;
  commentaire: string;
}

const EMPTY_RECYCLE_FORM: RecycleFormState = {
  codeDestinataire: '',
  codeServiceExecutant: '',
  idUtilisateurCourant: '',
  deviseFacture: 'EUR',
  modePaiement: 'VIREMENT',
  motifExonerationTva: '',
  numeroBonCommande: '',
  numeroFactureOrigine: '',
  numeroMarche: '',
  typeFacture: 'FACTURE',
  typeTva: 'TVA_SUR_DEBIT',
  commentaire: '',
};

interface CorrectValidatorFormState {
  idStructure: string;
  identifiantStructure: string;
  typeIdentifiantStructure: string;
}

const EMPTY_CORRECT_VALIDATOR_FORM: CorrectValidatorFormState = {
  idStructure: '',
  identifiantStructure: '',
  typeIdentifiantStructure: 'SIRET',
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
  const [correctValidatorForm, setCorrectValidatorForm] = useState<CorrectValidatorFormState>(EMPTY_CORRECT_VALIDATOR_FORM);
  const [correctValidatorLoading, setCorrectValidatorLoading] = useState(false);
  const [correctValidatorError, setCorrectValidatorError] = useState<string | null>(null);
  const [correctValidatorSuccess, setCorrectValidatorSuccess] = useState<string | null>(null);
  const [historyResponse, setHistoryResponse] = useState<ChorusInvoiceHistoryResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

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
  const displayInvoice = invoice
    ? toDisplayInvoiceFromInvoice(invoice, supplier, customer, {
        context: 'emission',
        source: 'Fiche émission Chorus',
        detailHref: `/invoices/chorus/${encodeURIComponent(invoice.id)}`,
      })
    : null;
  const invoiceId = invoice?.id;
  const chorusPaymentRequestId = invoice ? resolveChorusPaymentRequestId(invoice, raw) : undefined;
  const chorusHistoryInvoiceId = invoice ? resolveChorusHistoryInvoiceId(invoice, raw) : undefined;
  const validatorStructureId = invoice ? resolveValidatorStructureId(raw) : undefined;
  const validatorStructureIdentifier = invoice ? resolveValidatorStructureIdentifier(raw) : '';

  useEffect(() => {
    if (!invoice) {
      setRecycleForm(EMPTY_RECYCLE_FORM);
      setCorrectValidatorForm(EMPTY_CORRECT_VALIDATOR_FORM);
      setHistoryResponse(null);
      setHistoryError(null);
      return;
    }

    const config = resolveChorusRuntimeConfig(loadChorusConfig());
    const rawRecord = isRecord(raw) ? raw : null;
    const rawReference = nestedRecord(rawRecord, 'reference') ?? nestedRecord(rawRecord, 'references');
    const fallbackVatType: ChorusVatType = config.submissionVatType === 'AUTO' ? 'TVA_SUR_DEBIT' : config.submissionVatType;
    setRecycleForm({
      codeDestinataire: customer?.codeDestinataire || invoice.recipientChorusCode || '32242033407300',
      codeServiceExecutant: invoice.serviceChorusCode || firstString(rawRecord, ['codeServiceExecutant', 'serviceChorusCode']),
      idUtilisateurCourant: firstString(rawRecord, ['idUtilisateurCourant', 'currentUserId'], config.submissionCurrentUserId),
      deviseFacture: firstString(rawReference, ['deviseFacture', 'devise'], invoice.currencyCode || 'EUR'),
      modePaiement: pickPaymentMode(firstString(rawReference, ['modePaiement']), config.submissionPaymentMode),
      motifExonerationTva: firstString(rawReference, ['motifExonerationTva', 'motifExonerationTVA']),
      numeroBonCommande: invoice.purchaseOrderNumber || firstString(rawReference, ['numeroBonCommande']),
      numeroFactureOrigine: firstString(rawReference, ['numeroFactureOrigine']),
      numeroMarche: invoice.marketNumber || firstString(rawReference, ['numeroMarche']),
      typeFacture: pickInvoiceType(invoice.chorusInvoiceType || firstString(rawReference, ['typeFacture']), config.submissionInvoiceType),
      typeTva: pickVatType(firstString(rawReference, ['typeTva']), fallbackVatType),
      commentaire: 'Traitement recyclage : correction des données d’acheminement.',
    });
    setCorrectValidatorForm({
      idStructure: validatorStructureId ? String(validatorStructureId) : '',
      identifiantStructure: validatorStructureIdentifier || config.submissionValidatorStructureCode,
      typeIdentifiantStructure: 'SIRET',
    });
    setRecycleError(null);
    setRecycleSuccess(null);
    setCorrectValidatorError(null);
    setCorrectValidatorSuccess(null);
    setHistoryResponse(null);
    setHistoryError(null);
  }, [
    customer?.codeDestinataire,
    invoice?.id,
    invoice?.recipientChorusCode,
    invoice?.serviceChorusCode,
    invoice?.currencyCode,
    invoice?.purchaseOrderNumber,
    invoice?.marketNumber,
    invoice?.chorusInvoiceType,
    invoice?.rawPayload,
    validatorStructureId,
    validatorStructureIdentifier,
  ]);

  const loadInvoiceHistory = useCallback(async () => {
    if (!invoiceId) {
      setHistoryResponse(null);
      setHistoryError(null);
      return;
    }

    if (!chorusHistoryInvoiceId) {
      setHistoryResponse(null);
      setHistoryError('Identifiant facture Chorus introuvable pour consulter l’historique.');
      return;
    }

    setHistoryLoading(true);
    setHistoryError(null);

    try {
      const config = resolveChorusRuntimeConfig(loadChorusConfig());
      const result = await new ChorusBackendAutomationClient(config).getInvoiceHistory(
        buildInvoiceHistoryPayload(chorusHistoryInvoiceId),
      );
      const response = result.response ?? null;
      setHistoryResponse(response);

      const nextStatus = response?.statutCourantCode;
      if (nextStatus) {
        queryClient.setQueryData<Invoice | null>(dbQueryKeys.invoiceDetail(invoiceId), (current) => {
          if (!current) {
            return current;
          }
          return {
            ...current,
            statusChorus: nextStatus,
            lastStatusSyncAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        });
      }
    } catch (error) {
      const message = error instanceof ChorusBackendAutomationError || error instanceof Error
        ? error.message
        : 'Historique Chorus indisponible.';
      setHistoryError(message);
    } finally {
      setHistoryLoading(false);
    }
  }, [chorusHistoryInvoiceId, invoiceId, queryClient]);

  useEffect(() => {
    void loadInvoiceHistory();
  }, [loadInvoiceHistory]);

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
  const isSuspended = rawStatus.includes('SUSPEND');
  const isRejected = invoice.statusInternal === 'REJECTED_BUSINESS'
    || invoice.statusInternal === 'REJECTED_TECHNICAL'
    || rawStatus.includes('REJET')
    || rawStatus.includes('REFUS');
  const historyStatuses = Array.isArray(historyResponse?.historiquesDesStatuts?.histoStatut)
    ? sortHistoryStatuses(historyResponse.historiquesDesStatuts.histoStatut)
    : [];
  const historyActions = Array.isArray(historyResponse?.historiquesDesActionsUtilisateurs?.histoAction)
    ? sortHistoryActions(historyResponse.historiquesDesActionsUtilisateurs.histoAction)
    : [];
  const isWrongValidatorRejection = isRejected && isWrongValidatorRejectionText(
    invoice.statusChorus,
    invoice.statusReasonCode,
    invoice.statusReasonLabel,
    historyResponse?.statutCourantCode,
    historyResponse?.derniereAction?.derniereActionCode,
    ...historyStatuses.flatMap((status) => [
      status.histoStatutCode,
      status.histoStatutCommentaire,
    ]),
  );
  const rawEntries = isRecord(raw)
    ? Object.entries(raw).sort(([left], [right]) => left.localeCompare(right, 'fr'))
    : [];
  const customerLabel = customer?.legalName || invoice.recipientChorusName || 'Destinataire Chorus';
  const customerSiret = customer?.siret || invoice.recipientChorusCode || '';
  const customerCode = customer?.codeDestinataire || invoice.recipientChorusCode || '';

  async function handleRecycleInvoice() {
    setRecycleLoading(true);
    setRecycleError(null);
    setRecycleSuccess(null);

    try {
      const config = resolveChorusRuntimeConfig(loadChorusConfig());
      const identifiantFactureCPP = chorusPaymentRequestId;
      const codeDestinataire = recycleForm.codeDestinataire.trim();
      const codeServiceExecutant = recycleForm.codeServiceExecutant.trim();
      const idUtilisateurCourant = parsePositiveInteger(recycleForm.idUtilisateurCourant);
      const deviseFacture = recycleForm.deviseFacture.trim().toUpperCase();
      const motifExonerationTva = recycleForm.motifExonerationTva.trim();
      const numeroBonCommande = recycleForm.numeroBonCommande.trim();
      const numeroFactureOrigine = recycleForm.numeroFactureOrigine.trim();
      const numeroMarche = recycleForm.numeroMarche.trim();

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
      if (codeServiceExecutant) {
        payload.destinataire.codeServiceExecutant = codeServiceExecutant;
      }
      if (idUtilisateurCourant) {
        payload.idUtilisateurCourant = idUtilisateurCourant;
      }
      payload.reference = {
        ...(deviseFacture ? { deviseFacture } : {}),
        modePaiement: recycleForm.modePaiement,
        ...(motifExonerationTva ? { motifExonerationTva } : {}),
        ...(numeroBonCommande ? { numeroBonCommande } : {}),
        ...(numeroFactureOrigine ? { numeroFactureOrigine } : {}),
        ...(numeroMarche ? { numeroMarche } : {}),
        typeFacture: recycleForm.typeFacture,
        typeTva: recycleForm.typeTva,
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
      void loadInvoiceHistory();
    } catch (error) {
      const message = error instanceof ChorusBackendAutomationError || error instanceof Error
        ? error.message
        : 'Recyclage Chorus impossible.';
      setRecycleError(message);
    } finally {
      setRecycleLoading(false);
    }
  }

  async function handleCorrectValidator() {
    setCorrectValidatorLoading(true);
    setCorrectValidatorError(null);
    setCorrectValidatorSuccess(null);

    try {
      const idFacture = chorusHistoryInvoiceId;
      const idStructure = parsePositiveInteger(correctValidatorForm.idStructure);
      const identifiantStructure = correctValidatorForm.identifiantStructure.trim();
      const typeIdentifiantStructure = correctValidatorForm.typeIdentifiantStructure.trim() || 'SIRET';

      if (!idFacture) {
        throw new Error('Identifiant facture Chorus introuvable pour corriger le valideur.');
      }
      if (!idStructure && !identifiantStructure) {
        throw new Error('Renseigne idStructure ou identifiantStructure pour le nouveau valideur.');
      }

      const payload: ChorusCorrectValidatorPayload = {
        idFacture,
        typeIdentifiantStructure,
      };
      if (idStructure) {
        payload.idStructure = idStructure;
      }
      if (identifiantStructure) {
        payload.identifiantStructure = identifiantStructure;
      }

      const config = resolveChorusRuntimeConfig(loadChorusConfig());
      const result = await new ChorusBackendAutomationClient(config).correctInvoiceValidator(payload);
      const response = isRecord(result.response) ? result.response : null;
      const libelle = typeof response?.libelle === 'string' && response.libelle.trim() ? response.libelle.trim() : undefined;
      setCorrectValidatorSuccess(libelle ? `Valideur corrigé côté Chorus : ${libelle}` : 'Valideur corrigé côté Chorus.');

      const now = new Date().toISOString();
      queryClient.setQueryData<Invoice | null>(dbQueryKeys.invoiceDetail(invoice.id), (current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          lastStatusSyncAt: now,
          updatedAt: now,
        };
      });
      void queryClient.invalidateQueries({ queryKey: ['db', 'invoices'] });
      void loadInvoiceHistory();
    } catch (error) {
      const message = error instanceof ChorusBackendAutomationError || error instanceof Error
        ? error.message
        : 'Correction du valideur impossible.';
      setCorrectValidatorError(message);
    } finally {
      setCorrectValidatorLoading(false);
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
              <InvoiceContextBadge context="emission" />
              <ChorusStatusPill value={invoice.statusChorus || invoice.statusInternal} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {supplier?.legalName || invoice.supplierChorusName || 'Fournisseur'} → {customerLabel}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {displayInvoice && <InvoiceDownloadMenu invoice={displayInvoice} label="Télécharger" />}
          <Button variant="outline" asChild>
            <Link to="/invoices">Liste des factures</Link>
          </Button>
        </div>
      </div>

      {displayInvoice && <InvoiceActionGuide invoice={displayInvoice} />}

      <SubmissionStateInsight
        state={invoice.statusChorus || invoice.statusInternal}
        backendErrorMessage={invoice.statusReasonLabel}
        technicalDetails={[
          { label: 'Statut interne', value: invoice.statusInternal },
          { label: 'Statut Chorus brut', value: invoice.statusChorus },
          { label: 'Code motif Chorus', value: invoice.statusReasonCode },
          { label: 'Libellé Chorus', value: invoice.statusReasonLabel },
          { label: 'Code retour API', value: historyResponse?.codeRetour },
          { label: 'Libellé API', value: historyResponse?.libelle },
          { label: 'Dernière action Chorus', value: historyResponse?.derniereAction?.derniereActionCode },
        ]}
      />

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

      {isWrongValidatorRejection && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center text-base">
              <UserCheck className="mr-2 h-4 w-4" />
              Corriger le valideur
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {correctValidatorError && (
              <Alert variant="destructive">
                <AlertDescription>{correctValidatorError}</AlertDescription>
              </Alert>
            )}
            {correctValidatorSuccess && (
              <Alert className="border-success/30 bg-success/5">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <AlertDescription>{correctValidatorSuccess}</AlertDescription>
              </Alert>
            )}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="correct-validator-invoice-id">ID facture</Label>
                <Input id="correct-validator-invoice-id" value={chorusHistoryInvoiceId ? String(chorusHistoryInvoiceId) : ''} disabled />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="correct-validator-structure-id">ID structure</Label>
                <Input
                  id="correct-validator-structure-id"
                  inputMode="numeric"
                  value={correctValidatorForm.idStructure}
                  onChange={(event) => setCorrectValidatorForm((current) => ({ ...current, idStructure: event.target.value.replace(/\D/g, '') }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="correct-validator-identifier">Identifiant structure</Label>
                <Input
                  id="correct-validator-identifier"
                  value={correctValidatorForm.identifiantStructure}
                  onChange={(event) => setCorrectValidatorForm((current) => ({ ...current, identifiantStructure: event.target.value }))}
                  placeholder="SIRET"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="correct-validator-identifier-type">Type identifiant</Label>
                <Input
                  id="correct-validator-identifier-type"
                  value={correctValidatorForm.typeIdentifiantStructure}
                  onChange={(event) => setCorrectValidatorForm((current) => ({ ...current, typeIdentifiantStructure: event.target.value.toUpperCase() }))}
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                onClick={() => void handleCorrectValidator()}
                disabled={correctValidatorLoading || !chorusHistoryInvoiceId}
              >
                {correctValidatorLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserCheck className="mr-2 h-4 w-4" />}
                Corriger le valideur
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isSuspended && chorusPaymentRequestId && (
        <CompleteSuspendedInvoiceCard
          identifiantFactureCPP={chorusPaymentRequestId}
          statutFacture={invoice.statusChorus || invoice.statusInternal}
          attachments={[]}
          onCompleted={() => {
            void queryClient.invalidateQueries({ queryKey: ['db', 'invoices'] });
            void queryClient.invalidateQueries({ queryKey: dbQueryKeys.invoiceDetail(invoice.id) });
            void loadInvoiceHistory();
          }}
        />
      )}

      {isSuspended && !chorusPaymentRequestId && (
        <Alert>
          <AlertDescription>
            Facture suspendue côté émission, mais l’identifiant CPP nécessaire au complément est introuvable
            dans les données synchronisées. Actualisez l’historique Chorus ou resynchronisez la facture.
          </AlertDescription>
        </Alert>
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
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
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
              <div className="space-y-1.5">
                <Label htmlFor="recycle-service">Code service exécutant</Label>
                <Input
                  id="recycle-service"
                  value={recycleForm.codeServiceExecutant}
                  onChange={(event) => setRecycleForm((current) => ({ ...current, codeServiceExecutant: event.target.value }))}
                  placeholder="Optionnel"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="recycle-current-user">ID utilisateur courant</Label>
                <Input
                  id="recycle-current-user"
                  inputMode="numeric"
                  value={recycleForm.idUtilisateurCourant}
                  onChange={(event) => setRecycleForm((current) => ({ ...current, idUtilisateurCourant: event.target.value.replace(/\D/g, '') }))}
                  placeholder="Optionnel"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="recycle-currency">Devise</Label>
                <Input
                  id="recycle-currency"
                  value={recycleForm.deviseFacture}
                  onChange={(event) => setRecycleForm((current) => ({ ...current, deviseFacture: event.target.value.toUpperCase() }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="recycle-payment-mode">Mode paiement</Label>
                <Select
                  value={recycleForm.modePaiement}
                  onValueChange={(value) => setRecycleForm((current) => ({ ...current, modePaiement: value as ChorusPaymentMode }))}
                >
                  <SelectTrigger id="recycle-payment-mode"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_MODES.map((mode) => (
                      <SelectItem key={mode} value={mode}>{mode}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="recycle-invoice-type">Type facture</Label>
                <Select
                  value={recycleForm.typeFacture}
                  onValueChange={(value) => setRecycleForm((current) => ({ ...current, typeFacture: value as ChorusInvoiceType }))}
                >
                  <SelectTrigger id="recycle-invoice-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {INVOICE_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>{type}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="recycle-vat-type">Type TVA</Label>
                <Select
                  value={recycleForm.typeTva}
                  onValueChange={(value) => setRecycleForm((current) => ({ ...current, typeTva: value as ChorusVatType }))}
                >
                  <SelectTrigger id="recycle-vat-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {VAT_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>{type}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="recycle-purchase-order">Bon de commande</Label>
                <Input
                  id="recycle-purchase-order"
                  value={recycleForm.numeroBonCommande}
                  onChange={(event) => setRecycleForm((current) => ({ ...current, numeroBonCommande: event.target.value }))}
                  placeholder="Optionnel"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="recycle-market">Marché</Label>
                <Input
                  id="recycle-market"
                  value={recycleForm.numeroMarche}
                  onChange={(event) => setRecycleForm((current) => ({ ...current, numeroMarche: event.target.value }))}
                  placeholder="Optionnel"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="recycle-original-invoice">Facture origine</Label>
                <Input
                  id="recycle-original-invoice"
                  value={recycleForm.numeroFactureOrigine}
                  onChange={(event) => setRecycleForm((current) => ({ ...current, numeroFactureOrigine: event.target.value }))}
                  placeholder="Optionnel"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="recycle-vat-exoneration">Motif exonération TVA</Label>
                <Input
                  id="recycle-vat-exoneration"
                  value={recycleForm.motifExonerationTva}
                  onChange={(event) => setRecycleForm((current) => ({ ...current, motifExonerationTva: event.target.value }))}
                  placeholder="Si EXONERATION"
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
          <TabsTrigger value="history"><History className="mr-2 h-4 w-4" /> Historique</TabsTrigger>
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

        <TabsContent value="history" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-col gap-3 text-base sm:flex-row sm:items-center sm:justify-between">
                <span className="flex items-center"><History className="mr-2 h-4 w-4" /> Historique Chorus</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void loadInvoiceHistory()}
                  disabled={historyLoading || !chorusHistoryInvoiceId}
                >
                  {historyLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Rafraîchir
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {historyError && (
                <Alert variant="destructive">
                  <AlertDescription>{historyError}</AlertDescription>
                </Alert>
              )}

              {historyLoading && !historyResponse ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Chargement de l’historique...
                </div>
              ) : null}

              {historyResponse ? (
                <>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <InfoRow label="ID facture" value={historyResponse.idFacture ? String(historyResponse.idFacture) : chorusHistoryInvoiceId ? String(chorusHistoryInvoiceId) : '-'} />
                    <InfoRow label="N° facture" value={historyResponse.numeroFacture || '-'} />
                    <InfoRow label="Mode dépôt" value={historyResponse.modeDepot || '-'} />
                    <InfoRow label="Statut courant" value={historyResponse.statutCourantCode || '-'} />
                    <InfoRow
                      label="Retour"
                      value={(historyResponse.libelle || historyResponse.codeRetour !== undefined)
                        ? `${historyResponse.codeRetour ?? ''} ${historyResponse.libelle ?? ''}`.trim()
                        : '-'}
                    />
                    <InfoRow label="Dernière action" value={historyResponse.derniereAction?.derniereActionCode || '-'} />
                  </div>

                  <Separator />

                  <div className="space-y-3">
                    <h3 className="text-sm font-medium">Statuts</h3>
                    <HistoryStatusTable items={historyStatuses} />
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-sm font-medium">Actions utilisateur</h3>
                    <HistoryActionTable items={historyActions} />
                  </div>
                </>
              ) : !historyLoading && !historyError ? (
                <p className="text-sm text-muted-foreground">Aucun historique chargé.</p>
              ) : null}
            </CardContent>
          </Card>
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

function formatHistoryActor(firstName?: string, lastName?: string, email?: string): string {
  const fullName = [firstName, lastName].map((part) => part?.trim()).filter(Boolean).join(' ');
  if (fullName && email) {
    return `${fullName} (${email})`;
  }
  return fullName || email || '-';
}

function HistoryStatusTable({ items }: { items: ChorusInvoiceHistoryStatus[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Aucun statut retourné.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[760px] text-sm">
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
              <td className="p-3 whitespace-nowrap">{status.histoStatutDatePassage || '-'}</td>
              <td className="p-3 font-medium">{status.histoStatutCode || '-'}</td>
              <td className="p-3">
                {formatHistoryActor(
                  status.histoStatutUtilisateurPrenom,
                  status.histoStatutUtilisateurNom,
                  status.histoStatutUtilisateurEmail,
                )}
              </td>
              <td className="max-w-[360px] whitespace-normal break-words p-3 text-muted-foreground">
                {status.histoStatutCommentaire || '-'}
              </td>
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
      <table className="w-full min-w-[760px] text-sm">
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
              <td className="p-3 whitespace-nowrap">{action.histoActionDateHeure || '-'}</td>
              <td className="p-3 font-medium">{action.histoActionCode || '-'}</td>
              <td className="p-3">
                {formatHistoryActor(
                  action.histoActionUtilisateurPrenom,
                  action.histoActionUtilisateurNom,
                  action.histoActionUtilisateurEmail,
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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

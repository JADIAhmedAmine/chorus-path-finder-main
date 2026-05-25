import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Download,
  Eye,
  FileArchive,
  FileSearch,
  FileText,
  Inbox,
  Loader2,
  Paperclip,
  PauseCircle,
  Receipt,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { ChorusBackendAutomationClient } from '@/lib/chorus/backendAutomation';
import { loadChorusConfig, resolveChorusRuntimeConfig } from '@/lib/chorus/storage';
import {
  useInvoicesQuery,
  usePublicCustomersQuery,
  useSuppliersQuery,
  useSyncInvoicesMutation,
  useSyncSuppliersMutation,
  type SyncRunResult,
} from '@/lib/queries/db';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/status-utils';
import { ChorusStatusBadge } from '@/components/chorus/ChorusStatusBadge';
import { InvoiceDetailDrawer } from '@/components/chorus/InvoiceDetailDrawer';
import { BulkProgress } from '@/components/common/BulkProgress';
import { EmptyState } from '@/components/common/EmptyState';
import { SkeletonKpiGrid, SkeletonTable } from '@/components/common/LoadingSkeleton';
import type {
  ReceptionBulkResultError,
  ReceptionConsultError,
  ReceptionDownloadFormat,
  ChorusInvoiceHistoryPayload,
  ReceptionInvoice,
  ReceptionInvoiceAttachment,
} from '@/types/chorus';
import type { Invoice, PublicCustomer, SupplierOrganization } from '@/types';

const BULK_HINT_PLACEHOLDER = '8424327\n8424328\n8424329';
const CONSULT_CHUNK_SIZE = 50;
const HISTORY_STATUS_RECONCILE_LIMIT = 50;
const RECEPTION_PROCESSED_STATUSES = new Set([
  'A_RECYCLER',
  'COMPLETEE',
  'COMPTABILISEE',
  'MANDATEE',
  'MISE_A_DISPOSITION_COMPTABLE',
  'MISE_EN_PAIEMENT',
  'PRISE_EN_COMPTE_DESTINATAIRE',
  'REJETEE',
  'SERVICE_FAIT',
  'SUSPENDUE',
  'TRANSMISE_MOA',
]);

interface SingleConsultState {
  status: 'idle' | 'loading' | 'success' | 'error';
  identifier?: number;
  invoice?: ReceptionInvoice;
  error?: ReceptionConsultError;
}

interface BulkConsultState {
  status: 'idle' | 'loading' | 'done';
  rows?: ReceptionDisplayRow[];
  responseRows?: ReceptionDisplayRow[];
  pendingRows?: ReceptionDisplayRow[];
  errors?: ReceptionBulkResultError[];
  totalStored?: number;
  detailSuccess?: number;
  detailFailed?: number;
  syncRuns?: SyncRunResult[];
  globalError?: string;
  note?: string;
  /** Identifiants à consulter dans cette série (affiché par la barre de progression). */
  totalRequested?: number;
  /** Identifiants déjà traités (succès + erreurs) — mis à jour entre chaque chunk. */
  processed?: number;
}

interface ReceptionDisplayRow {
  identifiantFactureCPP: number;
  invoiceId?: string;
  facture: ReceptionInvoice;
  detailStatus: 'detail' | 'response' | 'database' | 'error';
  processed?: ReceptionProcessingInfo | null;
  error?: ReceptionBulkResultError;
}

interface ReceptionProcessingInfo {
  processed: boolean;
  status: string | null;
  processedAt: string | null;
  libelle: string | null;
}

type ReceptionSqlClassification = 'FACTURE_RECUE' | 'REPONSE_FAVORABLE' | 'A_QUALIFIER';

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

function asDisplayString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = asDisplayString(record[key]);
    if (value) return value;
  }
  return null;
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value.replace(/\s/g, '').replace(',', '.'));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function parseConfiguredSupplierId(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}

function rawPayload(invoice: Invoice): Record<string, unknown> {
  return isRecord(invoice.rawPayload) ? invoice.rawPayload : {};
}

function receptionProcessingInfo(raw: Record<string, unknown>): ReceptionProcessingInfo | null {
  const processing = raw.receptionProcessing;
  if (!isRecord(processing) || processing.processed !== true) return null;
  return {
    processed: true,
    status: asDisplayString(processing.status),
    processedAt: asDisplayString(processing.processedAt),
    libelle: asDisplayString(processing.libelle),
  };
}

function receptionProcessingInfoFromStatus(status: string | null): ReceptionProcessingInfo | null {
  const normalized = status?.trim().toUpperCase();
  if (!normalized || !RECEPTION_PROCESSED_STATUSES.has(normalized)) return null;
  return {
    processed: true,
    status: normalized,
    processedAt: null,
    libelle: null,
  };
}

function buildReceptionHistoryPayload(idFacture: number): ChorusInvoiceHistoryPayload {
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

function activeReceptionRows(rows: ReceptionDisplayRow[]): ReceptionDisplayRow[] {
  return rows.filter((row) => !row.processed?.processed);
}

function processedReceptionRows(rows: ReceptionDisplayRow[]): ReceptionDisplayRow[] {
  return rows.filter((row) => row.processed?.processed);
}

function receptionSqlClassification(raw: Record<string, unknown>): ReceptionSqlClassification {
  if (isRecord(raw.receptionNormalized)) return 'FACTURE_RECUE';
  const classification = raw.receptionClassification;
  const kind = isRecord(classification) ? asDisplayString(classification.kind) : null;
  if (kind === 'FACTURE_RECUE' || kind === 'REPONSE_FAVORABLE' || kind === 'A_QUALIFIER') {
    return kind;
  }
  return 'A_QUALIFIER';
}

function detailStatusFromSqlClassification(
  classification: ReceptionSqlClassification,
): ReceptionDisplayRow['detailStatus'] {
  if (classification === 'FACTURE_RECUE') return 'detail';
  if (classification === 'REPONSE_FAVORABLE') return 'response';
  return 'database';
}

function resolveInvoiceIdentifier(invoice: Invoice): number | null {
  const raw = rawPayload(invoice);
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

function hasPartyInfo(party: ReceptionInvoice['fournisseur']): boolean {
  return !!(party?.id || party?.siret || party?.raisonSociale || party?.codeService);
}

function storedReceptionInvoiceFromRaw(
  raw: Record<string, unknown>,
  identifier: number,
): ReceptionInvoice | null {
  const stored = raw.receptionNormalized;
  if (!isRecord(stored)) return null;

  const invoice = stored as unknown as ReceptionInvoice;
  const base = emptyReceptionInvoice(identifier);
  return {
    ...base,
    ...invoice,
    identifiantFactureCPP: asPositiveInteger(invoice.identifiantFactureCPP) ?? identifier,
    fournisseur: isRecord(stored.fournisseur) ? invoice.fournisseur : null,
    destinataire: isRecord(stored.destinataire) ? invoice.destinataire : null,
    dates: isRecord(stored.dates) ? { ...base.dates, ...invoice.dates } : base.dates,
    montants: isRecord(stored.montants) ? { ...base.montants, ...invoice.montants } : base.montants,
    references: isRecord(stored.references) ? { ...base.references, ...invoice.references } : base.references,
    piecesJointes: Array.isArray(stored.piecesJointes) ? invoice.piecesJointes : [],
    lignesDePoste: Array.isArray(stored.lignesDePoste) ? invoice.lignesDePoste : [],
    recapitulatifTva: Array.isArray(stored.recapitulatifTva) ? invoice.recapitulatifTva : [],
  };
}

function receptionInvoiceFromDb(
  invoice: Invoice,
  supplier: SupplierOrganization | undefined,
  customer: PublicCustomer | undefined,
): ReceptionInvoice | null {
  const raw = rawPayload(invoice);
  const identifiantFactureCPP = resolveInvoiceIdentifier(invoice);
  if (!identifiantFactureCPP) return null;

  const supplierParty: ReceptionInvoice['fournisseur'] = {
    id: invoice.supplierChorusCode || supplier?.chorusSupplierCode || supplier?.id || null,
    siret: supplier?.siret || firstString(raw, ['siretFournisseur', 'identifiantFournisseur']) || null,
    raisonSociale: invoice.supplierChorusName
      || supplier?.legalName
      || firstString(raw, ['designationFournisseur', 'raisonSocialeFournisseur', 'nomFournisseur'])
      || null,
    codeService: firstString(raw, ['codeServiceFournisseur', 'codeServiceExecutantFournisseur']),
    code: firstString(raw, ['codeFournisseur']),
    typeIdentifiant: firstString(raw, ['typeIdentifiantFournisseur']),
    serviceExecutantId: null,
    serviceExecutantLibelle: null,
    miseEnPaiement: null,
    adresse: null,
  };
  const customerParty: ReceptionInvoice['destinataire'] = {
    id: invoice.recipientChorusId || firstString(raw, ['idDestinataire', 'idStructureDestinataire', 'idStructureCPP']),
    siret: customer?.siret || firstString(raw, ['siretDestinataire', 'siretStructure']),
    raisonSociale: invoice.recipientChorusName
      || customer?.legalName
      || firstString(raw, [
        'designationDestinataire',
        'raisonSocialeStuctDmd',
        'raisonSocialeStructureDmd',
        'raisonSocialeDestinataire',
        'nomDestinataire',
      ]),
    codeService: invoice.serviceChorusCode || firstString(raw, ['codeServiceExecutant']),
    code: firstString(raw, ['codeDestinataire']),
    typeIdentifiant: firstString(raw, ['typeIdentifiantDestinataire', 'typeIdentifiantStructure']),
    serviceExecutantId: firstString(raw, ['idServiceExecutant']),
    serviceExecutantLibelle: firstString(raw, ['libelleServiceExecutant']),
    miseEnPaiement: typeof raw.miseEnPaiementDestinataire === 'boolean' ? raw.miseEnPaiementDestinataire : null,
    adresse: null,
  };

  const fallback: ReceptionInvoice = {
    identifiantFactureCPP,
    numeroFacture: invoice.supplierInvoiceNumber
      || firstString(raw, ['numeroFacture', 'numeroFactureSaisi', 'numeroFactureFournisseur']),
    statutFacture: invoice.statusChorus || firstString(raw, ['statutCourant', 'libelleStatutCourant', 'statut']),
    modeDepot: invoice.depositMode || firstString(raw, ['modeDepot', 'formatDepot']),
    rejetTraite: invoice.rejectionProcessed ?? (typeof raw.rejetTraite === 'boolean' ? raw.rejetTraite : null),
    commentaire: firstString(raw, ['commentaire']),
    cadreDeFacturation: null,
    fournisseur: hasPartyInfo(supplierParty) ? supplierParty : null,
    destinataire: hasPartyInfo(customerParty) ? customerParty : null,
    dates: {
      dateFacture: invoice.invoiceDate || firstString(raw, ['dateFacture', 'dateEmission']),
      dateDepot: invoice.submittedAt || firstString(raw, ['dateDepot', 'dateHeureDepot']),
      dateEcheancePaiement: invoice.dueDate || firstString(raw, ['dateEcheancePaiement', 'dateEcheance']),
      dateCreationFacture: firstString(raw, ['dateCreationFacture']),
    },
    montants: {
      ht: invoice.totalHt || firstNumber(raw, ['montantHT', 'montantHtTotal']) || 0,
      tva: invoice.totalVat || firstNumber(raw, ['montantTVA', 'montantTva']) || 0,
      ttc: invoice.totalTtc || firstNumber(raw, ['montantTTC', 'montantTtcTotal']) || 0,
      aPayer: invoice.amountToPay || firstNumber(raw, ['montantAPayer', 'montantApayer']) || invoice.totalTtc || 0,
      devise: invoice.currencyCode
        || firstString(raw, ['codeDeviseFacture', 'deviseFacture', 'devise'])
        || 'EUR',
      remiseGlobaleTtc: firstNumber(raw, ['montantRemiseGlobaleTTC']) || 0,
      ttcAvantRemiseGlobale: firstNumber(raw, ['montantTtcAvantRemiseGlobalTTC']),
      libelleDevise: firstString(raw, ['libelleDeviseFacture']),
    },
    references: {
      numeroBonCommande: invoice.purchaseOrderNumber || firstString(raw, ['numeroBonCommande']),
      numeroMarche: invoice.marketNumber || firstString(raw, ['numeroMarche']),
      numeroDpMandat: firstString(raw, ['numeroDpMandat', 'numeroDp', 'numeroDP', 'numeroDemandePaiement']),
      numeroFactureOrigine: firstString(raw, ['numeroFactureOrigine']),
      motifExonerationTva: firstString(raw, ['motifExonerationTva']),
      modePaiement: firstString(raw, ['modePaiement']),
      typeFacture: invoice.chorusInvoiceType || firstString(raw, ['typeFacture', 'typeDemandePaiement']),
      typeTva: firstString(raw, ['typeTva']),
      tailleTotalePiecesJointes: firstNumber(raw, ['tailleTotalePiecesJointes']),
    },
    piecesJointes: [],
    lignesDePoste: [],
    recapitulatifTva: [],
  };

  const storedDetail = storedReceptionInvoiceFromRaw(raw, identifiantFactureCPP);
  return storedDetail ? mergeReceptionInvoice(storedDetail, fallback) : fallback;
}

function preferString(primary: string | null, fallback: string | null): string | null {
  return primary && primary.trim() ? primary : fallback;
}

function mergeParty(
  primary: ReceptionInvoice['fournisseur'],
  fallback: ReceptionInvoice['fournisseur'],
): ReceptionInvoice['fournisseur'] {
  if (!primary) return fallback;
  if (!fallback) return primary;
  const merged: ReceptionInvoice['fournisseur'] = {
    id: preferString(primary.id, fallback.id),
    siret: preferString(primary.siret, fallback.siret),
    raisonSociale: preferString(primary.raisonSociale, fallback.raisonSociale),
    codeService: preferString(primary.codeService, fallback.codeService),
    code: preferString(primary.code, fallback.code),
    typeIdentifiant: preferString(primary.typeIdentifiant, fallback.typeIdentifiant),
    serviceExecutantId: preferString(primary.serviceExecutantId, fallback.serviceExecutantId),
    serviceExecutantLibelle: preferString(primary.serviceExecutantLibelle, fallback.serviceExecutantLibelle),
    miseEnPaiement: primary.miseEnPaiement ?? fallback.miseEnPaiement,
    adresse: primary.adresse ?? fallback.adresse,
  };
  return hasPartyInfo(merged) ? merged : null;
}

function mergeReceptionInvoice(detail: ReceptionInvoice, fallback: ReceptionInvoice): ReceptionInvoice {
  const detailAttachments = detail.piecesJointes.filter((attachment) =>
    attachment.pieceJointeId
    || attachment.designation
    || attachment.typeCode
    || attachment.typeLibelle
    || attachment.extension
    || attachment.mimeType
  );

  return {
    ...fallback,
    ...detail,
    identifiantFactureCPP: asPositiveInteger(detail.identifiantFactureCPP) ?? fallback.identifiantFactureCPP,
    numeroFacture: preferString(detail.numeroFacture, fallback.numeroFacture),
    statutFacture: preferString(detail.statutFacture, fallback.statutFacture),
    modeDepot: preferString(detail.modeDepot, fallback.modeDepot),
    rejetTraite: detail.rejetTraite ?? fallback.rejetTraite,
    commentaire: preferString(detail.commentaire, fallback.commentaire),
    cadreDeFacturation: detail.cadreDeFacturation ?? fallback.cadreDeFacturation,
    fournisseur: mergeParty(detail.fournisseur, fallback.fournisseur),
    destinataire: mergeParty(detail.destinataire, fallback.destinataire),
    dates: {
      dateFacture: preferString(detail.dates.dateFacture, fallback.dates.dateFacture),
      dateDepot: preferString(detail.dates.dateDepot, fallback.dates.dateDepot),
      dateEcheancePaiement: preferString(detail.dates.dateEcheancePaiement, fallback.dates.dateEcheancePaiement),
      dateCreationFacture: preferString(detail.dates.dateCreationFacture, fallback.dates.dateCreationFacture),
    },
    montants: {
      ht: detail.montants.ht || fallback.montants.ht,
      tva: detail.montants.tva || fallback.montants.tva,
      ttc: detail.montants.ttc || fallback.montants.ttc,
      aPayer: detail.montants.aPayer || fallback.montants.aPayer,
      devise: detail.montants.devise || fallback.montants.devise,
      remiseGlobaleTtc: detail.montants.remiseGlobaleTtc || fallback.montants.remiseGlobaleTtc,
      ttcAvantRemiseGlobale: detail.montants.ttcAvantRemiseGlobale ?? fallback.montants.ttcAvantRemiseGlobale,
      libelleDevise: preferString(detail.montants.libelleDevise, fallback.montants.libelleDevise),
    },
    references: {
      numeroBonCommande: preferString(detail.references.numeroBonCommande, fallback.references.numeroBonCommande),
      numeroMarche: preferString(detail.references.numeroMarche, fallback.references.numeroMarche),
      numeroDpMandat: preferString(detail.references.numeroDpMandat, fallback.references.numeroDpMandat),
      numeroFactureOrigine: preferString(detail.references.numeroFactureOrigine, fallback.references.numeroFactureOrigine),
      motifExonerationTva: preferString(detail.references.motifExonerationTva, fallback.references.motifExonerationTva),
      modePaiement: preferString(detail.references.modePaiement, fallback.references.modePaiement),
      typeFacture: preferString(detail.references.typeFacture, fallback.references.typeFacture),
      typeTva: preferString(detail.references.typeTva, fallback.references.typeTva),
      tailleTotalePiecesJointes: detail.references.tailleTotalePiecesJointes ?? fallback.references.tailleTotalePiecesJointes,
    },
    piecesJointes: detailAttachments.length > 0 ? detailAttachments : fallback.piecesJointes,
    lignesDePoste: detail.lignesDePoste.length > 0 ? detail.lignesDePoste : fallback.lignesDePoste,
    recapitulatifTva: detail.recapitulatifTva.length > 0 ? detail.recapitulatifTva : fallback.recapitulatifTva,
  };
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

function rowsFromDbInvoices(
  invoices: Invoice[],
  suppliersById: Map<string, SupplierOrganization>,
  customersById: Map<string, PublicCustomer>,
): ReceptionDisplayRow[] {
  return invoices
    .map((invoice) => {
      const facture = receptionInvoiceFromDb(
        invoice,
        suppliersById.get(invoice.supplierOrganizationId),
        customersById.get(invoice.publicCustomerId),
      );
      if (!facture?.identifiantFactureCPP) return null;
      const raw = rawPayload(invoice);
      const classification = receptionSqlClassification(raw);
      return {
        identifiantFactureCPP: facture.identifiantFactureCPP,
        invoiceId: invoice.id,
        facture,
        detailStatus: detailStatusFromSqlClassification(classification),
        processed: receptionProcessingInfo(raw) ?? receptionProcessingInfoFromStatus(facture.statutFacture),
      };
    })
    .filter((row): row is ReceptionDisplayRow => row !== null)
    .sort((left, right) => {
      const rightDate = new Date(right.facture.dates.dateDepot || right.facture.dates.dateFacture || '').getTime() || 0;
      const leftDate = new Date(left.facture.dates.dateDepot || left.facture.dates.dateFacture || '').getTime() || 0;
      return rightDate - leftDate || right.identifiantFactureCPP - left.identifiantFactureCPP;
    });
}

function splitBusinessRows(rows: ReceptionDisplayRow[]): {
  receivedRows: ReceptionDisplayRow[];
  responseRows: ReceptionDisplayRow[];
  pendingRows: ReceptionDisplayRow[];
} {
  return {
    receivedRows: rows.filter((row) => row.detailStatus === 'detail'),
    responseRows: rows.filter((row) => row.detailStatus === 'response'),
    pendingRows: rows.filter((row) => row.detailStatus === 'database' || row.detailStatus === 'error'),
  };
}

function applyReceptionErrors(
  rows: ReceptionDisplayRow[],
  errors: ReceptionBulkResultError[],
): ReceptionDisplayRow[] {
  if (errors.length === 0) return rows;
  const errorById = new Map(errors.map((error) => [error.identifiantFactureCPP, error]));
  return rows.map((row) => {
    const error = errorById.get(row.identifiantFactureCPP);
    if (!error || row.detailStatus === 'detail') return row;
    if (row.detailStatus === 'response') {
      return {
        ...row,
        error,
      };
    }
    return {
      ...row,
      detailStatus: 'error' as const,
      error,
    };
  });
}

async function enrichRowsWithReceptionDetails(
  client: ChorusBackendAutomationClient,
  baseRows: ReceptionDisplayRow[],
  options: {
    forceRefresh?: boolean;
    onProgress?: (processed: number, total: number) => void;
  } = {},
): Promise<{
  rows: ReceptionDisplayRow[];
  detailSuccess: number;
  detailFailed: number;
}> {
  const baseById = new Map(baseRows.map((row) => [row.identifiantFactureCPP, row]));
  const detailById = new Map<number, ReceptionInvoice>();
  const errorById = new Map<number, ReceptionBulkResultError>();
  const identifiers = baseRows.map((row) => row.identifiantFactureCPP);
  const identifiersToConsult = baseRows
    .filter((row) => options.forceRefresh || row.detailStatus !== 'detail')
    .map((row) => row.identifiantFactureCPP);
  const total = identifiersToConsult.length;
  let processed = 0;
  options.onProgress?.(processed, total);

  for (let index = 0; index < identifiersToConsult.length; index += CONSULT_CHUNK_SIZE) {
    const chunk = identifiersToConsult.slice(index, index + CONSULT_CHUNK_SIZE);
    if (chunk.length === 0) continue;
    const result = await client.consultInvoicesBulkForReception(chunk);
    for (const item of result.items) {
      detailById.set(item.identifiantFactureCPP, item.facture);
    }
    for (const error of result.errors) {
      errorById.set(error.identifiantFactureCPP, error);
    }
    processed += chunk.length;
    options.onProgress?.(processed, total);
  }

  return {
    rows: identifiers.map((identifier) => {
      const base = baseById.get(identifier) ?? {
        identifiantFactureCPP: identifier,
        facture: emptyReceptionInvoice(identifier),
        detailStatus: 'database' as const,
      };
      const detail = detailById.get(identifier);
      if (detail) {
        const facture = mergeReceptionInvoice(detail, base.facture);
        return {
          ...base,
          facture,
          detailStatus: 'detail' as const,
          processed: base.processed ?? receptionProcessingInfoFromStatus(facture.statutFacture),
        };
      }
      const error = errorById.get(identifier);
      if (error) {
        return {
          ...base,
          detailStatus: 'error' as const,
          error,
        };
      }
      return base;
    }),
    detailSuccess: detailById.size,
    detailFailed: errorById.size,
  };
}

async function reconcileRowsWithHistoryStatus(
  client: ChorusBackendAutomationClient,
  rows: ReceptionDisplayRow[],
): Promise<{
  checked: number;
  persisted: number;
  failed: number;
  limited: boolean;
}> {
  const activeRows = activeReceptionRows(rows);
  const candidates = activeRows.slice(0, HISTORY_STATUS_RECONCILE_LIMIT);
  let checked = 0;
  let persisted = 0;
  let failed = 0;

  for (const row of candidates) {
    try {
      const result = await client.getInvoiceHistory(
        buildReceptionHistoryPayload(row.identifiantFactureCPP),
      );
      checked += 1;
      if (result.historyStatusPersisted) {
        persisted += 1;
      }
    } catch (error) {
      failed += 1;
      console.warn('[reception] history status sync skipped', row.identifiantFactureCPP, error);
    }
  }

  return {
    checked,
    persisted,
    failed,
    limited: activeRows.length > candidates.length,
  };
}

function parseBulkInput(raw: string): number[] {
  const matches = raw
    .split(/[\s,;]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const seen = new Set<number>();
  const result: number[] = [];
  for (const token of matches) {
    if (!/^\d+$/.test(token)) continue;
    const parsed = Number(token);
    if (!Number.isFinite(parsed) || parsed <= 0) continue;
    if (seen.has(parsed)) continue;
    seen.add(parsed);
    result.push(parsed);
  }
  return result;
}

function isOverdue(dateEcheancePaiement: string | null, statut: string | null): boolean {
  if (!dateEcheancePaiement) return false;
  if (statut && ['MISE_EN_PAIEMENT', 'COMPTABILISEE', 'MANDATEE'].includes(statut)) return false;
  const echeance = new Date(dateEcheancePaiement);
  if (Number.isNaN(echeance.getTime())) return false;
  return echeance.getTime() < Date.now();
}

export default function ReceptionProcessing() {
  const [singleIdentifier, setSingleIdentifier] = useState<string>('');
  const [singleState, setSingleState] = useState<SingleConsultState>({ status: 'idle' });

  const [bulkInput, setBulkInput] = useState<string>('');
  const [bulkState, setBulkState] = useState<BulkConsultState>({ status: 'idle' });
  const [drawerInvoice, setDrawerInvoice] = useState<ReceptionInvoice | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function openDrawerForInvoice(invoice: ReceptionInvoice) {
    setDrawerInvoice(invoice);
    setDrawerOpen(true);
  }

  const invoicesQuery = useInvoicesQuery({ pageSize: 500 });
  const suppliersQuery = useSuppliersQuery();
  const customersQuery = usePublicCustomersQuery();
  const syncInvoices = useSyncInvoicesMutation();
  const syncSuppliers = useSyncSuppliersMutation();

  const suppliersById = useMemo(
    () => new Map((suppliersQuery.data ?? []).map((supplier) => [supplier.id, supplier])),
    [suppliersQuery.data],
  );
  const customersById = useMemo(
    () => new Map((customersQuery.data ?? []).map((customer) => [customer.id, customer])),
    [customersQuery.data],
  );
  const allDbRows = useMemo(
    () => rowsFromDbInvoices(invoicesQuery.data?.items ?? [], suppliersById, customersById),
    [customersById, invoicesQuery.data?.items, suppliersById],
  );
  const dbRows = useMemo(
    () => activeReceptionRows(allDbRows),
    [allDbRows],
  );
  const rowsById = useMemo(
    () => new Map(dbRows.map((row) => [row.identifiantFactureCPP, row])),
    [dbRows],
  );
  const cachedDetailRows = useMemo(
    () => dbRows.filter((row) => row.detailStatus === 'detail'),
    [dbRows],
  );
  const cachedResponseRows = useMemo(
    () => dbRows.filter((row) => row.detailStatus === 'response'),
    [dbRows],
  );
  const cachedPendingRows = useMemo(
    () => dbRows.filter((row) => row.detailStatus === 'database' || row.detailStatus === 'error'),
    [dbRows],
  );

  const bulkRows = bulkState.rows !== undefined
    && (bulkState.rows.length > 0 || bulkState.status !== 'loading')
    ? bulkState.rows
    : cachedDetailRows;
  const responseRows = bulkState.responseRows !== undefined
    && (bulkState.responseRows.length > 0 || bulkState.status !== 'loading')
    ? bulkState.responseRows
    : cachedResponseRows;
  const pendingRows = bulkState.pendingRows !== undefined
    && (bulkState.pendingRows.length > 0 || bulkState.status !== 'loading')
    ? bulkState.pendingRows
    : cachedPendingRows;
  const busy = bulkState.status === 'loading' || syncInvoices.isPending || syncSuppliers.isPending;

  useEffect(() => {
    if (cachedDetailRows.length === 0) return;
    if (bulkState.rows !== undefined && (bulkState.rows.length > 0 || bulkState.status === 'done')) return;
    setBulkInput((current) =>
      current.trim() ? current : cachedDetailRows.map((row) => row.identifiantFactureCPP).join('\n'),
    );
  }, [bulkState.rows, bulkState.status, cachedDetailRows]);

  async function refetchRowsFromSqlCache(): Promise<ReceptionDisplayRow[]> {
    const [invoicesPayload, suppliersPayload, customersPayload] = await Promise.all([
      invoicesQuery.refetch(),
      suppliersQuery.refetch(),
      customersQuery.refetch(),
    ]);
    return activeReceptionRows(rowsFromDbInvoices(
      invoicesPayload.data?.items ?? invoicesQuery.data?.items ?? [],
      new Map((suppliersPayload.data ?? suppliersQuery.data ?? []).map((supplier) => [supplier.id, supplier])),
      new Map((customersPayload.data ?? customersQuery.data ?? []).map((customer) => [customer.id, customer])),
    ));
  }

  async function handleRefresh() {
    setBulkState({
      status: 'loading',
      rows: cachedDetailRows,
      responseRows: cachedResponseRows,
      pendingRows: cachedPendingRows,
      totalStored: dbRows.length,
      detailSuccess: cachedDetailRows.length,
      detailFailed: 0,
      note: cachedDetailRows.length > 0
        ? 'Cache PostgreSQL affiché. Mise à jour Chorus en cours pour les informations manquantes...'
        : 'Mise à jour Chorus vers PostgreSQL en cours...',
    });
    setSingleState({ status: 'idle' });

    try {
      const config = resolveChorusRuntimeConfig(loadChorusConfig());
      const client = new ChorusBackendAutomationClient(config);
      const supplierId = parseConfiguredSupplierId(config.submissionSupplierId);
      const syncInput = {
        environment: config.environment,
        ...(supplierId !== undefined ? { supplierId } : {}),
      };

      await syncSuppliers.mutateAsync(syncInput).catch((supplierSyncError) => {
        console.warn('[reception] sync suppliers skipped', supplierSyncError);
      });
      const syncRuns = await syncInvoices.mutateAsync({ ...syncInput, mode: 'full' });
      const refreshedRows = await refetchRowsFromSqlCache();

      if (refreshedRows.length === 0) {
        setBulkInput('');
        setBulkState({
          status: 'idle',
          globalError: 'Aucune facture Chorus exploitable trouvée après synchronisation PostgreSQL.',
        });
        return;
      }

      const enriched = await enrichRowsWithReceptionDetails(client, refreshedRows, { forceRefresh: true });
      const rowsAfterDetailCacheUpdate = await refetchRowsFromSqlCache();
      const rowsBeforeHistorySync = rowsAfterDetailCacheUpdate.length > 0
        ? rowsAfterDetailCacheUpdate
        : activeReceptionRows(enriched.rows);
      const historySync = await reconcileRowsWithHistoryStatus(client, rowsBeforeHistorySync);
      const rowsAfterHistoryStatusUpdate = historySync.persisted > 0
        ? await refetchRowsFromSqlCache()
        : rowsBeforeHistorySync;
      const displayRows = rowsAfterHistoryStatusUpdate.filter((row) => row.detailStatus === 'detail');
      const errors = enriched.rows
        .map((row) => row.error)
        .filter((error): error is ReceptionBulkResultError => !!error);
      const classifiedRows = applyReceptionErrors(
        rowsAfterHistoryStatusUpdate,
        errors,
      );
      const { receivedRows, responseRows: separatedResponseRows, pendingRows: separatedPendingRows } = splitBusinessRows(classifiedRows);
      const historyNote = historySync.checked > 0
        ? ` Historique contrôlé pour ${historySync.checked} ligne(s), ${historySync.persisted} statut(s) réconcilié(s).`
        : '';
      const historyLimitNote = historySync.limited
        ? ` Limite de ${HISTORY_STATUS_RECONCILE_LIMIT} historiques par actualisation atteinte.`
        : '';
      const historyFailureNote = historySync.failed > 0
        ? ` ${historySync.failed} historique(s) indisponible(s).`
        : '';
      setBulkInput(displayRows.map((row) => row.identifiantFactureCPP).join('\n'));
      setBulkState({
        status: 'done',
        rows: receivedRows,
        responseRows: separatedResponseRows,
        pendingRows: separatedPendingRows,
        errors,
        totalStored: refreshedRows.length,
        detailSuccess: receivedRows.length,
        detailFailed: separatedPendingRows.filter((row) => row.detailStatus === 'error').length,
        syncRuns,
        note: `${refreshedRows.length} ligne(s) synchronisée(s) en PostgreSQL. Détails déjà en cache conservés. ${receivedRows.length} facture(s) reçue(s), ${separatedResponseRows.length} réponse(s) favorable(s), ${separatedPendingRows.length} à qualifier.${historyNote}${historyLimitNote}${historyFailureNote}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inattendue.';
      setBulkState({
        status: 'idle',
        totalStored: dbRows.length,
        globalError: `Synchronisation PostgreSQL impossible : ${message}`,
      });
    }
  }

  async function handleSingleConsult() {
    const trimmed = singleIdentifier.trim();
    const numeric = Number(trimmed);
    if (!trimmed || !Number.isFinite(numeric) || numeric <= 0 || !Number.isInteger(numeric)) {
      setSingleState({
        status: 'error',
        error: {
          ok: false,
          success: false,
          category: 'VALIDATION',
          human_message: 'Identifiant facture invalide : un entier positif est attendu.',
          raw_message: trimmed,
          recommended_action: 'Saisir l’identifiant CPP exact (ex. 8424327).',
        },
      });
      return;
    }

    const cached = rowsById.get(numeric);
    if (cached?.detailStatus === 'detail') {
      setSingleState({
        status: 'success',
        identifier: numeric,
        invoice: cached.facture,
      });
      return;
    }

    setSingleState({ status: 'loading', identifier: numeric });
    try {
      const config = resolveChorusRuntimeConfig(loadChorusConfig());
      const refreshedRows = await refetchRowsFromSqlCache();
      const refreshedRowsById = new Map(refreshedRows.map((row) => [row.identifiantFactureCPP, row]));
      const refreshedCached = refreshedRowsById.get(numeric);
      if (refreshedCached?.detailStatus === 'detail') {
        setSingleState({
          status: 'success',
          identifier: numeric,
          invoice: refreshedCached.facture,
        });
        return;
      }
      const result = await new ChorusBackendAutomationClient(config).consultInvoiceForReception(numeric);
      if (result.ok && result.success) {
        const rowsAfterDetailCacheUpdate = await refetchRowsFromSqlCache();
        const refreshedAfterDetailById = new Map(
          rowsAfterDetailCacheUpdate.map((row) => [row.identifiantFactureCPP, row]),
        );
        const fallback = refreshedAfterDetailById.get(numeric)?.facture
          ?? refreshedRowsById.get(numeric)?.facture
          ?? rowsById.get(numeric)?.facture;
        setSingleState({
          status: 'success',
          identifier: numeric,
          invoice: fallback ? mergeReceptionInvoice(result.facture, fallback) : result.facture,
        });
      } else {
        setSingleState({ status: 'error', identifier: numeric, error: result });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inattendue.';
      setSingleState({
        status: 'error',
        identifier: numeric,
        error: {
          ok: false,
          success: false,
          category: 'NETWORK',
          human_message: 'Le backend Chorus Pilot est injoignable.',
          raw_message: message,
          recommended_action: 'Vérifier que le bridge FastAPI est démarré et accessible.',
        },
      });
    }
  }

  async function handleBulkConsult() {
    const identifiers = parseBulkInput(bulkInput);
    if (identifiers.length === 0) {
      setBulkState({
        status: 'idle',
        globalError: 'Aucun identifiant valide détecté. Coller des entiers (un par ligne, ou séparés par virgule).',
      });
      return;
    }

    setBulkState({
      status: 'loading',
      rows: bulkRows,
      responseRows,
      pendingRows,
      totalStored: dbRows.length,
      detailSuccess: bulkRows.length,
      detailFailed: 0,
      totalRequested: identifiers.length,
      processed: 0,
      note: bulkRows.length > 0
        ? 'Cache PostgreSQL utilisé. Chorus sera consulté uniquement pour les identifiants absents du cache.'
        : 'Consultation Chorus uniquement pour les identifiants absents du cache...',
    });
    try {
      const config = resolveChorusRuntimeConfig(loadChorusConfig());
      const client = new ChorusBackendAutomationClient(config);
      const refreshedRows = await refetchRowsFromSqlCache();
      const refreshedRowsById = new Map(refreshedRows.map((row) => [row.identifiantFactureCPP, row]));
      const baseRows = identifiers.map((identifier) =>
        refreshedRowsById.get(identifier) ?? rowsById.get(identifier) ?? {
          identifiantFactureCPP: identifier,
          facture: emptyReceptionInvoice(identifier),
          detailStatus: 'database' as const,
        },
      );
      const enriched = await enrichRowsWithReceptionDetails(client, baseRows, {
        onProgress: (processed, total) => {
          setBulkState((current) =>
            current.status === 'loading'
              ? { ...current, processed, totalRequested: total > 0 ? total : current.totalRequested }
              : current,
          );
        },
      });
      const rowsAfterDetailCacheUpdate = await refetchRowsFromSqlCache();
      const cachedRowsAfterDetailById = new Map(
        rowsAfterDetailCacheUpdate.map((row) => [row.identifiantFactureCPP, row]),
      );
      const displayRows = identifiers
        .map((identifier) => {
          const cached = cachedRowsAfterDetailById.get(identifier);
          if (cached?.detailStatus === 'detail') return cached;
          return enriched.rows.find(
            (row) => row.identifiantFactureCPP === identifier && row.detailStatus === 'detail',
          ) ?? null;
        })
        .filter((row): row is ReceptionDisplayRow => row !== null);
      const errors = enriched.rows
        .map((row) => row.error)
        .filter((error): error is ReceptionBulkResultError => !!error);
      const classifiedRows = applyReceptionErrors(
        identifiers
          .map((identifier) => cachedRowsAfterDetailById.get(identifier) ?? enriched.rows.find((row) => row.identifiantFactureCPP === identifier))
          .filter((row): row is ReceptionDisplayRow => row !== undefined),
        errors,
      );
      const { responseRows: separatedResponseRows, pendingRows: separatedPendingRows } = splitBusinessRows(classifiedRows);
      setBulkState({
        status: 'done',
        rows: displayRows,
        responseRows: separatedResponseRows,
        pendingRows: separatedPendingRows,
        errors,
        totalStored: baseRows.length,
        detailSuccess: displayRows.length,
        detailFailed: separatedPendingRows.filter((row) => row.detailStatus === 'error').length,
        note: `Cache PostgreSQL prioritaire. ${displayRows.length} facture(s) reçue(s), ${separatedResponseRows.length} réponse(s) favorable(s), ${separatedPendingRows.length} à qualifier.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inattendue.';
      setBulkState({
        status: 'idle',
        globalError: `Consultation en masse impossible : ${message}`,
      });
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Inbox className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-semibold">Factures</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/invoices/reception/processed">
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Factures traitées
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleRefresh()}
              disabled={busy}
            >
              {busy
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <RefreshCw className="mr-2 h-4 w-4" />}
              Actualiser
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          La page lit le cache PostgreSQL. Le bouton Actualiser lance la mise à jour Chorus.
        </p>
      </header>

      <BulkConsultCard
        bulkInput={bulkInput}
        onBulkInputChange={setBulkInput}
        onConsult={() => void handleBulkConsult()}
        state={bulkState}
        rows={bulkRows}
        responseRows={responseRows}
        pendingRows={pendingRows}
        busy={busy}
        onPreviewInvoice={openDrawerForInvoice}
      />

      <InvoiceDetailDrawer
        invoice={drawerInvoice}
        open={drawerOpen}
        onOpenChange={(open) => {
          setDrawerOpen(open);
          if (!open) setDrawerInvoice(null);
        }}
      />

      {singleState.status === 'success' && singleState.invoice && <InvoiceDetailPanel invoice={singleState.invoice} />}

      <SingleConsultCard
        identifier={singleIdentifier}
        onIdentifierChange={setSingleIdentifier}
        onConsult={() => void handleSingleConsult()}
        state={singleState}
      />
    </div>
  );
}

export function ProcessedReceptionInvoices() {
  const [drawerInvoice, setDrawerInvoice] = useState<ReceptionInvoice | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const invoicesQuery = useInvoicesQuery({ pageSize: 500 });
  const suppliersQuery = useSuppliersQuery();
  const customersQuery = usePublicCustomersQuery();

  const suppliersById = useMemo(
    () => new Map((suppliersQuery.data ?? []).map((supplier) => [supplier.id, supplier])),
    [suppliersQuery.data],
  );
  const customersById = useMemo(
    () => new Map((customersQuery.data ?? []).map((customer) => [customer.id, customer])),
    [customersQuery.data],
  );
  const processedRows = useMemo(
    () => processedReceptionRows(
      rowsFromDbInvoices(invoicesQuery.data?.items ?? [], suppliersById, customersById),
    ),
    [customersById, invoicesQuery.data?.items, suppliersById],
  );
  const loading = invoicesQuery.isLoading || suppliersQuery.isLoading || customersQuery.isLoading;

  function openDrawerForInvoice(invoice: ReceptionInvoice) {
    setDrawerInvoice(invoice);
    setDrawerOpen(true);
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-success" />
            <h1 className="text-2xl font-semibold">Factures traitées</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/invoices/reception">
                <Inbox className="mr-2 h-4 w-4" />
                Factures reçues
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void invoicesQuery.refetch();
                void suppliersQuery.refetch();
                void customersQuery.refetch();
              }}
              disabled={loading}
            >
              {loading
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <RefreshCw className="mr-2 h-4 w-4" />}
              Actualiser
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Les factures acceptées par l’action de traitement côté valideur sont rangées ici.
        </p>
      </header>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center text-base">
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Historique des traitements ({processedRows.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <SkeletonTable rows={5} columns={8} />
          ) : processedRows.length > 0 ? (
            <ProcessedInvoicesTable rows={processedRows} onPreviewInvoice={openDrawerForInvoice} />
          ) : (
            <EmptyState
              title="Aucune facture traitée"
              description="Les factures disparaîtront de la file de réception dès que Chorus aura accepté l’action de traitement."
            />
          )}
        </CardContent>
      </Card>

      <InvoiceDetailDrawer
        invoice={drawerInvoice}
        open={drawerOpen}
        onOpenChange={(open) => {
          setDrawerOpen(open);
          if (!open) setDrawerInvoice(null);
        }}
      />
    </div>
  );
}

function SingleConsultCard({
  identifier,
  onIdentifierChange,
  onConsult,
  state,
}: {
  identifier: string;
  onIdentifierChange: (value: string) => void;
  onConsult: () => void;
  state: SingleConsultState;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center text-base">
          <FileSearch className="mr-2 h-4 w-4" />
          Consultation simple
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
          <div className="space-y-1.5">
            <Label htmlFor="reception-cpp-id">Identifiant facture CPP</Label>
            <Input
              id="reception-cpp-id"
              inputMode="numeric"
              placeholder="Ex. 8424327"
              value={identifier}
              onChange={(event) => onIdentifierChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && state.status !== 'loading') {
                  onConsult();
                }
              }}
            />
          </div>
          <div className="flex items-end">
            <Button onClick={onConsult} disabled={state.status === 'loading'}>
              {state.status === 'loading'
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <FileSearch className="mr-2 h-4 w-4" />}
              Consulter la facture
            </Button>
          </div>
        </div>
        {state.status === 'error' && state.error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Consultation impossible</AlertTitle>
            <AlertDescription className="space-y-1 text-sm">
              <p>{state.error.human_message}</p>
              {state.error.recommended_action && (
                <p className="text-xs">
                  <strong>Action recommandée :</strong> {state.error.recommended_action}
                </p>
              )}
              {state.error.raw_message && state.error.raw_message !== state.error.human_message && (
                <p className="text-xs text-muted-foreground">
                  Détail : {state.error.raw_message}
                </p>
              )}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function BulkConsultCard({
  bulkInput,
  onBulkInputChange,
  onConsult,
  state,
  rows,
  responseRows,
  pendingRows,
  busy,
  onPreviewInvoice,
}: {
  bulkInput: string;
  onBulkInputChange: (value: string) => void;
  onConsult: () => void;
  state: BulkConsultState;
  rows: ReceptionDisplayRow[];
  responseRows: ReceptionDisplayRow[];
  pendingRows: ReceptionDisplayRow[];
  busy: boolean;
  onPreviewInvoice: (invoice: ReceptionInvoice) => void;
}) {
  const isLoading = state.status === 'loading';
  const hasAnyRows = rows.length > 0 || responseRows.length > 0 || pendingRows.length > 0;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center text-base">
          <ClipboardList className="mr-2 h-4 w-4" />
          Consultation en masse
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.globalError && (
          <Alert variant="destructive" className="animate-fade-in-up">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{state.globalError}</AlertDescription>
          </Alert>
        )}

        {state.note && !state.globalError && (
          <Alert className="animate-fade-in-up">
            <Inbox className="h-4 w-4" />
            <AlertDescription>{state.note}</AlertDescription>
          </Alert>
        )}

        {isLoading && (state.totalRequested ?? 0) > 0 && (
          <BulkProgress
            processed={state.processed ?? 0}
            total={state.totalRequested ?? 0}
            label="Consultation Chorus en cours"
          />
        )}

        {hasAnyRows ? (
          <>
            <BulkSummaryStrip
              received={rows.length}
              responses={responseRows.length}
              pending={pendingRows.length}
              totalStored={state.totalStored ?? rows.length + responseRows.length + pendingRows.length}
              detailFailed={state.detailFailed ?? pendingRows.filter((row) => row.detailStatus === 'error').length}
            />
            {rows.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Factures reçues</h3>
                <BulkResultsTable rows={rows} onPreviewInvoice={onPreviewInvoice} />
              </div>
            )}
            {responseRows.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Réponses favorables reçues</h3>
                <FavorableResponsesTable rows={responseRows} />
              </div>
            )}
            {pendingRows.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">À qualifier en base</h3>
                <FavorableResponsesTable rows={pendingRows} />
              </div>
            )}
          </>
        ) : isLoading ? (
          <div className="space-y-3">
            <SkeletonKpiGrid count={4} />
            <SkeletonTable rows={5} columns={8} />
          </div>
        ) : (
          !state.globalError && (
            <EmptyState
              title="Aucune facture côté valideur pour l'instant"
              description="Colle une liste d'identifiants Chorus CPP ci-dessous et lance la consultation pour les récupérer en lot."
            />
          )
        )}

        <BulkErrorsList errors={state.errors ?? []} />

        <Separator />

        <div className="space-y-1.5">
          <Label htmlFor="reception-bulk-input">Identifiants facture CPP</Label>
          <Textarea
            id="reception-bulk-input"
            rows={4}
            placeholder={BULK_HINT_PLACEHOLDER}
            value={bulkInput}
            onChange={(event) => onBulkInputChange(event.target.value)}
          />
        </div>
        <div className="flex justify-end">
          <Button onClick={onConsult} disabled={busy || !bulkInput.trim()}>
            {busy
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <ClipboardList className="mr-2 h-4 w-4" />}
            Consulter les factures
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function BulkSummaryStrip({
  received,
  responses,
  pending,
  totalStored,
  detailFailed,
}: {
  received: number;
  responses: number;
  pending: number;
  totalStored: number;
  detailFailed: number;
}) {
  const tiles = [
    { label: 'Factures reçues', value: received, tone: 'text-foreground' },
    { label: 'Réponses favorables', value: responses, tone: 'text-sky-700' },
    { label: 'À qualifier', value: pending, tone: pending > 0 ? 'text-amber-600' : 'text-muted-foreground' },
    { label: 'En base', value: totalStored, tone: 'text-muted-foreground' },
    { label: 'À vérifier', value: detailFailed, tone: detailFailed > 0 ? 'text-amber-600' : 'text-muted-foreground' },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5 stagger-children">
      {tiles.map((tile, index) => (
        <div
          key={tile.label}
          className="rounded-md border bg-card p-3 lift-on-hover"
          style={{ animationDelay: `${index * 60}ms` }}
        >
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{tile.label}</p>
          <p className={`text-2xl font-semibold tabular-nums ${tile.tone}`}>{tile.value}</p>
        </div>
      ))}
    </div>
  );
}

function BulkResultsTable({
  rows,
  onPreviewInvoice,
}: {
  rows: ReceptionDisplayRow[];
  onPreviewInvoice: (invoice: ReceptionInvoice) => void;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Aucune facture récupérée pour cette série d’identifiants.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[900px] text-sm">
        <thead>
          <tr className="border-b bg-muted/30 text-left">
            <th className="p-3 font-medium">ID CPP</th>
            <th className="p-3 font-medium">N° facture</th>
            <th className="p-3 font-medium">Statut</th>
            <th className="p-3 font-medium">Fournisseur</th>
            <th className="p-3 font-medium">Destinataire</th>
            <th className="p-3 font-medium text-right">Montant TTC</th>
            <th className="p-3 font-medium text-right">À payer</th>
            <th className="p-3 font-medium">Dépôt</th>
            <th className="p-3 font-medium">Échéance</th>
            <th className="p-3 font-medium text-center">Rejet</th>
            <th className="p-3 font-medium text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const f = row.facture;
            const overdue = isOverdue(f.dates.dateEcheancePaiement, f.statutFacture);
            const animationDelay = `${Math.min(index, 12) * 40}ms`;
            return (
              <tr
                key={row.identifiantFactureCPP}
                onClick={() => onPreviewInvoice(f)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onPreviewInvoice(f);
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label={`Aperçu facture ${row.identifiantFactureCPP}`}
                className="cursor-pointer border-b last:border-0 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none animate-fade-in-up"
                style={{ animationDelay }}
              >
                <td className="p-3 font-mono text-xs">
                  <div>{row.identifiantFactureCPP}</div>
                  <DetailStatusBadge status={row.detailStatus} />
                </td>
                <td className="p-3">{f.numeroFacture ?? '—'}</td>
                <td className="p-3"><StatusPill value={f.statutFacture} /></td>
                <td className="p-3">
                  <div className="truncate" title={f.fournisseur?.raisonSociale ?? ''}>
                    {f.fournisseur?.raisonSociale ?? '—'}
                  </div>
                </td>
                <td className="p-3">
                  <div className="truncate" title={f.destinataire?.raisonSociale ?? ''}>
                    {f.destinataire?.raisonSociale ?? '—'}
                  </div>
                </td>
                <td className="p-3 text-right">{formatCurrency(f.montants.ttc)}</td>
                <td className="p-3 text-right">{formatCurrency(f.montants.aPayer)}</td>
                <td className="p-3">{f.dates.dateDepot ? formatDate(f.dates.dateDepot) : '—'}</td>
                <td className={`p-3 ${overdue ? 'text-destructive font-medium' : ''}`}>
                  {f.dates.dateEcheancePaiement ? formatDate(f.dates.dateEcheancePaiement) : '—'}
                  {overdue && <span className="ml-1 text-xs">(retard)</span>}
                </td>
                <td className="p-3 text-center">
                  {f.rejetTraite === null
                    ? '—'
                    : f.rejetTraite
                      ? <span className="text-xs text-success">Traité</span>
                      : <span className="text-xs text-destructive">Non traité</span>}
                </td>
                <td className="p-3 text-right" onClick={(event) => event.stopPropagation()}>
                  <Button variant="ghost" size="sm" asChild>
                    <Link to={`/invoices/reception/${row.identifiantFactureCPP}`}>
                      <Eye className="mr-1 h-3.5 w-3.5" /> Détail
                    </Link>
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ProcessedInvoicesTable({
  rows,
  onPreviewInvoice,
}: {
  rows: ReceptionDisplayRow[];
  onPreviewInvoice: (invoice: ReceptionInvoice) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[900px] text-sm">
        <thead>
          <tr className="border-b bg-muted/30 text-left">
            <th className="p-3 font-medium">ID CPP</th>
            <th className="p-3 font-medium">N° facture</th>
            <th className="p-3 font-medium">Statut traité</th>
            <th className="p-3 font-medium">Traitement</th>
            <th className="p-3 font-medium">Fournisseur</th>
            <th className="p-3 font-medium">Destinataire</th>
            <th className="p-3 font-medium text-right">Montant TTC</th>
            <th className="p-3 font-medium">Dépôt</th>
            <th className="p-3 font-medium text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const f = row.facture;
            const processedAt = row.processed?.processedAt;
            const animationDelay = `${Math.min(index, 12) * 40}ms`;
            return (
              <tr
                key={row.identifiantFactureCPP}
                onClick={() => onPreviewInvoice(f)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onPreviewInvoice(f);
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label={`Aperçu facture traitée ${row.identifiantFactureCPP}`}
                className="cursor-pointer border-b last:border-0 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none animate-fade-in-up"
                style={{ animationDelay }}
              >
                <td className="p-3 font-mono text-xs">
                  <div>{row.identifiantFactureCPP}</div>
                  <span className="mt-1 inline-flex rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                    traitée
                  </span>
                </td>
                <td className="p-3">{f.numeroFacture ?? '—'}</td>
                <td className="p-3"><StatusPill value={row.processed?.status ?? f.statutFacture} /></td>
                <td className="p-3">
                  <div>{processedAt ? formatDateTime(processedAt) : '—'}</div>
                  {row.processed?.libelle && (
                    <div className="max-w-[260px] truncate text-xs text-muted-foreground" title={row.processed.libelle}>
                      {row.processed.libelle}
                    </div>
                  )}
                </td>
                <td className="p-3">
                  <div className="max-w-[220px] truncate" title={f.fournisseur?.raisonSociale ?? ''}>
                    {f.fournisseur?.raisonSociale ?? '—'}
                  </div>
                </td>
                <td className="p-3">
                  <div className="max-w-[240px] truncate" title={f.destinataire?.raisonSociale ?? ''}>
                    {f.destinataire?.raisonSociale ?? '—'}
                  </div>
                </td>
                <td className="p-3 text-right">{formatCurrency(f.montants.ttc)}</td>
                <td className="p-3">{f.dates.dateDepot ? formatDate(f.dates.dateDepot) : '—'}</td>
                <td className="p-3 text-right" onClick={(event) => event.stopPropagation()}>
                  <Button variant="ghost" size="sm" asChild>
                    <Link to={`/invoices/reception/${row.identifiantFactureCPP}`}>
                      <Eye className="mr-1 h-3.5 w-3.5" /> Détail
                    </Link>
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FavorableResponsesTable({ rows }: { rows: ReceptionDisplayRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[780px] text-sm">
        <thead>
          <tr className="border-b bg-muted/30 text-left">
            <th className="p-3 font-medium">ID CPP</th>
            <th className="p-3 font-medium">N° facture</th>
            <th className="p-3 font-medium">Statut</th>
            <th className="p-3 font-medium">Fournisseur</th>
            <th className="p-3 font-medium">Destinataire</th>
            <th className="p-3 font-medium text-right">Montant TTC</th>
            <th className="p-3 font-medium">Dépôt</th>
            <th className="p-3 font-medium">Type</th>
            <th className="p-3 font-medium text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const f = row.facture;
            return (
              <tr key={row.identifiantFactureCPP} className="border-b last:border-0">
                <td className="p-3 font-mono text-xs">
                  <div>{row.identifiantFactureCPP}</div>
                  <DetailStatusBadge status={row.detailStatus} />
                </td>
                <td className="p-3">{f.numeroFacture ?? '—'}</td>
                <td className="p-3"><StatusPill value={f.statutFacture} /></td>
                <td className="p-3">
                  <div className="max-w-[220px] truncate" title={f.fournisseur?.raisonSociale ?? ''}>
                    {f.fournisseur?.raisonSociale ?? '—'}
                  </div>
                </td>
                <td className="p-3">
                  <div className="max-w-[240px] truncate" title={f.destinataire?.raisonSociale ?? ''}>
                    {f.destinataire?.raisonSociale ?? '—'}
                  </div>
                </td>
                <td className="p-3 text-right">{formatCurrency(f.montants.ttc)}</td>
                <td className="p-3">{f.dates.dateDepot ? formatDate(f.dates.dateDepot) : '—'}</td>
                <td className="p-3">{f.references.typeFacture ?? f.modeDepot ?? 'Réponse'}</td>
                <td className="p-3 text-right">
                  {row.invoiceId ? (
                    <Button variant="ghost" size="sm" asChild>
                      <Link to={`/invoices/chorus/${encodeURIComponent(row.invoiceId)}`}>
                        <Eye className="mr-1 h-3.5 w-3.5" /> Détail
                      </Link>
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BulkErrorsList({ errors }: { errors: ReceptionBulkResultError[] }) {
  if (errors.length === 0) return null;
  const visibleErrors = errors.slice(0, 8);
  const remaining = Math.max(errors.length - visibleErrors.length, 0);
  return (
    <Alert>
      <XCircle className="h-4 w-4" />
      <AlertTitle>{errors.length} détail(s) Chorus indisponible(s)</AlertTitle>
      <AlertDescription>
        <div className="mt-2 grid gap-2 text-sm md:grid-cols-2">
          {visibleErrors.map((error) => (
            <div key={error.identifiantFactureCPP} className="rounded border bg-muted/20 p-2">
              <span className="font-mono text-xs">ID {error.identifiantFactureCPP}</span>
              <span className="ml-2 text-muted-foreground">{error.category}</span>
            </div>
          ))}
        </div>
        {remaining > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            {remaining} autre(s) détail(s) indisponible(s). Les lignes sans détail Chorus ne sont pas affichées dans le tableau.
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}

function DetailStatusBadge({ status }: { status: ReceptionDisplayRow['detailStatus'] }) {
  if (status === 'detail') {
    return <span className="mt-1 inline-flex rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">facture</span>;
  }
  if (status === 'error') {
    return <span className="mt-1 inline-flex rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">à vérifier</span>;
  }
  if (status === 'database') {
    return <span className="mt-1 inline-flex rounded bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">à qualifier</span>;
  }
  return <span className="mt-1 inline-flex rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">réponse</span>;
}

export function InvoiceDetailPanel({
  invoice,
  identifiantFactureCPP,
}: {
  invoice: ReceptionInvoice;
  identifiantFactureCPP?: number | null;
}) {
  const overdue = isOverdue(invoice.dates.dateEcheancePaiement, invoice.statutFacture);
  const invoiceIdentifier = asPositiveInteger(identifiantFactureCPP)
    ?? asPositiveInteger(invoice.identifiantFactureCPP);
  return (
    <div className="space-y-4">
      {invoice.statutFacture === 'REJETEE' && invoice.rejetTraite === false && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Rejet non traité</AlertTitle>
          <AlertDescription className="text-sm">
            Cette facture est rejetée et le rejet n’est pas encore traité. Une action métier sera
            probablement nécessaire avant de poursuivre le cycle de traitement.
          </AlertDescription>
        </Alert>
      )}

      {invoice.statutFacture === 'SUSPENDUE' && (
        <Alert>
          <PauseCircle className="h-4 w-4" />
          <AlertTitle>Facture suspendue</AlertTitle>
          <AlertDescription className="text-sm">
            Cette facture est suspendue. Consultez le motif ou les pièces nécessaires avant de poursuivre.
          </AlertDescription>
        </Alert>
      )}

      {overdue && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Échéance dépassée</AlertTitle>
          <AlertDescription className="text-sm">
            L’échéance de paiement ({invoice.dates.dateEcheancePaiement && formatDate(invoice.dates.dateEcheancePaiement)})
            est dépassée et la facture n’est pas encore payée.
          </AlertDescription>
        </Alert>
      )}

      {invoice.commentaire && invoice.commentaire.trim() && (
        <Alert>
          <AlertTitle>Commentaire</AlertTitle>
          <AlertDescription className="whitespace-pre-wrap text-sm">
            {invoice.commentaire}
          </AlertDescription>
        </Alert>
      )}

      <InvoiceHeaderCard invoice={invoice} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PartyCard title="Fournisseur" party={invoice.fournisseur} />
        <PartyCard title="Destinataire" party={invoice.destinataire} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <AmountsCard amounts={invoice.montants} />
        <ReferencesCard references={invoice.references} />
      </div>

      <AttachmentsCard
        attachments={invoice.piecesJointes}
        identifiantFactureCPP={invoiceIdentifier}
      />
      <LinesCard lines={invoice.lignesDePoste} />
      <VatRecapCard items={invoice.recapitulatifTva} />
    </div>
  );
}

function StatusPill({ value }: { value: string | null }) {
  return <ChorusStatusBadge value={value} />;
}

function InvoiceHeaderCard({ invoice }: { invoice: ReceptionInvoice }) {
  const cadreLabel = invoice.cadreDeFacturation
    ? invoice.cadreDeFacturation.libelle || invoice.cadreDeFacturation.code || null
    : null;
  const fields: Array<{ label: string; value: string; mono?: boolean }> = [
    {
      label: 'Identifiant CPP',
      value: invoice.identifiantFactureCPP?.toString() ?? '—',
      mono: true,
    },
    { label: 'Mode dépôt', value: invoice.modeDepot ?? '—' },
    {
      label: 'Rejet traité',
      value: invoice.rejetTraite === null ? '—' : invoice.rejetTraite ? 'Oui' : 'Non',
    },
    { label: 'Cadre facturation', value: cadreLabel ?? '—' },
    {
      label: 'Date facture',
      value: invoice.dates.dateFacture ? formatDate(invoice.dates.dateFacture) : '—',
    },
    {
      label: 'Date dépôt',
      value: invoice.dates.dateDepot ? formatDate(invoice.dates.dateDepot) : '—',
    },
    {
      label: 'Date création',
      value: invoice.dates.dateCreationFacture ?? '—',
    },
    {
      label: 'Échéance paiement',
      value: invoice.dates.dateEcheancePaiement ? formatDate(invoice.dates.dateEcheancePaiement) : '—',
    },
    { label: 'Type facture', value: invoice.references.typeFacture ?? '—' },
    { label: 'Type TVA', value: invoice.references.typeTva ?? '—' },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center text-base">
          <Receipt className="mr-2 h-4 w-4" />
          Synthèse facture
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-lg font-semibold leading-tight break-all">
            {invoice.numeroFacture ?? '—'}
          </span>
          <StatusPill value={invoice.statutFacture} />
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
          {fields.map((field) => (
            <div key={field.label} className="min-w-0 space-y-0.5">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                {field.label}
              </dt>
              <dd
                className={`truncate font-medium ${field.mono ? 'font-mono text-xs' : ''}`}
                title={field.value}
              >
                {field.value}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function PartyCard({ title, party }: { title: string; party: ReceptionInvoice['fournisseur'] }) {
  const addressLines = party?.adresse
    ? [
        party.adresse.ligne,
        [party.adresse.codePostal, party.adresse.ville].filter(Boolean).join(' ').trim() || null,
        party.adresse.libellePays || party.adresse.codePays,
      ].filter((line): line is string => Boolean(line && line.trim()))
    : [];
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>
        {!party ? (
          <p className="text-sm text-muted-foreground">Aucune information.</p>
        ) : (
          <div className="space-y-2 text-sm">
            <InfoRow label="Raison sociale" value={party.raisonSociale ?? '—'} />
            <InfoRow label="SIRET" value={party.siret ?? '—'} />
            <InfoRow label="ID Chorus" value={party.id ?? '—'} />
            {party.code && party.code !== party.siret && (
              <InfoRow label="Code" value={party.code} />
            )}
            {party.typeIdentifiant && <InfoRow label="Type identifiant" value={party.typeIdentifiant} />}
            {party.codeService && <InfoRow label="Service" value={party.codeService} />}
            {party.serviceExecutantLibelle && (
              <InfoRow label="Service exécutant" value={party.serviceExecutantLibelle} />
            )}
            {party.serviceExecutantId && (
              <InfoRow label="ID service exécutant" value={party.serviceExecutantId} />
            )}
            {party.miseEnPaiement !== null && (
              <InfoRow label="Mise en paiement" value={party.miseEnPaiement ? 'Oui' : 'Non'} />
            )}
            {addressLines.length > 0 && (
              <div className="rounded-md border bg-muted/30 p-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Adresse</p>
                <p className="mt-1 whitespace-pre-line text-sm">{addressLines.join('\n')}</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AmountsCard({ amounts }: { amounts: ReceptionInvoice['montants'] }) {
  const remiseApplied = amounts.remiseGlobaleTtc > 0;
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Montants</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        <InfoRow label="Montant HT" value={formatCurrency(amounts.ht)} />
        <InfoRow label="TVA" value={formatCurrency(amounts.tva)} />
        <Separator />
        {remiseApplied && amounts.ttcAvantRemiseGlobale !== null && (
          <>
            <InfoRow
              label="TTC avant remise"
              value={formatCurrency(amounts.ttcAvantRemiseGlobale)}
            />
            <InfoRow
              label="Remise globale TTC"
              value={`- ${formatCurrency(amounts.remiseGlobaleTtc)}`}
            />
          </>
        )}
        <InfoRow label="Montant TTC" value={formatCurrency(amounts.ttc)} bold />
        <InfoRow label="Montant à payer" value={formatCurrency(amounts.aPayer)} bold />
        <InfoRow
          label="Devise"
          value={amounts.libelleDevise ? `${amounts.devise} — ${amounts.libelleDevise}` : amounts.devise}
        />
      </CardContent>
    </Card>
  );
}

function ReferencesCard({ references }: { references: ReceptionInvoice['references'] }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Références</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        <InfoRow label="Mode paiement" value={references.modePaiement ?? '—'} />
        <InfoRow label="N° bon de commande" value={references.numeroBonCommande ?? '—'} />
        <InfoRow label="N° marché" value={references.numeroMarche ?? '—'} />
        <InfoRow label="N° DP / mandat" value={references.numeroDpMandat ?? '—'} />
        <InfoRow label="N° facture origine" value={references.numeroFactureOrigine ?? '—'} />
        <InfoRow label="Motif exonération TVA" value={references.motifExonerationTva ?? '—'} />
      </CardContent>
    </Card>
  );
}

function AttachmentsCard({
  attachments,
  identifiantFactureCPP,
}: {
  attachments: ReceptionInvoiceAttachment[];
  identifiantFactureCPP?: unknown;
}) {
  const invoiceIdentifier = asPositiveInteger(identifiantFactureCPP);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="flex items-center">
            <Paperclip className="mr-2 h-4 w-4" />
            Pièces jointes <span className="ml-2 text-xs text-muted-foreground">({attachments.length})</span>
          </span>
          {invoiceIdentifier !== null && (
            <DownloadToolbar identifiantFactureCPP={invoiceIdentifier} />
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {attachments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune pièce jointe retournée.</p>
        ) : (
          <ul className="space-y-2">
            {attachments.map((attachment, index) => (
              <li
                key={`${attachment.role}-${attachment.pieceJointeId ?? index}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                      {attachment.role === 'PRINCIPALE' ? 'Principale' : 'Complémentaire'}
                    </span>
                    <span className="truncate font-medium">{attachment.designation ?? '—'}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {[attachment.typeLibelle ?? attachment.typeCode, attachment.extension]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">ID {attachment.pieceJointeId ?? '—'}</div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function DownloadToolbar({ identifiantFactureCPP }: { identifiantFactureCPP: number }) {
  const [loading, setLoading] = useState<ReceptionDownloadFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload(format: ReceptionDownloadFormat) {
    const previewWindow = format === 'PDF' ? window.open('about:blank', '_blank') : null;
    if (previewWindow) {
      previewWindow.opener = null;
    }
    setLoading(format);
    setError(null);
    try {
      const config = resolveChorusRuntimeConfig(loadChorusConfig());
      const result = await new ChorusBackendAutomationClient(config).downloadReceivedInvoice({
        idFacture: identifiantFactureCPP,
        format,
        avecPiecesJointesComplementaires: format === 'ZIP' ? true : undefined,
      });
      if (!result.ok) {
        previewWindow?.close();
        setError(result.human_message || 'Téléchargement impossible.');
        return;
      }

      const objectUrl = URL.createObjectURL(result.blob);
      if (format === 'PDF') {
        if (previewWindow) {
          previewWindow.location.href = objectUrl;
        } else {
          // Si le navigateur bloque l'ouverture, on retombe sur le téléchargement.
          triggerBrowserDownload(objectUrl, result.filename);
        }
      } else {
        triggerBrowserDownload(objectUrl, result.filename);
      }
      // Le navigateur garde une référence le temps du download/preview ; on
      // libère plus tard sans bloquer le clic.
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    } catch (downloadError) {
      previewWindow?.close();
      const message = downloadError instanceof Error
        ? downloadError.message
        : 'Téléchargement impossible (erreur réseau).';
      setError(message);
    } finally {
      setLoading(null);
    }
  }

  const buttons: Array<{
    format: ReceptionDownloadFormat;
    label: string;
    Icon: typeof Download;
  }> = [
    { format: 'PDF', label: 'Voir PDF', Icon: FileText },
    { format: 'XML', label: 'XML', Icon: Download },
    { format: 'ZIP', label: 'ZIP + PJ', Icon: FileArchive },
  ];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {buttons.map(({ format, label, Icon }) => (
        <Button
          key={format}
          variant="outline"
          size="sm"
          onClick={() => void handleDownload(format)}
          disabled={loading !== null}
          aria-label={`Télécharger la facture au format ${format}`}
        >
          {loading === format
            ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            : <Icon className="mr-1.5 h-3.5 w-3.5" />}
          {label}
        </Button>
      ))}
      {error && (
        <span className="basis-full pt-1 text-xs text-destructive" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

function triggerBrowserDownload(objectUrl: string, filename: string) {
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function LinesCard({ lines }: { lines: ReceptionInvoice['lignesDePoste'] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Lignes de poste ({lines.length})</CardTitle>
      </CardHeader>
      <CardContent>
        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune ligne retournée.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-left">
                  <th className="p-3 font-medium">#</th>
                  <th className="p-3 font-medium">Référence</th>
                  <th className="p-3 font-medium">Désignation</th>
                  <th className="p-3 font-medium text-right">Qté</th>
                  <th className="p-3 font-medium text-right">PU HT</th>
                  <th className="p-3 font-medium">TVA</th>
                  <th className="p-3 font-medium text-right">HT après remise</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr key={`${line.numero}-${index}`} className="border-b last:border-0">
                    <td className="p-3 font-mono text-xs">{line.numero}</td>
                    <td className="p-3">{line.reference ?? '—'}</td>
                    <td className="p-3">{line.denomination ?? '—'}</td>
                    <td className="p-3 text-right">{line.quantite ?? '—'}</td>
                    <td className="p-3 text-right">{line.puHt !== null ? formatCurrency(line.puHt) : '—'}</td>
                    <td className="p-3">{line.tauxTva ?? '—'}</td>
                    <td className="p-3 text-right">
                      {line.montantHtApresRemise !== null ? formatCurrency(line.montantHtApresRemise) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function VatRecapCard({ items }: { items: ReceptionInvoice['recapitulatifTva'] }) {
  if (items.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Récapitulatif TVA</CardTitle></CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-left">
                <th className="p-3 font-medium">Taux</th>
                <th className="p-3 font-medium text-right">Base HT</th>
                <th className="p-3 font-medium text-right">Montant TVA</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row, index) => (
                <tr key={`${row.taux ?? 'tva'}-${index}`} className="border-b last:border-0">
                  <td className="p-3">{row.taux ?? '—'}</td>
                  <td className="p-3 text-right">{row.baseHt !== null ? formatCurrency(row.baseHt) : '—'}</td>
                  <td className="p-3 text-right">{row.montantTva !== null ? formatCurrency(row.montantTva) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
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

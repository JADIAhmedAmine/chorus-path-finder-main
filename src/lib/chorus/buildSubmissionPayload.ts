import { normalizeInvoiceDraft } from '@/lib/chorus/normalization';
import {
  computeSubmissionTotals,
  inferChorusVatType,
  normalizeFrenchDateToIsoDate,
  normalizeSiret,
  normalizeSubmissionLineItems,
  normalizeSubmissionVatLines,
} from '@/lib/chorus/normalizeSubmissionData';
import type {
  ChorusPayloadBuildContext,
  ChorusSubmissionMainAttachment,
  ChorusSubmissionPayload,
  InvoiceDraftFormData,
  NormalizedInvoiceDraftData,
} from '@/lib/chorus/types';

function sanitizeText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function asInteger(value: number | string | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
  }

  return undefined;
}

function inferMainAttachmentDesignation(mainFileName: string | undefined): string {
  return sanitizeText(mainFileName) || 'Facture principale';
}

export function buildChorusSubmissionPayload(
  normalized: NormalizedInvoiceDraftData,
  context: ChorusPayloadBuildContext = {},
): ChorusSubmissionPayload {
  const chorusContext = context.chorus ?? {};
  const lignePoste = normalizeSubmissionLineItems(
    chorusContext.lineItems ?? normalized.lineItems,
    normalized,
  );
  const ligneTva = normalizeSubmissionVatLines(
    chorusContext.vatLines ?? normalized.vatLines,
    normalized,
  );
  const totals = computeSubmissionTotals(normalized, ligneTva);
  const typeTva = chorusContext.typeTva
    ?? inferChorusVatType(totals.montantTVA, chorusContext.motifExonerationTva);
  const modeDepot = chorusContext.submissionMode ?? 'SAISIE_API';
  const pieceJointePrincipale: ChorusSubmissionMainAttachment[] = modeDepot === 'SAISIE_API'
    ? []
    : [{
        pieceJointePrincipaleDesignation: inferMainAttachmentDesignation(context.mainFileName),
      }];

  return {
    cadreDeFacturation: {
      codeCadreFacturation: chorusContext.codeCadreFacturation ?? 'A1_FACTURE_FOURNISSEUR',
      codeServiceValideur: sanitizeText(chorusContext.codeServiceValideur),
      codeStructureValideur: sanitizeText(chorusContext.codeStructureValideur),
    },
    commentaire: sanitizeText(chorusContext.commentaire),
    dateFacture: normalizeFrenchDateToIsoDate(normalized.invoiceDate),
    destinataire: {
      codeDestinataire: sanitizeText(normalized.publicCustomerCode) ?? normalizeSiret(normalized.publicCustomerSiret),
      codeServiceExecutant: sanitizeText(normalized.publicServiceCode),
    },
    fournisseur: {
      codeCoordonneesBancairesFournisseur: asInteger(chorusContext.codeCoordonneesBancairesFournisseur),
      idFournisseur: asInteger(chorusContext.idFournisseur),
      idServiceFournisseur: asInteger(chorusContext.idServiceFournisseur),
    },
    idUtilisateurCourant: asInteger(chorusContext.idUtilisateurCourant),
    lignePoste,
    ligneTva,
    modeDepot,
    montantTotal: {
      montantAPayer: totals.montantAPayer,
      montantHtTotal: totals.montantHtTotal,
      montantRemiseGlobaleTTC: 0,
      montantTVA: totals.montantTVA,
      montantTtcTotal: totals.montantTtcTotal,
      motifRemiseGlobaleTTC: '',
    },
    numeroFactureSaisi: sanitizeText(normalized.supplierInvoiceNumber),
    pieceJointeComplementaire: [],
    pieceJointePrincipale,
    references: {
      deviseFacture: sanitizeText(normalized.currencyCode) || 'EUR',
      modePaiement: chorusContext.modePaiement ?? 'CHEQUE',
      motifExonerationTva: sanitizeText(chorusContext.motifExonerationTva),
      numeroBonCommande: sanitizeText(normalized.purchaseOrderNumber) || sanitizeText(normalized.engagementNumber),
      numeroFactureOrigine: sanitizeText(chorusContext.numeroFactureOrigine),
      numeroMarche: sanitizeText(normalized.marketNumber),
      typeFacture: chorusContext.typeFacture ?? 'FACTURE',
      typeTva,
    },
  };
}

export function buildChorusSubmissionPayloadFromDraft(
  formData: InvoiceDraftFormData,
  context: ChorusPayloadBuildContext = {},
): ChorusSubmissionPayload {
  const normalized = normalizeInvoiceDraft(formData, context);
  return buildChorusSubmissionPayload(normalized, context);
}

export function finalizeChorusSubmissionPayloadForPdfDeposit(
  payload: ChorusSubmissionPayload,
  input: {
    mainFileId?: number | string;
    mainFileName?: string;
  },
): ChorusSubmissionPayload {
  const pieceJointePrincipaleId = asInteger(input.mainFileId);
  const fallbackDesignation = inferMainAttachmentDesignation(input.mainFileName);
  const nextMainAttachment = payload.pieceJointePrincipale[0] ?? {
    pieceJointePrincipaleDesignation: fallbackDesignation,
  };

  return {
    ...payload,
    modeDepot: payload.modeDepot === 'DEPOT_PDF_SIGNE_API' ? payload.modeDepot : 'DEPOT_PDF_API',
    pieceJointePrincipale: [{
      pieceJointePrincipaleDesignation: sanitizeText(nextMainAttachment.pieceJointePrincipaleDesignation) || fallbackDesignation,
      pieceJointePrincipaleId,
    }],
  };
}

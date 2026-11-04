import { FIXED_CHORUS_SUPPLIER_ID } from '@/lib/chorus/constants';
import { normalizeInvoiceDraft } from '@/lib/chorus/normalization';
import {
  computeSubmissionTotals,
  inferChorusVatType,
  normalizeFrenchDateToIsoDate,
  normalizeSubmissionLineItems,
  normalizeSubmissionVatLines,
} from '@/lib/chorus/normalizeSubmissionData';
import type {
  ChorusPayloadBuildContext,
  ChorusSubmissionMainAttachment,
  ChorusSubmissionPayload,
  ChorusVatType,
  InvoiceDraftFormData,
  NormalizedInvoiceDraftData,
} from '@/lib/chorus/types';

function sanitizeText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

const DEFAULT_MAIN_ATTACHMENT_DESIGNATION = 'GCU_MSG_01_000';

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
  const sanitized = sanitizeText(mainFileName);
  return sanitized?.startsWith('GCU_') ? sanitized : DEFAULT_MAIN_ATTACHMENT_DESIGNATION;
}

function normalizeSubmissionVatType(value: ChorusVatType): ChorusVatType {
  return value === 'TVA_SUR_ENCAISSEMENT' ? 'TVA_SUR_DEBIT' : value;
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
  const typeTva = normalizeSubmissionVatType(
    chorusContext.typeTva ?? inferChorusVatType(totals.montantTVA, chorusContext.motifExonerationTva),
  );
  const modeDepot = chorusContext.submissionMode ?? 'SAISIE_API';
  const pieceJointePrincipale: ChorusSubmissionMainAttachment[] = modeDepot === 'SAISIE_API'
    ? []
    : [{
        pieceJointePrincipaleDesignation: inferMainAttachmentDesignation(context.mainFileName),
      }];

  const codeServiceExecutant = sanitizeText(normalized.publicServiceCode);

  return {
    cadreDeFacturation: {
      codeCadreFacturation: chorusContext.codeCadreFacturation ?? 'A1_FACTURE_FOURNISSEUR',
      codeServiceValideur: sanitizeText(chorusContext.codeServiceValideur),
      codeStructureValideur: sanitizeText(chorusContext.codeStructureValideur),
    },
    commentaire: sanitizeText(chorusContext.commentaire),
    dateFacture: normalizeFrenchDateToIsoDate(normalized.invoiceDate),
    destinataire: {
      codeDestinataire: sanitizeText(normalized.publicCustomerCode),
      ...(codeServiceExecutant ? { codeServiceExecutant } : {}),
    },
    fournisseur: {
      codeCoordonneesBancairesFournisseur: asInteger(chorusContext.codeCoordonneesBancairesFournisseur),
      idFournisseur: asInteger(chorusContext.idFournisseur) ?? FIXED_CHORUS_SUPPLIER_ID,
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
    },
    numeroFactureSaisi: sanitizeText(normalized.supplierInvoiceNumber),
    pieceJointePrincipale,
    references: {
      deviseFacture: sanitizeText(normalized.currencyCode) || 'EUR',
      modePaiement: normalized.paymentMode ?? chorusContext.modePaiement ?? 'VIREMENT',
      motifExonerationTva: sanitizeText(chorusContext.motifExonerationTva),
      numeroBonCommande: sanitizeText(normalized.engagementNumber),
      numeroFactureOrigine: sanitizeText(chorusContext.numeroFactureOrigine)
        ?? sanitizeText(context.extraction?.fields.supplierInvoiceNumber),
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

export function attachMainFileToChorusSubmissionPayload(
  payload: ChorusSubmissionPayload,
  input: {
    mainFileId?: number | string;
    mainFileName?: string;
    modeDepot?: ChorusSubmissionPayload['modeDepot'];
  },
): ChorusSubmissionPayload {
  const pieceJointePrincipaleId = asInteger(input.mainFileId);
  const fallbackDesignation = inferMainAttachmentDesignation(input.mainFileName);
  const nextMainAttachment = payload.pieceJointePrincipale[0] ?? {
    pieceJointePrincipaleDesignation: fallbackDesignation,
  };

  return {
    ...payload,
    modeDepot: input.modeDepot ?? payload.modeDepot,
    pieceJointePrincipale: [{
      pieceJointePrincipaleDesignation: sanitizeText(nextMainAttachment.pieceJointePrincipaleDesignation) || fallbackDesignation,
      pieceJointePrincipaleId,
    }],
  };
}

export function finalizeChorusSubmissionPayloadForPdfDeposit(
  payload: ChorusSubmissionPayload,
  input: {
    mainFileId?: number | string;
    mainFileName?: string;
  },
): ChorusSubmissionPayload {
  return attachMainFileToChorusSubmissionPayload(payload, {
    ...input,
    modeDepot: 'DEPOT_PDF_SIGNE_API',
  });
}

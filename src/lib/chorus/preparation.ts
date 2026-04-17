import { normalizeInvoiceDraft } from '@/lib/chorus/normalization';
import type {
  InvoiceDraftFormData,
  InvoiceDraftNormalizationContext,
  NormalizedInvoiceDraftData,
} from '@/lib/chorus/types';
import type { InvoiceStatusInternal, PublicService, ValidationResult } from '@/types';

export type ChorusPreparationState = 'blocked' | 'review' | 'ready';

export interface ChorusPreparationInput extends InvoiceDraftNormalizationContext {
  formData: InvoiceDraftFormData;
  publicService?: Pick<PublicService, 'id' | 'publicCustomerId' | 'codeServiceExecutant' | 'label' | 'engagementRequired' | 'purchaseOrderRequired'>;
  availableServices?: Pick<PublicService, 'id' | 'publicCustomerId' | 'codeServiceExecutant' | 'label' | 'engagementRequired' | 'purchaseOrderRequired'>[];
}

export interface ChorusPreparationResult {
  readiness: ChorusPreparationState;
  suggestedStatus: Extract<InvoiceStatusInternal, 'PENDING_HUMAN_REVIEW' | 'READY_FOR_SUBMISSION'>;
  validation: ValidationResult;
  normalized: NormalizedInvoiceDraftData;
  recommendations: string[];
}

function uniqueMessages(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function prepareInvoiceSubmission(input: ChorusPreparationInput): ChorusPreparationResult {
  const { formData, supplier, publicCustomer, publicService, extraction } = input;
  const availableServices = input.availableServices ?? [];
  const normalized = normalizeInvoiceDraft(formData, input);
  const extractedFields = extraction?.fields;
  const errors: ValidationResult['errors'] = [];
  const warnings: ValidationResult['warnings'] = [];
  const recommendations: string[] = [];

  if (!normalized.supplierOrganizationId && !normalized.supplierSiret) {
    errors.push({
      field: 'supplierOrganizationId',
      code: 'SUPPLIER_REQUIRED',
      message: 'Le fournisseur doit être identifié avant la soumission.',
    });
  }

  if (!normalized.supplierInvoiceNumber) {
    errors.push({
      field: 'supplierInvoiceNumber',
      code: 'INVOICE_NUMBER_REQUIRED',
      message: 'Le numéro de facture est obligatoire.',
    });
  }

  if (!normalized.invoiceDate) {
    errors.push({
      field: 'invoiceDate',
      code: 'INVOICE_DATE_REQUIRED',
      message: 'La date de facture est obligatoire.',
    });
  }

  if (!normalized.publicCustomerId && !normalized.publicCustomerSiret) {
    errors.push({
      field: 'publicCustomerId',
      code: 'PUBLIC_CUSTOMER_REQUIRED',
      message: 'Le destinataire public doit être identifié.',
    });
  }

  if (normalized.publicCustomerId && availableServices.length > 0 && !normalized.publicServiceId) {
    errors.push({
      field: 'publicServiceId',
      code: 'PUBLIC_SERVICE_REQUIRED',
      message: 'Le service destinataire doit être sélectionné pour ce client public.',
    });
  }

  if (!normalized.currencyCode) {
    errors.push({
      field: 'currencyCode',
      code: 'CURRENCY_REQUIRED',
      message: 'La devise doit être renseignée.',
    });
  }

  if (normalized.totalAmountTtc === undefined) {
    errors.push({
      field: 'totalAmountTtc',
      code: 'TOTAL_TTC_REQUIRED',
      message: 'Le montant TTC est requis pour préparer la soumission Chorus.',
    });
  } else if (normalized.totalAmountTtc <= 0) {
    errors.push({
      field: 'totalAmountTtc',
      code: 'TOTAL_TTC_INVALID',
      message: 'Le montant TTC doit être strictement positif.',
    });
  }

  if (publicService?.engagementRequired && !normalized.engagementNumber) {
    errors.push({
      field: 'engagementNumber',
      code: 'ENGAGEMENT_REQUIRED',
      message: 'Le numéro d’engagement est obligatoire pour le service destinataire sélectionné.',
    });
  }

  if (publicService?.purchaseOrderRequired && !normalized.purchaseOrderNumber) {
    errors.push({
      field: 'purchaseOrderNumber',
      code: 'PURCHASE_ORDER_REQUIRED',
      message: 'Le numéro de bon de commande est obligatoire pour ce service.',
    });
  }

  if (normalized.totalAmountHt === undefined) {
    warnings.push({
      field: 'totalAmountHt',
      code: 'TOTAL_HT_RECOMMENDED',
      message: 'Le montant HT n’a pas été détecté. Il est conseillé de le confirmer avant l’envoi.',
    });
  }

  if (!normalized.marketNumber) {
    warnings.push({
      field: 'marketNumber',
      code: 'MARKET_NUMBER_MISSING',
      message: 'Le numéro de marché n’est pas renseigné. Vérifie s’il est attendu pour cette facture.',
    });
  }

  if (extraction?.requiresReview) {
    warnings.push({
      field: 'extraction',
      code: 'EXTRACTION_REVIEW_REQUIRED',
      message: 'L’extraction locale demande encore un contrôle humain avant soumission.',
    });
  }

  if (extraction?.confidence !== undefined && extraction.confidence < 0.85) {
    warnings.push({
      field: 'extraction',
      code: 'LOW_EXTRACTION_CONFIDENCE',
      message: `La confiance d’extraction est de ${Math.round(extraction.confidence * 100)}%.`,
    });
  }

  if (extractedFields?.supplierSiret && supplier?.siret && extractedFields.supplierSiret !== supplier.siret) {
    warnings.push({
      field: 'supplierOrganizationId',
      code: 'SUPPLIER_SIRET_MISMATCH',
      message: 'Le fournisseur sélectionné ne correspond pas au SIRET détecté dans la facture.',
    });
  }

  if (extractedFields?.publicCustomerSiret && publicCustomer?.siret && extractedFields.publicCustomerSiret !== publicCustomer.siret) {
    warnings.push({
      field: 'publicCustomerId',
      code: 'PUBLIC_CUSTOMER_SIRET_MISMATCH',
      message: 'Le client public sélectionné diffère du SIRET destinataire détecté.',
    });
  }

  if (extractedFields?.publicServiceCode && publicService?.codeServiceExecutant && extractedFields.publicServiceCode !== publicService.codeServiceExecutant) {
    warnings.push({
      field: 'publicServiceId',
      code: 'PUBLIC_SERVICE_CODE_MISMATCH',
      message: 'Le service sélectionné diffère du code service détecté.',
    });
  }

  if (!publicService && normalized.publicCustomerId && availableServices.length === 0) {
    warnings.push({
      field: 'publicServiceId',
      code: 'NO_ACTIVE_SERVICE_REFERENCE',
      message: 'Aucun service actif n’est référencé localement pour ce client public.',
    });
  }

  const validation: ValidationResult = {
    valid: errors.length === 0,
    errors,
    warnings,
  };

  if (errors.some((error) => error.field === 'publicServiceId')) {
    recommendations.push('Sélectionner le service destinataire avant l’envoi API.');
  }
  if (errors.some((error) => error.field === 'engagementNumber')) {
    recommendations.push('Compléter le numéro d’engagement demandé par le service.');
  }
  if (errors.some((error) => error.field === 'purchaseOrderNumber')) {
    recommendations.push('Ajouter le bon de commande avant la soumission Chorus.');
  }
  if (errors.some((error) => error.field === 'publicCustomerId')) {
    recommendations.push('Identifier le destinataire public à partir du SIRET ou du code destinataire.');
  }
  if (warnings.some((warning) => warning.code === 'EXTRACTION_REVIEW_REQUIRED')) {
    recommendations.push('Relire les champs préremplis avant de contourner définitivement l’extraction Chorus.');
  }

  const readiness: ChorusPreparationState = errors.length > 0
    ? 'blocked'
    : warnings.length > 0
      ? 'review'
      : 'ready';

  return {
    readiness,
    suggestedStatus: readiness === 'ready' ? 'READY_FOR_SUBMISSION' : 'PENDING_HUMAN_REVIEW',
    validation,
    normalized,
    recommendations: uniqueMessages(recommendations),
  };
}

import type { PublicCustomer, PublicService, SupplierOrganization } from '@/types';

export type InvoiceSourceFormat = 'PDF' | 'XML';

export interface InvoiceExtractionReferences {
  suppliers: Pick<SupplierOrganization, 'id' | 'legalName' | 'siret'>[];
  publicCustomers: Pick<PublicCustomer, 'id' | 'legalName' | 'siret' | 'codeDestinataire'>[];
  publicServices: Pick<PublicService, 'id' | 'publicCustomerId' | 'codeServiceExecutant' | 'label'>[];
}

export interface InvoiceDraftFormData {
  supplierOrganizationId: string;
  supplierSiret?: string;
  supplierName?: string;
  supplierVatNumber?: string;
  supplierInvoiceNumber: string;
  publicCustomerId: string;
  publicCustomerCode?: string;
  publicCustomerName?: string;
  publicServiceId: string;
  publicServiceCode?: string;
  publicServiceLabel?: string;
  engagementNumber: string;
  marketNumber: string;
  purchaseOrderNumber: string;
  invoiceDate: string;
  dueDate?: string;
  currencyCode: string;
  paymentMode?: ChorusPaymentMode;
  totalAmountHt: string;
  totalAmountTtc: string;
  totalVat?: number;
  customerReference?: string;
  lineItems?: ExtractedInvoiceLineItemData[];
  vatLines?: ExtractedInvoiceVatLineData[];
}

export interface ExtractedInvoiceLineItemData {
  description?: string;
  reference?: string;
  quantity?: number;
  unit?: string;
  unitPriceHt?: number;
  discountHt?: number;
  totalHt?: number;
  vatRate?: number;
}

export interface ExtractedInvoiceVatLineData {
  rate?: number;
  baseHt?: number;
  taxAmount?: number;
}

export interface ExtractedInvoiceDraftData {
  supplierOrganizationId?: string;
  supplierInvoiceNumber?: string;
  supplierName?: string;
  paymentMode?: ChorusPaymentMode;
  publicCustomerId?: string;
  publicCustomerName?: string;
  publicServiceId?: string;
  publicServiceLabel?: string;
  engagementNumber?: string;
  marketNumber?: string;
  purchaseOrderNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  currencyCode?: string;
  supplierSiret?: string;
  supplierVatNumber?: string;
  publicCustomerSiret?: string;
  publicServiceCode?: string;
  publicCustomerCode?: string;
  customerReference?: string;
  totalAmountHt?: number;
  totalVat?: number;
  totalAmountTtc?: number;
  lineItems?: ExtractedInvoiceLineItemData[];
  vatLines?: ExtractedInvoiceVatLineData[];
}

export interface LocalInvoiceExtractionResult {
  sourceFormat: InvoiceSourceFormat;
  fields: ExtractedInvoiceDraftData;
  confidence: number;
  requiresReview: boolean;
  warnings: string[];
  rawText: string;
  rawTextPreview: string;
}

export interface InvoiceDraftNormalizationContext {
  supplier?: Pick<SupplierOrganization, 'id' | 'legalName' | 'siret'>;
  publicCustomer?: Pick<PublicCustomer, 'id' | 'legalName' | 'siret' | 'codeDestinataire'>;
  publicService?: Pick<PublicService, 'id' | 'publicCustomerId' | 'codeServiceExecutant' | 'label'>;
  availableServices?: Pick<PublicService, 'id' | 'publicCustomerId' | 'codeServiceExecutant' | 'label'>[];
  extraction?: LocalInvoiceExtractionResult | null;
}

export interface NormalizedInvoiceDraftData {
  supplierOrganizationId?: string;
  supplierInvoiceNumber?: string;
  supplierName?: string;
  paymentMode?: ChorusPaymentMode;
  publicCustomerId?: string;
  publicServiceId?: string;
  engagementNumber?: string;
  marketNumber?: string;
  purchaseOrderNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  currencyCode?: string;
  totalAmountHt?: number;
  totalVat?: number;
  totalAmountTtc?: number;
  supplierSiret?: string;
  supplierVatNumber?: string;
  publicCustomerSiret?: string;
  publicCustomerName?: string;
  publicCustomerCode?: string;
  publicServiceCode?: string;
  publicServiceLabel?: string;
  customerReference?: string;
  lineItems?: ExtractedInvoiceLineItemData[];
  vatLines?: ExtractedInvoiceVatLineData[];
  sourceFormat?: InvoiceSourceFormat;
  extractionConfidence?: number;
  requiresHumanReview?: boolean;
}

export type ChorusSubmissionMode = 'SAISIE_API' | 'DEPOT_PDF_API' | 'DEPOT_PDF_SIGNE_API';
export type ChorusInvoiceType = 'FACTURE' | 'AVOIR';
export type ChorusVatType = 'TVA_SUR_DEBIT' | 'TVA_SUR_ENCAISSEMENT' | 'EXONERATION' | 'SANS_TVA';
export type ChorusPaymentMode = 'CHEQUE' | 'ESPECE' | 'VIREMENT' | 'PRELEVEMENT' | 'AUTRE' | 'REPORT';

export interface ChorusSubmissionCadreDeFacturation {
  codeCadreFacturation: string;
  codeServiceValideur?: string;
  codeStructureValideur?: string;
}

export interface ChorusSubmissionDestinataire {
  codeDestinataire?: string;
  codeServiceExecutant?: string;
}

export interface ChorusSubmissionFournisseur {
  codeCoordonneesBancairesFournisseur?: number;
  idFournisseur?: number;
}

export interface ChorusSubmissionLineItem {
  lignePosteDenomination: string;
  lignePosteMontantRemiseHT?: number;
  lignePosteMontantUnitaireHT: number;
  lignePosteNumero: number;
  lignePosteQuantite: number;
  lignePosteReference?: string;
  lignePosteTauxTva?: string;
  lignePosteTauxTvaManuel?: number;
  lignePosteUnite: string;
}

export interface ChorusSubmissionVatLine {
  ligneTvaMontantBaseHtParTaux: number;
  ligneTvaMontantTvaParTaux: number;
  ligneTvaTaux?: string;
  ligneTvaTauxManuel?: number;
}

export interface ChorusSubmissionMontantTotal {
  montantAPayer: number;
  montantHtTotal: number;
  montantRemiseGlobaleTTC?: number;
  montantTVA: number;
  montantTtcTotal: number;
  motifRemiseGlobaleTTC?: string;
}

export interface ChorusSubmissionMainAttachment {
  pieceJointePrincipaleDesignation: string;
  pieceJointePrincipaleId?: number;
}

export interface ChorusSubmissionAdditionalAttachment {
  pieceJointeComplementaireDesignation: string;
  pieceJointeComplementaireId?: number;
  pieceJointeComplementaireIdLiaison?: number;
  pieceJointeComplementaireNumeroLigneFacture?: number;
  pieceJointeComplementaireType?: string;
}

export interface ChorusSubmissionReferences {
  deviseFacture: string;
  modePaiement: ChorusPaymentMode;
  motifExonerationTva?: string;
  numeroBonCommande?: string;
  numeroFactureOrigine?: string;
  numeroMarche?: string;
  typeFacture: ChorusInvoiceType;
  typeTva: ChorusVatType;
}

export interface ChorusSubmissionPayload {
  cadreDeFacturation: ChorusSubmissionCadreDeFacturation;
  commentaire?: string;
  dateFacture?: string;
  destinataire: ChorusSubmissionDestinataire;
  fournisseur: ChorusSubmissionFournisseur;
  idUtilisateurCourant?: number;
  lignePoste: ChorusSubmissionLineItem[];
  ligneTva: ChorusSubmissionVatLine[];
  modeDepot: ChorusSubmissionMode;
  montantTotal: ChorusSubmissionMontantTotal;
  numeroFactureSaisi?: string;
  pieceJointeComplementaire?: ChorusSubmissionAdditionalAttachment[];
  pieceJointePrincipale: ChorusSubmissionMainAttachment[];
  references: ChorusSubmissionReferences;
}

export interface ChorusSubmissionTechnicalContext {
  idUtilisateurCourant?: number;
  codeCadreFacturation?: string;
  codeServiceValideur?: string;
  codeStructureValideur?: string;
  idFournisseur?: number;
  idServiceFournisseur?: number;
  codeCoordonneesBancairesFournisseur?: number;
  modePaiement?: ChorusPaymentMode;
  typeFacture?: ChorusInvoiceType;
  typeTva?: ChorusVatType;
  motifExonerationTva?: string;
  numeroFactureOrigine?: string;
  commentaire?: string;
  submissionMode?: ChorusSubmissionMode;
  lineItems?: ExtractedInvoiceLineItemData[];
  vatLines?: ExtractedInvoiceVatLineData[];
}

export interface ChorusPayloadBuildContext extends InvoiceDraftNormalizationContext {
  chorus?: ChorusSubmissionTechnicalContext;
  mainFileName?: string;
}

export interface ChorusSubmissionValidationIssue {
  path: string;
  code: string;
  message: string;
}

export interface ChorusSubmissionValidationResult {
  valid: boolean;
  errors: ChorusSubmissionValidationIssue[];
  warnings: ChorusSubmissionValidationIssue[];
}

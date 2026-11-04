// Types et miroir client de la logique de détection/compatibilité du backend
// (chorus_python/chorus_flux_detector.py). Le backend reste la source de
// vérité : ce miroir ne sert qu'au retour visuel instantané dans l'UI.

export type DetectedFileType =
  | 'UBL_INVOICE'
  | 'CII_INVOICE'
  | 'CPP_FACTURE_MIXTE'
  | 'FACTURX_CII'
  | 'CHORUS_PIVOT_OUTPUT'
  | 'CHORUS_LIFECYCLE_STATUS_OUTPUT'
  | 'PDF_GENERIC'
  | 'UNKNOWN_XML'
  | 'INVALID_XML';

export type FluxSeverity = 'OK' | 'WARNING' | 'BLOCKING';

export interface FluxDetected {
  detectedFileType: DetectedFileType | string;
  rootElement: string | null;
  namespace: string | null;
  isPdf: boolean;
  isXml: boolean;
  isFacturx: boolean;
  embeddedXmlFilename: string | null;
  embeddedXmlRoot: string | null;
  embeddedXmlNamespace: string | null;
  isDepositCompatible: boolean;
  warnings: string[];
}

export interface FluxCompatibility {
  formatFlux: string | null;
  syntaxeFlux: string | null;
  compatible: boolean | null;
  severity: FluxSeverity;
  recommendedSyntaxes: string[];
  warning: string | null;
}

export interface FluxErrorExplanationDetail {
  message: string;
  source: string | null;
  fix: string | null;
}

export interface FluxErrorExplanation {
  category: string;
  message: string;
  source: string | null;
  fix: string | null;
  details: FluxErrorExplanationDetail[];
}

export interface FluxBusinessIssue {
  code: string;
  field: string;
  xmlPath: string | null;
  currentValue: string | null;
  suggestedFix: string | null;
  line: number | null;
  message: string;
  value: string | null;
}

export interface FluxBusinessExtracted {
  invoiceNumber: string | null;
  supplierIdentifier: string | null;
  supplierBusinessIdentifier: string | null;
  supplierIdentifierType: string | null;
  supplierSiretsConfigured: string[];
  supplierInternalIdsConfigured: string[];
  supplierName: string | null;
  supplierAddress: string | null;
  customerIdentifier: string | null;
  customerName: string | null;
  customerAddress: string | null;
  currency: string | null;
  totalHt: number | null;
  totalTva: number | null;
  totalTtc: number | null;
  taxPercentages: string[];
}

export interface FluxBusinessValidation {
  valid: boolean;
  severity: FluxSeverity;
  errors: FluxBusinessIssue[];
  warnings: FluxBusinessIssue[];
  checks: Record<string, boolean>;
  extracted: FluxBusinessExtracted;
}

const DETECTED_LABELS: Record<string, string> = {
  UBL_INVOICE: 'UBL Invoice (XML)',
  CII_INVOICE: 'CII / CrossIndustryInvoice (XML)',
  CPP_FACTURE_MIXTE: 'CPP Facture mixte (XML)',
  FACTURX_CII: 'Factur-X (PDF/A3 + CII embarqué)',
  CHORUS_PIVOT_OUTPUT: 'Flux pivot Chorus sortant (CPPFacturePivot)',
  CHORUS_LIFECYCLE_STATUS_OUTPUT: 'Flux statut/cycle de vie (CPPStatut)',
  PDF_GENERIC: 'PDF sans XML embarqué',
  UNKNOWN_XML: 'XML non reconnu',
  INVALID_XML: 'XML invalide',
};

export function detectedTypeLabel(type: string): string {
  return DETECTED_LABELS[type] ?? type;
}

const STATIC_RECOMMENDED: Record<string, string[]> = {
  UBL_INVOICE: [
    'IN_DP_E1_UBL_INVOICE',
    'IN_DP_E2_UBL_INVOICE_MIN',
    'IN_DP_E3_UBL_INVOICE',
    'IN_DP_E4_UBL_INVOICE_FACTURES_TRAVAUX',
    'IN_DP_E5_UBL_INVOICE_MIN_FACTURES_TRAVAUX',
  ],
  CII_INVOICE: ['IN_DP_E1_CII_16B', 'IN_DP_E2_CII_MIN_16B', 'IN_DP_E2_CII_MIN'],
  FACTURX_CII: ['IN_DP_E2_CII_FACTURX', 'IN_DP_E5_CII_FACTURX_FACTURES_TRAVAUX', 'IN_DP_E2_CII_FACTURX_FE'],
  CPP_FACTURE_MIXTE: ['IN_DP_E2_CPP_FACTURE_MIN'],
};

const MSG = {
  pivot: "Ce fichier semble être un flux pivot Chorus sortant (CPPFacturePivot). Il ne doit pas être redéposé via /v1/deposer/flux.",
  statut: "Ce fichier semble être un flux retour de cycle de vie (CPPStatut). Ce n'est pas une facture à déposer.",
  pdfGeneric: "Le PDF ne contient pas de XML Factur-X embarqué (factur-x.xml). Il n'est pas déposable en flux ; utilisez le dépôt unitaire PDF si nécessaire.",
  invalid: "Le fichier n'est pas un XML valide et ne peut pas être analysé. Chorus le rejettera.",
  ublMismatch: "Le fichier est un XML UBL Invoice, mais la syntaxe sélectionnée ne semble pas être une syntaxe UBL.",
  ciiMismatch: "Le fichier est un XML CII, mais la syntaxe sélectionnée ne semble pas être une syntaxe CII.",
  ciiAsFacturx: "Le fichier est un XML CII brut (et non un PDF Factur-X) : une syntaxe Factur-X attend un PDF/A3 avec XML embarqué.",
  facturxMismatch: "Le fichier est un PDF Factur-X avec un XML embarqué. Utilisez une syntaxe Factur-X comme IN_DP_E2_CII_FACTURX si elle est disponible.",
  cppMismatch: "Le fichier est un XML CPPFactureMixte : sélectionnez une syntaxe CPP (ex. IN_DP_E2_CPP_FACTURE_MIN) renvoyée par Chorus.",
  unknown: "Racine XML non reconnue : impossible de garantir la compatibilité avec la syntaxe sélectionnée. Vérifiez le fichier avant de forcer le dépôt.",
};

function recommendedFor(detectedType: string, allowed?: string[]): string[] {
  const matchers: Record<string, (s: string) => boolean> = {
    UBL_INVOICE: (s) => s.includes('UBL'),
    CII_INVOICE: (s) => s.includes('CII') && !s.includes('FACTURX'),
    FACTURX_CII: (s) => s.includes('FACTURX'),
    CPP_FACTURE_MIXTE: (s) => s.includes('CPP'),
  };
  const matcher = matchers[detectedType];
  if (allowed && allowed.length > 0 && matcher) {
    const live = allowed.filter((s) => matcher(s.toUpperCase()));
    if (live.length > 0) return live;
  }
  return STATIC_RECOMMENDED[detectedType] ?? [];
}

/** Miroir client de evaluate_flux_compatibility (backend). */
export function evaluateFluxCompatibility(
  detectedType: string,
  selectedFormatFlux: string | null,
  selectedSyntaxeFlux: string | null,
  allowedSyntaxesForFormat?: string[],
): FluxCompatibility {
  const syntaxe = (selectedSyntaxeFlux ?? '').trim();
  const s = syntaxe.toUpperCase();
  const recommendedSyntaxes = recommendedFor(detectedType, allowedSyntaxesForFormat);

  const make = (compatible: boolean | null, severity: FluxSeverity, warning: string | null): FluxCompatibility => ({
    formatFlux: selectedFormatFlux,
    syntaxeFlux: selectedSyntaxeFlux,
    compatible,
    severity,
    recommendedSyntaxes,
    warning,
  });

  if (detectedType === 'CHORUS_PIVOT_OUTPUT') return make(false, 'BLOCKING', MSG.pivot);
  if (detectedType === 'CHORUS_LIFECYCLE_STATUS_OUTPUT') return make(false, 'BLOCKING', MSG.statut);
  if (detectedType === 'PDF_GENERIC') return make(false, 'BLOCKING', MSG.pdfGeneric);
  if (detectedType === 'INVALID_XML') return make(false, 'BLOCKING', MSG.invalid);
  if (detectedType === 'UNKNOWN_XML') return make(false, 'WARNING', MSG.unknown);

  if (!syntaxe) return make(null, 'OK', null);

  if (detectedType === 'UBL_INVOICE') {
    return s.includes('UBL') ? make(true, 'OK', null) : make(false, 'BLOCKING', MSG.ublMismatch);
  }
  if (detectedType === 'CII_INVOICE') {
    if (s.includes('FACTURX')) return make(false, 'BLOCKING', MSG.ciiAsFacturx);
    return s.includes('CII') ? make(true, 'OK', null) : make(false, 'BLOCKING', MSG.ciiMismatch);
  }
  if (detectedType === 'FACTURX_CII') {
    return s.includes('FACTURX') ? make(true, 'OK', null) : make(false, 'BLOCKING', MSG.facturxMismatch);
  }
  if (detectedType === 'CPP_FACTURE_MIXTE') {
    return s.includes('CPP') ? make(true, 'OK', null) : make(false, 'BLOCKING', MSG.cppMismatch);
  }
  return make(null, 'WARNING', MSG.unknown);
}

// ───────────────────────────────────────────────────────────────────────────
// Recommandations « grand public » pour aider à choisir formatFlux/syntaxeFlux.
// Les valeurs sélectionnables restent celles renvoyées par Chorus : ce helper
// ne fait que proposer des cibles connues, en privilégiant celles réellement
// disponibles pour le compte/environnement.
// ───────────────────────────────────────────────────────────────────────────

export type FluxRecommendationStatus = 'recommended' | 'warning' | 'blocked';

export interface FluxRecommendation {
  status: FluxRecommendationStatus;
  title: string;
  recommendedFormatFlux: string | null;
  recommendedSyntaxeFlux: string | null;
  shortExplanation: string;
  why: string;
  actionLabel: string;
}

export interface BuildFluxRecommendationInput {
  detectedFileType: string | null;
  selectedFormatFlux: string | null;
  selectedSyntaxeFlux: string | null;
  availableFormats?: string[];
  availableSyntaxes?: string[];
  businessValidation?: FluxBusinessValidation | null;
}

const DEPOSITABLE_TYPES = new Set(['FACTURX_CII', 'UBL_INVOICE', 'CII_INVOICE', 'CPP_FACTURE_MIXTE']);

/** Message d'action ciblé selon les contrôles métier en échec. */
function businessActionLabel(checks: Record<string, boolean>): string {
  if (checks.supplier_identifier_known === false) {
    return "Utilisez l'identifiant SIRET de la structure fournisseur rattachée au compte technique.";
  }
  if (checks.customer_identifier_present !== false && checks.customer_identifier_known === false) {
    return "Vérifiez que le SIRET destinataire existe dans l'annuaire Chorus.";
  }
  if (checks.supplier_address_present === false || checks.customer_address_present === false) {
    return "Ajoutez au moins une ligne d'adresse pour le fournisseur et le débiteur.";
  }
  return 'Corrigez les identifiants et adresses avant dépôt.';
}

// Cibles connues, par ordre de préférence. La 1re disponible est retenue ;
// à défaut la 1re de la liste sert d'indication (le helper ne verrouille rien).
const RECO_FORMATS: Record<string, string[]> = {
  FACTURX_CII: ['IN_DP_E2_FACTURX_FE', 'IN_DP_E2_FACTURX', 'IN_DP_E2_MIXTE'],
  UBL_INVOICE: ['IN_DP_E1_STRUCT'],
  CII_INVOICE: ['IN_DP_E1_STRUCT'],
  CPP_FACTURE_MIXTE: ['IN_DP_E2_MIXTE'],
};

const RECO_SYNTAXES: Record<string, string[]> = {
  FACTURX_CII: ['IN_DP_E2_CII_FACTURX_FE', 'IN_DP_E2_CII_FACTURX'],
  UBL_INVOICE: ['IN_DP_E1_UBL_INVOICE'],
  CII_INVOICE: ['IN_DP_E1_CII_16B'],
  CPP_FACTURE_MIXTE: ['IN_DP_E2_CPP_FACTURE_MIN'],
};

const WHY = {
  match: 'Le type détecté correspond à la syntaxe choisie.',
  mismatch: 'Le fichier détecté ne correspond pas à la syntaxe choisie. Chorus risque de rejeter le flux.',
  blocked: "Ce n'est pas une facture entrante à déposer.",
};

/** Retient la 1re cible réellement disponible, sinon la 1re cible (indication). */
function preferAvailable(prefs: string[], available?: string[]): string | null {
  if (prefs.length === 0) return null;
  if (available && available.length > 0) {
    const found = prefs.find((value) => available.includes(value));
    if (found) return found;
  }
  return prefs[0];
}

/**
 * Construit la recommandation affichée dans le panneau « Recommandations ».
 * Le `title`, l'explication et les cibles découlent du type détecté ; le
 * `status`/`why` tiennent compte de la syntaxe actuellement sélectionnée pour
 * signaler un éventuel décalage. Les valeurs proposées restent indicatives :
 * la source de vérité demeure l'API Chorus (formats/syntaxes disponibles).
 */
export function buildFluxRecommendation(input: BuildFluxRecommendationInput): FluxRecommendation | null {
  const { detectedFileType, selectedFormatFlux, selectedSyntaxeFlux, availableFormats, availableSyntaxes } = input;
  if (!detectedFileType) return null;

  const recoFormat = preferAvailable(RECO_FORMATS[detectedFileType] ?? [], availableFormats);
  const recoSyntaxe = preferAvailable(RECO_SYNTAXES[detectedFileType] ?? [], availableSyntaxes);

  const hasSelection = Boolean((selectedSyntaxeFlux ?? '').trim());
  const compatibility = evaluateFluxCompatibility(detectedFileType, selectedFormatFlux, selectedSyntaxeFlux, availableSyntaxes);
  const selectionMismatch = hasSelection && compatibility.severity === 'BLOCKING';

  // Le squelette est compatible mais les données métier bloquent : on prévient
  // que Chorus rejettera (identifiants/adresses) malgré un format correct.
  if (input.businessValidation?.severity === 'BLOCKING' && DEPOSITABLE_TYPES.has(detectedFileType)) {
    return {
      status: 'blocked',
      title: 'Format correct, données métier à corriger',
      recommendedFormatFlux: recoFormat,
      recommendedSyntaxeFlux: recoSyntaxe,
      shortExplanation: 'Le fichier est au bon format, mais Chorus risque de le rejeter à cause des identifiants ou adresses.',
      why: 'Le fournisseur, le débiteur ou leurs adresses ne sont pas correctement renseignés.',
      actionLabel: businessActionLabel(input.businessValidation.checks ?? {}),
    };
  }

  switch (detectedFileType) {
    case 'FACTURX_CII':
      return {
        status: selectionMismatch ? 'warning' : 'recommended',
        title: 'Dépôt Factur-X recommandé',
        recommendedFormatFlux: recoFormat,
        recommendedSyntaxeFlux: recoSyntaxe,
        shortExplanation: 'Ce PDF contient un XML CII embarqué.',
        why: selectionMismatch ? WHY.mismatch : 'Le fichier détecté correspond à une syntaxe Factur-X.',
        actionLabel: selectionMismatch ? 'Choisissez une syntaxe Factur-X.' : 'Vous pouvez déposer ce flux.',
      };
    case 'UBL_INVOICE':
      return {
        status: selectionMismatch ? 'warning' : 'recommended',
        title: 'Dépôt UBL recommandé',
        recommendedFormatFlux: recoFormat,
        recommendedSyntaxeFlux: recoSyntaxe,
        shortExplanation: 'Ce fichier est une facture XML UBL structurée.',
        why: selectionMismatch ? WHY.mismatch : hasSelection ? WHY.match : 'Utilisez une syntaxe UBL.',
        actionLabel: selectionMismatch ? 'Choisissez une syntaxe UBL.' : 'Vous pouvez déposer ce flux.',
      };
    case 'CII_INVOICE':
      return {
        status: selectionMismatch ? 'warning' : 'recommended',
        title: 'Dépôt CII recommandé',
        recommendedFormatFlux: recoFormat,
        recommendedSyntaxeFlux: recoSyntaxe,
        shortExplanation: 'Ce fichier est une facture XML CII.',
        why: selectionMismatch ? WHY.mismatch : hasSelection ? WHY.match : 'Utilisez une syntaxe CII, pas UBL.',
        actionLabel: selectionMismatch ? 'Choisissez une syntaxe CII.' : 'Vous pouvez déposer ce flux.',
      };
    case 'CPP_FACTURE_MIXTE': {
      const cppAvailable = (availableSyntaxes ?? []).some((value) => value.toUpperCase().includes('CPP'));
      return {
        status: selectionMismatch ? 'warning' : cppAvailable ? 'recommended' : 'warning',
        title: 'Facture mixte CPP',
        recommendedFormatFlux: recoFormat,
        recommendedSyntaxeFlux: recoSyntaxe,
        shortExplanation: 'Ce fichier ressemble à une facture mixte CPP.',
        why: selectionMismatch
          ? WHY.mismatch
          : cppAvailable
            ? 'Déposez-la avec une syntaxe CPP facture mixte.'
            : "La syntaxe CPP doit être renvoyée par Chorus pour ce compte.",
        actionLabel: cppAvailable ? 'Sélectionnez une syntaxe CPP.' : 'Vérifiez la disponibilité de la syntaxe CPP.',
      };
    }
    case 'CHORUS_PIVOT_OUTPUT':
      return {
        status: 'blocked',
        title: 'Dépôt non autorisé',
        recommendedFormatFlux: null,
        recommendedSyntaxeFlux: null,
        shortExplanation: 'Ce fichier est un flux pivot sortant Chorus.',
        why: WHY.blocked,
        actionLabel: 'Choisissez un autre fichier.',
      };
    case 'CHORUS_LIFECYCLE_STATUS_OUTPUT':
      return {
        status: 'blocked',
        title: 'Dépôt non autorisé',
        recommendedFormatFlux: null,
        recommendedSyntaxeFlux: null,
        shortExplanation: 'Ce fichier est un retour de cycle de vie Chorus.',
        why: WHY.blocked,
        actionLabel: 'Choisissez un autre fichier.',
      };
    case 'PDF_GENERIC':
      return {
        status: 'warning',
        title: 'Conversion PDF requise',
        recommendedFormatFlux: null,
        recommendedSyntaxeFlux: null,
        shortExplanation: "Ce PDF ne contient pas de XML Factur-X embarqué.",
        why: "Il doit d'abord être converti en XML structuré après extraction et validation.",
        actionLabel: 'Utilisez « PDF facture → flux ».',
      };
    case 'INVALID_XML':
      return {
        status: 'blocked',
        title: 'Fichier illisible',
        recommendedFormatFlux: null,
        recommendedSyntaxeFlux: null,
        shortExplanation: "Le fichier n'est pas un XML valide.",
        why: 'Chorus rejettera un fichier non analysable.',
        actionLabel: 'Choisissez un autre fichier.',
      };
    default:
      return {
        status: 'warning',
        title: 'Type non reconnu',
        recommendedFormatFlux: recoFormat,
        recommendedSyntaxeFlux: recoSyntaxe,
        shortExplanation: "La racine XML de ce fichier n'est pas reconnue.",
        why: 'Impossible de garantir la compatibilité avec une syntaxe de dépôt.',
        actionLabel: 'Vérifiez le fichier avant de forcer le dépôt.',
      };
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/** Normalise l'objet `detected` (snake_case backend) vers FluxDetected (camelCase). */
export function mapDetected(raw: unknown): FluxDetected | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    detectedFileType: typeof r.detected_file_type === 'string' ? r.detected_file_type : 'UNKNOWN_XML',
    rootElement: asString(r.root_element),
    namespace: asString(r.namespace),
    isPdf: r.is_pdf === true,
    isXml: r.is_xml === true,
    isFacturx: r.is_facturx === true,
    embeddedXmlFilename: asString(r.embedded_xml_filename),
    embeddedXmlRoot: asString(r.embedded_xml_root),
    embeddedXmlNamespace: asString(r.embedded_xml_namespace),
    isDepositCompatible: r.is_deposit_compatible === true,
    warnings: Array.isArray(r.warnings) ? r.warnings.filter((w): w is string => typeof w === 'string') : [],
  };
}

export function mapCompatibility(raw: unknown): FluxCompatibility | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const severity = r.severity === 'OK' || r.severity === 'WARNING' || r.severity === 'BLOCKING' ? r.severity : 'WARNING';
  return {
    formatFlux: asString(r.formatFlux),
    syntaxeFlux: asString(r.syntaxeFlux),
    compatible: typeof r.compatible === 'boolean' ? r.compatible : null,
    severity,
    recommendedSyntaxes: Array.isArray(r.recommendedSyntaxes)
      ? r.recommendedSyntaxes.filter((x): x is string => typeof x === 'string')
      : [],
    warning: asString(r.warning),
  };
}

export function mapExplanation(raw: unknown): FluxErrorExplanation | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const message = asString(r.message);
  if (!message) return null;
  const details: FluxErrorExplanationDetail[] = Array.isArray(r.details)
    ? r.details
        .filter((d): d is Record<string, unknown> => Boolean(d) && typeof d === 'object')
        .map((d) => ({ message: asString(d.message) ?? '', source: asString(d.source), fix: asString(d.fix) }))
    : [];
  return {
    category: typeof r.category === 'string' ? r.category : 'UNKNOWN',
    message,
    source: asString(r.source),
    fix: asString(r.fix),
    details,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Métadonnées informatives extraites par le backend (vue d'inspection).
// ───────────────────────────────────────────────────────────────────────────

export interface FluxAttachment {
  name: string;
  sizeBytes: number | null;
}

export interface FluxDocumentMetadata {
  filename: string | null;
  extension: string | null;
  sizeBytes: number | null;
  kind: string;
  encoding: string | null;
  pdfVersion: string | null;
  pageCount: number | null;
  pdfA: string | null;
  title: string | null;
  author: string | null;
  producer: string | null;
  creator: string | null;
  subject: string | null;
  created: string | null;
  modified: string | null;
  attachments: FluxAttachment[];
}

export interface FluxXmlMetadata {
  source: string;
  filename: string | null;
  rootElement: string | null;
  namespace: string | null;
  encoding: string | null;
}

export interface FluxInvoiceMetadata {
  invoiceNumber: string | null;
  issueDate: string | null;
  dueDate: string | null;
  currency: string | null;
  sellerName: string | null;
  sellerId: string | null;
  buyerName: string | null;
  buyerId: string | null;
  totalHt: number | null;
  totalTva: number | null;
  totalTtc: number | null;
}

export interface FluxMetadata {
  document: FluxDocumentMetadata;
  xml: FluxXmlMetadata | null;
  invoice: FluxInvoiceMetadata | null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function asBusinessIssues(value: unknown): FluxBusinessIssue[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      code: typeof item.code === 'string' ? item.code : '',
      field: typeof item.field === 'string' ? item.field : '',
      xmlPath: asString(item.xml_path) ?? (typeof item.field === 'string' ? item.field : null),
      currentValue: asString(item.current_value) ?? asString(item.value),
      suggestedFix: asString(item.suggested_fix),
      line: asNumber(item.line),
      message: typeof item.message === 'string' ? item.message : '',
      value: asString(item.value),
    }));
}

/** Normalise l'objet `business_validation` (snake_case backend) vers FluxBusinessValidation. */
export function mapBusinessValidation(raw: unknown): FluxBusinessValidation | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const severity = r.severity === 'OK' || r.severity === 'WARNING' || r.severity === 'BLOCKING' ? r.severity : 'WARNING';
  const checks: Record<string, boolean> = {};
  if (r.checks && typeof r.checks === 'object') {
    for (const [key, val] of Object.entries(r.checks as Record<string, unknown>)) {
      if (typeof val === 'boolean') checks[key] = val;
    }
  }
  const ex = (r.extracted && typeof r.extracted === 'object' ? r.extracted : {}) as Record<string, unknown>;
  return {
    valid: r.valid === true,
    severity,
    errors: asBusinessIssues(r.errors),
    warnings: asBusinessIssues(r.warnings),
    checks,
    extracted: {
      invoiceNumber: asString(ex.invoice_number),
      supplierIdentifier: asString(ex.supplier_identifier),
      supplierBusinessIdentifier: asString(ex.supplier_business_identifier) ?? asString(ex.supplier_identifier),
      supplierIdentifierType: asString(ex.supplier_identifier_type),
      supplierSiretsConfigured: Array.isArray(ex.supplier_sirets_configured)
        ? ex.supplier_sirets_configured.filter((x): x is string => typeof x === 'string')
        : [],
      supplierInternalIdsConfigured: Array.isArray(ex.supplier_internal_ids_configured)
        ? ex.supplier_internal_ids_configured.filter((x): x is string => typeof x === 'string')
        : [],
      supplierName: asString(ex.supplier_name),
      supplierAddress: asString(ex.supplier_address),
      customerIdentifier: asString(ex.customer_identifier),
      customerName: asString(ex.customer_name),
      customerAddress: asString(ex.customer_address),
      currency: asString(ex.currency),
      totalHt: asNumber(ex.total_ht),
      totalTva: asNumber(ex.total_tva),
      totalTtc: asNumber(ex.total_ttc),
      taxPercentages: Array.isArray(ex.tax_percentages)
        ? ex.tax_percentages.map((p) => String(p)).filter((p) => p.trim().length > 0)
        : [],
    },
  };
}

/** Normalise l'objet `metadata` (snake_case backend) vers FluxMetadata. */
export function mapMetadata(raw: unknown): FluxMetadata | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const doc = (r.document && typeof r.document === 'object' ? r.document : {}) as Record<string, unknown>;

  const attachments = Array.isArray(doc.attachments)
    ? doc.attachments
        .filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === 'object')
        .map((a) => ({ name: asString(a.name) ?? '—', sizeBytes: asNumber(a.size_bytes) }))
    : [];

  const document: FluxDocumentMetadata = {
    filename: asString(doc.filename),
    extension: asString(doc.extension),
    sizeBytes: asNumber(doc.size_bytes),
    kind: typeof doc.kind === 'string' ? doc.kind : 'unknown',
    encoding: asString(doc.encoding),
    pdfVersion: asString(doc.pdf_version),
    pageCount: asNumber(doc.page_count),
    pdfA: asString(doc.pdf_a),
    title: asString(doc.title),
    author: asString(doc.author),
    producer: asString(doc.producer),
    creator: asString(doc.creator),
    subject: asString(doc.subject),
    created: asString(doc.created),
    modified: asString(doc.modified),
    attachments,
  };

  let xml: FluxXmlMetadata | null = null;
  if (r.xml && typeof r.xml === 'object') {
    const x = r.xml as Record<string, unknown>;
    xml = {
      source: typeof x.source === 'string' ? x.source : 'file',
      filename: asString(x.filename),
      rootElement: asString(x.root_element),
      namespace: asString(x.namespace),
      encoding: asString(x.encoding),
    };
  }

  let invoice: FluxInvoiceMetadata | null = null;
  if (r.invoice && typeof r.invoice === 'object') {
    const i = r.invoice as Record<string, unknown>;
    invoice = {
      invoiceNumber: asString(i.invoice_number),
      issueDate: asString(i.issue_date),
      dueDate: asString(i.due_date),
      currency: asString(i.currency),
      sellerName: asString(i.seller_name),
      sellerId: asString(i.seller_id),
      buyerName: asString(i.buyer_name),
      buyerId: asString(i.buyer_id),
      totalHt: asNumber(i.total_ht),
      totalTva: asNumber(i.total_tva),
      totalTtc: asNumber(i.total_ttc),
    };
  }

  return { document, xml, invoice };
}

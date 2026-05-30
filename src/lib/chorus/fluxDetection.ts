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

export interface FluxErrorExplanation {
  category: string;
  message: string;
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
  return { category: typeof r.category === 'string' ? r.category : 'UNKNOWN', message };
}

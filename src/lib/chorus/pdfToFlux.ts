import { authHeaders } from '@/lib/auth/session';
import { resolveChorusBridgeUrl } from '@/lib/chorus/backendAutomation';
import {
  mapCompatibility,
  mapDetected,
  mapExplanation,
  type FluxCompatibility,
  type FluxDetected,
  type FluxErrorExplanation,
} from '@/lib/chorus/fluxDetection';
import type { ChorusConfig } from '@/types/chorus';

export const PDF_TO_FLUX_DETECT_PATH = '/api/chorus/pdf-to-flux/detect';
export const PDF_TO_FLUX_EXTRACT_PATH = '/api/chorus/pdf-to-flux/extract';
export const PDF_TO_FLUX_VALIDATE_DRAFT_PATH = '/api/chorus/pdf-to-flux/validate-draft';
export const PDF_TO_FLUX_GENERATE_XML_PATH = '/api/chorus/pdf-to-flux/generate-xml';
export const PDF_TO_FLUX_VALIDATE_XML_PATH = '/api/chorus/pdf-to-flux/validate-xml';
export const PDF_TO_FLUX_DEPOSER_PATH = '/api/chorus/pdf-to-flux/deposer-generated';

// Le brouillon garde les clés snake_case du backend : aucun mapping n'est requis
// pour relire/éditer/renvoyer les données.
export interface DraftSupplier { name: string | null; siret: string | null; vat_number: string | null; address: string | null }
export interface DraftCustomer { name: string | null; siret: string | null; service_code: string | null; engagement_number: string | null; address: string | null }
export interface DraftInvoice {
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  currency: string | null;
  total_ht: number | null;
  total_tva: number | null;
  total_ttc: number | null;
  payment_terms: string | null;
}
export interface DraftVatEntry { vat_rate: number | null; base_amount: number | null; vat_amount: number | null }
export interface DraftLine { description: string | null; quantity: number | null; unit_price: number | null; vat_rate: number | null; line_total_ht: number | null }
export interface DraftChorus {
  cadre_facturation: string | null;
  service_code: string | null;
  engagement_number: string | null;
  format_flux_target: string | null;
  syntaxe_flux_target: string | null;
}
export interface InvoiceDraft {
  supplier: DraftSupplier;
  customer: DraftCustomer;
  invoice: DraftInvoice;
  vat_breakdown: DraftVatEntry[];
  lines: DraftLine[];
  chorus: DraftChorus;
}

export interface PdfDetectResult {
  success: boolean;
  filename: string;
  pdfType: string;
  isFacturx: boolean;
  directDepositPossible: boolean;
  conversionRequired: boolean;
  embeddedXmlFilename: string | null;
  embeddedXmlRoot: string | null;
  message: string;
  recommended: { formatFlux: string[]; syntaxeFlux: string[] } | null;
}

export interface PdfExtractResult {
  success: boolean;
  filename: string;
  draft: InvoiceDraft;
  confidence: Record<string, number>;
  warnings: string[];
}

export interface DraftValidationIssue { field: string; message: string }
export interface DraftValidationResult {
  success: boolean;
  valid: boolean;
  errors: DraftValidationIssue[];
  warnings: DraftValidationIssue[];
}

export interface GeneratedXml {
  filename: string;
  formatFlux: string;
  syntaxeFlux: string;
  detectedFileType: string;
  xmlPreview: string;
}
export interface GenerateXmlResult {
  success: boolean;
  generated: GeneratedXml | null;
  warnings: string[];
  error?: string;
  validation?: DraftValidationResult;
}

export interface ValidateXmlResult {
  success: boolean;
  valid: boolean;
  detected: { detectedFileType: string; rootElement: string | null; namespace: string | null } | null;
  compatibility: { severity: string; compatible: boolean | null } | null;
  warnings: string[];
}

export interface DeposerGeneratedResult {
  success: boolean;
  httpStatus: number | null;
  statusLocal: 'ACCEPTED' | 'REJECTED' | 'ERROR' | 'BLOCKED_LOCAL_VALIDATION';
  codeRetour: number | null;
  libelle: string | null;
  dateDepot: string | null;
  numeroFluxDepot: string | null;
  formatFlux: string | null;
  syntaxeFlux: string | null;
  detected: FluxDetected | null;
  compatibility: FluxCompatibility | null;
  explanation: FluxErrorExplanation | null;
  persisted: boolean;
  raw: unknown;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}
function asNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}
function asIssues(value: unknown): DraftValidationIssue[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => ({ field: asString(item.field) ?? '', message: asString(item.message) ?? '' }));
}
function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}
function asStatusLocal(value: unknown): DeposerGeneratedResult['statusLocal'] {
  return value === 'ACCEPTED' || value === 'REJECTED' || value === 'BLOCKED_LOCAL_VALIDATION' ? value : 'ERROR';
}

async function parseBody(response: Response): Promise<unknown> {
  const raw = await response.text();
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return raw;
  }
}

function defaultFetch(): typeof fetch {
  return globalThis.fetch.bind(globalThis);
}

async function postJson(config: ChorusConfig, path: string, payload: unknown, fetchImpl: typeof fetch): Promise<unknown> {
  const url = resolveChorusBridgeUrl(config, path);
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: authHeaders({ Accept: 'application/json', 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  const body = await parseBody(response);
  return { response, body };
}

/** Détecte si un PDF est Factur-X (dépôt direct) ou un PDF normal (conversion). */
export async function detectPdfToFlux(
  config: ChorusConfig,
  file: File,
  fetchImpl: typeof fetch = defaultFetch(),
): Promise<PdfDetectResult> {
  const url = resolveChorusBridgeUrl(config, PDF_TO_FLUX_DETECT_PATH);
  const formData = new FormData();
  formData.append('file', file, file.name);
  const response = await fetchImpl(url, { method: 'POST', headers: authHeaders(), body: formData });
  const body = await parseBody(response);
  const record = isRecord(body) ? body : {};
  if (!response.ok || record.success !== true) {
    throw new Error(asString(record.error) ?? `Détection du PDF impossible (${response.status}).`);
  }
  const recommended = isRecord(record.recommended)
    ? { formatFlux: asStringList(record.recommended.formatFlux), syntaxeFlux: asStringList(record.recommended.syntaxeFlux) }
    : null;
  return {
    success: true,
    filename: asString(record.filename) ?? file.name,
    pdfType: asString(record.pdf_type) ?? 'PDF_GENERIC',
    isFacturx: record.is_facturx === true,
    directDepositPossible: record.direct_deposit_possible === true,
    conversionRequired: record.conversion_required === true,
    embeddedXmlFilename: asString(record.embedded_xml_filename),
    embeddedXmlRoot: asString(record.embedded_xml_root),
    message: asString(record.message) ?? '',
    recommended,
  };
}

/** Extrait un brouillon de facture depuis un PDF (aucun dépôt, aucune génération). */
export async function extractPdfToFlux(
  config: ChorusConfig,
  file: File,
  fetchImpl: typeof fetch = defaultFetch(),
): Promise<PdfExtractResult> {
  const url = resolveChorusBridgeUrl(config, PDF_TO_FLUX_EXTRACT_PATH);
  const formData = new FormData();
  formData.append('file', file, file.name);
  const response = await fetchImpl(url, { method: 'POST', headers: authHeaders(), body: formData });
  const body = await parseBody(response);
  const record = isRecord(body) ? body : {};
  if (!response.ok || record.success !== true) {
    throw new Error(asString(record.error) ?? `Extraction impossible (${response.status}).`);
  }
  return {
    success: true,
    filename: asString(record.filename) ?? file.name,
    draft: record.draft as InvoiceDraft,
    confidence: isRecord(record.confidence) ? (record.confidence as Record<string, number>) : {},
    warnings: asStringList(record.warnings),
  };
}

/** Valide le brouillon (champs requis + cohérence numérique). */
export async function validateDraft(
  config: ChorusConfig,
  draft: InvoiceDraft,
  fetchImpl: typeof fetch = defaultFetch(),
): Promise<DraftValidationResult> {
  const { response, body } = (await postJson(config, PDF_TO_FLUX_VALIDATE_DRAFT_PATH, { draft }, fetchImpl)) as {
    response: Response;
    body: unknown;
  };
  const record = isRecord(body) ? body : {};
  if (!response.ok) throw new Error(asString(record.error) ?? `Validation impossible (${response.status}).`);
  return {
    success: record.success === true,
    valid: record.valid === true,
    errors: asIssues(record.errors),
    warnings: asIssues(record.warnings),
  };
}

/** Génère le XML UBL à partir du brouillon validé (pas de dépôt). */
export async function generateXml(
  config: ChorusConfig,
  draft: InvoiceDraft,
  target: { formatFlux: string; syntaxeFlux: string },
  fetchImpl: typeof fetch = defaultFetch(),
): Promise<GenerateXmlResult> {
  const { response, body } = (await postJson(config, PDF_TO_FLUX_GENERATE_XML_PATH, { draft, target }, fetchImpl)) as {
    response: Response;
    body: unknown;
  };
  const record = isRecord(body) ? body : {};
  const generated = isRecord(record.generated)
    ? {
        filename: asString(record.generated.filename) ?? 'generated_invoice_ubl.xml',
        formatFlux: asString(record.generated.formatFlux) ?? target.formatFlux,
        syntaxeFlux: asString(record.generated.syntaxeFlux) ?? target.syntaxeFlux,
        detectedFileType: asString(record.generated.detected_file_type) ?? '',
        xmlPreview: asString(record.generated.xml_preview) ?? '',
      }
    : null;
  return {
    success: record.success === true,
    generated,
    warnings: asStringList(record.warnings),
    error: asString(record.error) ?? undefined,
    validation: isRecord(record.validation)
      ? { success: true, valid: record.validation.valid === true, errors: asIssues(record.validation.errors), warnings: asIssues(record.validation.warnings) }
      : undefined,
  };
}

/** Valide le XML généré (détecteur local + compatibilité syntaxe). */
export async function validateXml(
  config: ChorusConfig,
  xml: string,
  syntaxeFlux: string,
  fetchImpl: typeof fetch = defaultFetch(),
): Promise<ValidateXmlResult> {
  const { response, body } = (await postJson(config, PDF_TO_FLUX_VALIDATE_XML_PATH, { xml, syntaxeFlux }, fetchImpl)) as {
    response: Response;
    body: unknown;
  };
  const record = isRecord(body) ? body : {};
  if (!response.ok) throw new Error(asString(record.error) ?? `Validation XML impossible (${response.status}).`);
  const detected = isRecord(record.detected)
    ? {
        detectedFileType: asString(record.detected.detected_file_type) ?? '',
        rootElement: asString(record.detected.root_element),
        namespace: asString(record.detected.namespace),
      }
    : null;
  const compatibility = isRecord(record.compatibility)
    ? { severity: asString(record.compatibility.severity) ?? 'WARNING', compatible: typeof record.compatibility.compatible === 'boolean' ? record.compatibility.compatible : null }
    : null;
  return {
    success: record.success === true,
    valid: record.valid === true,
    detected,
    compatibility,
    warnings: asStringList(record.warnings),
  };
}

/** Dépose le XML généré via la logique /v1/deposer/flux existante. */
export async function deposerGenerated(
  config: ChorusConfig,
  input: { xml: string; filename?: string; formatFlux: string; syntaxeFlux: string; avecSignature?: boolean; idUtilisateurCourant?: number },
  fetchImpl: typeof fetch = defaultFetch(),
): Promise<DeposerGeneratedResult> {
  const payload = {
    xml: input.xml,
    filename: input.filename ?? 'generated_invoice_ubl.xml',
    formatFlux: input.formatFlux,
    syntaxeFlux: input.syntaxeFlux,
    avecSignature: Boolean(input.avecSignature),
    idUtilisateurCourant: input.idUtilisateurCourant ?? 0,
    environment: config.environment,
  };
  const { body } = (await postJson(config, PDF_TO_FLUX_DEPOSER_PATH, payload, fetchImpl)) as { response: Response; body: unknown };
  const record = isRecord(body) ? body : {};
  return {
    success: record.success === true,
    httpStatus: asNumberOrNull(record.http_status),
    statusLocal: asStatusLocal(record.status_local),
    codeRetour: asNumberOrNull(record.codeRetour),
    libelle: asString(record.libelle),
    dateDepot: asString(record.dateDepot),
    numeroFluxDepot: asString(record.numeroFluxDepot),
    formatFlux: asString(record.formatFlux),
    syntaxeFlux: asString(record.syntaxeFlux),
    detected: mapDetected(record.detected),
    compatibility: mapCompatibility(record.compatibility),
    explanation: mapExplanation(record.explanation),
    persisted: record.persisted === true,
    raw: record.raw ?? body,
    error: asString(record.error) ?? undefined,
  };
}

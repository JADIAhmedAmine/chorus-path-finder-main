import { authHeaders } from '@/lib/auth/session';
import { resolveChorusBridgeUrl } from '@/lib/chorus/backendAutomation';
import type { ChorusConfig } from '@/types/chorus';

export const G2B_HEALTH_PATH = '/api/g2b/health';
export const G2B_FLUX_DETECT_PATH = '/api/g2b/flux/detect';
export const G2B_FLUX_BUSINESS_VALIDATE_PATH = '/api/g2b/flux/business-validate';
export const G2B_FLUX_DEPOSIT_PATH = '/api/g2b/flux/deposit';

export const G2B_CODE_INTERFACES = ['FSO3110A', 'FSO3117A', 'FSO3300A', 'FSO6000A'] as const;

export interface G2BDetected {
  fileType: string | null;
  rootElement: string | null;
  namespace: string | null;
  isDepositCompatible: boolean;
}

export interface G2BRecommendation {
  status: 'recommended' | 'warning' | 'blocked' | string;
  title: string;
  recommendedCodeInterface: string | null;
  shortExplanation: string;
  why: string;
  actionLabel: string;
}

export interface G2BBusinessIssue {
  code: string | null;
  field: string | null;
  xmlPath: string | null;
  currentValue: string | null;
  message: string | null;
  suggestedFix: string | null;
}

export interface G2BBusinessValidation {
  severity: 'OK' | 'WARNING' | 'BLOCKING' | string;
  valid: boolean;
  errors: G2BBusinessIssue[];
  warnings: G2BBusinessIssue[];
  extracted: {
    invoiceNumber: string | null;
    supplierSiret: string | null;
    supplierIdentifierType: string | null;
    customerSiret: string | null;
    currency: string | null;
    totalTtc: number | null;
    taxPercentages: string[];
  };
}

export interface G2BDetectResult {
  success: boolean;
  filename: string;
  detected: G2BDetected;
  recommendation: G2BRecommendation;
}

export interface G2BBusinessResult {
  success: boolean;
  filename: string;
  detected: G2BDetected;
  businessValidation: G2BBusinessValidation;
}

export interface G2BDepositResult {
  success: boolean;
  statusLocal: string;
  uidFlux: string | null;
  codeInterface: string | null;
  checksum: string | null;
  checksumMode: string | null;
  fileSha256: string | null;
  message: string | null;
  errorCode: string | null;
  suggestedFix: string | null;
  businessValidation?: G2BBusinessValidation;
  recommendation?: G2BRecommendation;
  explanation?: G2BErrorExplanation | null;
  error?: string;
}

export interface G2BErrorExplanation {
  friendlyMessage: string | null;
  technicalSource: string | null;
  suggestedFix: string | null;
  severity: string | null;
}

export interface G2BStatusResult {
  success: boolean;
  temporary: boolean;
  status: string | null;
  message?: string | null;
  dateMajStatut?: string | null;
  nomFlux?: string | null;
  explanation?: G2BErrorExplanation | null;
  attempts?: number;
  terminal?: boolean;
  error?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
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

/** Le backend G2B renvoie déjà du camelCase : on le typecaste après contrôle. */
function castDetect(body: unknown, fallbackName: string): G2BDetectResult {
  const r = isRecord(body) ? body : {};
  return {
    success: r.success === true,
    filename: asString(r.filename) ?? fallbackName,
    detected: (r.detected ?? {}) as G2BDetected,
    recommendation: (r.recommendation ?? {}) as G2BRecommendation,
  };
}

export async function detectG2BFlux(config: ChorusConfig, file: File, fetchImpl: typeof fetch = defaultFetch()): Promise<G2BDetectResult> {
  const url = resolveChorusBridgeUrl(config, G2B_FLUX_DETECT_PATH);
  const form = new FormData();
  form.append('file', file, file.name);
  const response = await fetchImpl(url, { method: 'POST', headers: authHeaders(), body: form });
  const body = await parseBody(response);
  const record = isRecord(body) ? body : {};
  if (!response.ok || record.success !== true) {
    throw new Error(asString(record.error) ?? `Détection G2B impossible (${response.status}).`);
  }
  return castDetect(body, file.name);
}

export async function businessValidateG2BFlux(config: ChorusConfig, file: File, codeInterface?: string, fetchImpl: typeof fetch = defaultFetch()): Promise<G2BBusinessResult> {
  const url = resolveChorusBridgeUrl(config, G2B_FLUX_BUSINESS_VALIDATE_PATH);
  const form = new FormData();
  form.append('file', file, file.name);
  if (codeInterface) form.append('code_interface', codeInterface);
  const response = await fetchImpl(url, { method: 'POST', headers: authHeaders(), body: form });
  const body = await parseBody(response);
  const record = isRecord(body) ? body : {};
  if (!response.ok || record.success !== true) {
    throw new Error(asString(record.error) ?? `Validation métier G2B impossible (${response.status}).`);
  }
  return {
    success: true,
    filename: asString(record.filename) ?? file.name,
    detected: (record.detected ?? {}) as G2BDetected,
    businessValidation: (record.businessValidation ?? {}) as G2BBusinessValidation,
  };
}

export async function depositG2BFlux(config: ChorusConfig, file: File, codeInterface: string, force = false, fetchImpl: typeof fetch = defaultFetch()): Promise<G2BDepositResult> {
  const url = resolveChorusBridgeUrl(config, G2B_FLUX_DEPOSIT_PATH);
  const form = new FormData();
  form.append('file', file, file.name);
  form.append('code_interface', codeInterface);
  form.append('force', String(Boolean(force)));
  const response = await fetchImpl(url, { method: 'POST', headers: authHeaders(), body: form });
  const body = await parseBody(response);
  const r = isRecord(body) ? body : {};
  return {
    success: r.success === true,
    statusLocal: asString(r.statusLocal) ?? 'ERROR',
    uidFlux: asString(r.uidFlux),
    codeInterface: asString(r.codeInterface) ?? codeInterface,
    checksum: asString(r.checksum),
    checksumMode: asString(r.checksumMode),
    fileSha256: asString(r.fileSha256),
    message: asString(r.message) ?? asString(r.friendly_message),
    errorCode: asString(r.error_code),
    suggestedFix: asString(r.suggested_fix),
    businessValidation: isRecord(r.businessValidation) ? (r.businessValidation as unknown as G2BBusinessValidation) : undefined,
    recommendation: isRecord(r.recommendation) ? (r.recommendation as unknown as G2BRecommendation) : undefined,
    explanation: isRecord(r.explanation) ? (r.explanation as unknown as G2BErrorExplanation) : null,
    error: asString(r.error) ?? undefined,
  };
}

export async function getG2BFluxStatus(config: ChorusConfig, uidFlux: string, poll = false, fetchImpl: typeof fetch = defaultFetch()): Promise<G2BStatusResult> {
  const path = `/api/g2b/flux/${encodeURIComponent(uidFlux)}/${poll ? 'poll' : 'status'}`;
  const url = resolveChorusBridgeUrl(config, path);
  const response = await fetchImpl(url, { method: poll ? 'POST' : 'GET', headers: authHeaders() });
  const body = await parseBody(response);
  const r = isRecord(body) ? body : {};
  return {
    success: r.success === true,
    temporary: r.temporary === true,
    status: asString(r.status),
    message: asString(r.message),
    dateMajStatut: asString(r.dateMajStatut),
    nomFlux: asString(r.nomFlux),
    explanation: isRecord(r.explanation) ? (r.explanation as unknown as G2BErrorExplanation) : null,
    attempts: typeof r.attempts === 'number' ? r.attempts : undefined,
    terminal: r.terminal === true,
    error: asString(r.error) ?? undefined,
  };
}

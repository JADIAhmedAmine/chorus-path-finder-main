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

export const CHORUS_FLUX_FORMATS_PATH = '/api/chorus/flux/formats';
export const CHORUS_FLUX_SYNTAXES_PATH = '/api/chorus/flux/syntaxes';
export const CHORUS_FLUX_DETECT_PATH = '/api/chorus/flux/detect';
export const CHORUS_FLUX_DEPOSER_PATH = '/api/chorus/flux/deposer';
export const CHORUS_FLUX_GUIDE_PATH = '/api/chorus/flux/guide';

export type ChorusFluxStatusLocal = 'ACCEPTED' | 'REJECTED' | 'ERROR' | 'BLOCKED_LOCAL_VALIDATION';

export interface ChorusFluxFormatsResult {
  success: boolean;
  codeRetour: number | null;
  libelle: string | null;
  formats: string[];
  raw: unknown;
}

export interface ChorusFluxSyntaxesResult {
  success: boolean;
  codeRetour: number | null;
  libelle: string | null;
  formatFlux: string;
  syntaxes: string[];
  raw: unknown;
}

export interface ChorusFluxDetectResult {
  success: boolean;
  filename: string;
  extension: string;
  detected: FluxDetected | null;
  compatibility: FluxCompatibility | null;
}

export interface ChorusFluxGuideEntry {
  code: string;
  label: string;
  typeFlux: string;
  formatFlux: string;
  syntaxeFlux: string;
  expectedFile?: string;
  expectedRoot?: string;
  expectedNamespace?: string;
  expectedEmbeddedXml?: string;
  expectedEmbeddedRoot?: string;
  detectedType: string;
  supportLevel: string;
  depositCompatible: boolean;
}

export interface ChorusFluxDepositInput {
  file: File;
  formatFlux: string;
  syntaxeFlux: string;
  avecSignature?: boolean;
  idUtilisateurCourant?: number;
  forceDeposit?: boolean;
}

export interface ChorusFluxDepositResult {
  success: boolean;
  httpStatus: number | null;
  statusLocal: ChorusFluxStatusLocal;
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

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function asStatusLocal(value: unknown): ChorusFluxStatusLocal {
  return value === 'ACCEPTED' || value === 'REJECTED' || value === 'BLOCKED_LOCAL_VALIDATION' ? value : 'ERROR';
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const rawBody = await response.text();
  const trimmed = rawBody.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return rawBody;
  }
}

function getDefaultFetchImpl(): typeof fetch {
  return globalThis.fetch.bind(globalThis);
}

/** Récupère la liste des formats de flux disponibles (`/v1/recuperer/formatflux`). */
export async function fetchChorusFluxFormats(
  config: ChorusConfig,
  fetchImpl: typeof fetch = getDefaultFetchImpl(),
): Promise<ChorusFluxFormatsResult> {
  const url = resolveChorusBridgeUrl(config, CHORUS_FLUX_FORMATS_PATH);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: authHeaders({ Accept: 'application/json', 'Content-Type': 'application/json' }),
      body: JSON.stringify({ environment: config.environment }),
    });
  } catch (error) {
    throw new Error(`Récupération des formats de flux impossible : ${error instanceof Error ? error.message : 'erreur réseau'}.`);
  }
  const body = await parseResponseBody(response);
  const record = isRecord(body) ? body : {};
  if (!response.ok || record.success !== true) {
    throw new Error(asString(record.error) ?? `Récupération des formats de flux impossible (${response.status}).`);
  }
  return {
    success: true,
    codeRetour: asNumberOrNull(record.codeRetour),
    libelle: asString(record.libelle),
    formats: asStringList(record.formats),
    raw: record.raw ?? body,
  };
}

/** Récupère les syntaxes XML d'un format de flux (`/v1/recuperer/syntaxeflux`). */
export async function fetchChorusFluxSyntaxes(
  config: ChorusConfig,
  formatFlux: string,
  fetchImpl: typeof fetch = getDefaultFetchImpl(),
): Promise<ChorusFluxSyntaxesResult> {
  const url = resolveChorusBridgeUrl(config, CHORUS_FLUX_SYNTAXES_PATH);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: authHeaders({ Accept: 'application/json', 'Content-Type': 'application/json' }),
      body: JSON.stringify({ environment: config.environment, formatFlux }),
    });
  } catch (error) {
    throw new Error(`Récupération des syntaxes de flux impossible : ${error instanceof Error ? error.message : 'erreur réseau'}.`);
  }
  const body = await parseResponseBody(response);
  const record = isRecord(body) ? body : {};
  if (!response.ok || record.success !== true) {
    throw new Error(asString(record.error) ?? `Récupération des syntaxes de flux impossible (${response.status}).`);
  }
  return {
    success: true,
    codeRetour: asNumberOrNull(record.codeRetour),
    libelle: asString(record.libelle),
    formatFlux: asString(record.formatFlux) ?? formatFlux,
    syntaxes: asStringList(record.syntaxes),
    raw: record.raw ?? body,
  };
}

/** Détecte le type réel d'un fichier (sans appeler Chorus deposer/flux). */
export async function detectChorusFlux(
  config: ChorusConfig,
  file: File,
  formatFlux?: string,
  syntaxeFlux?: string,
  fetchImpl: typeof fetch = getDefaultFetchImpl(),
): Promise<ChorusFluxDetectResult> {
  const url = resolveChorusBridgeUrl(config, CHORUS_FLUX_DETECT_PATH);
  const formData = new FormData();
  formData.append('file', file, file.name);
  if (formatFlux) formData.append('format_flux', formatFlux);
  if (syntaxeFlux) formData.append('syntaxe_flux', syntaxeFlux);

  let response: Response;
  try {
    response = await fetchImpl(url, { method: 'POST', headers: authHeaders(), body: formData });
  } catch (error) {
    throw new Error(`Détection du fichier impossible : ${error instanceof Error ? error.message : 'erreur réseau'}.`);
  }
  const body = await parseResponseBody(response);
  const record = isRecord(body) ? body : {};
  if (!response.ok || record.success !== true) {
    throw new Error(asString(record.error) ?? `Détection du fichier impossible (${response.status}).`);
  }
  return {
    success: true,
    filename: asString(record.filename) ?? file.name,
    extension: asString(record.extension) ?? '',
    detected: mapDetected(record.detected),
    compatibility: mapCompatibility(record.compatibility),
  };
}

/** Récupère le guide statique des formats (référentiel UI). */
export async function fetchChorusFluxGuide(
  config: ChorusConfig,
  fetchImpl: typeof fetch = getDefaultFetchImpl(),
): Promise<ChorusFluxGuideEntry[]> {
  const url = resolveChorusBridgeUrl(config, CHORUS_FLUX_GUIDE_PATH);
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: authHeaders({ Accept: 'application/json' }),
  });
  const body = await parseResponseBody(response);
  const record = isRecord(body) ? body : {};
  if (!response.ok || !Array.isArray(record.guide)) {
    throw new Error(`Récupération du guide des formats impossible (${response.status}).`);
  }
  return record.guide as ChorusFluxGuideEntry[];
}

/**
 * Dépose un fichier (XML ou PDF/A3) en flux de facture via le backend Python.
 *
 * Le fichier est transmis en multipart/form-data : le backend lit les octets,
 * les encode en base64 et appelle Chorus Pro. La signature `cpro-account` n'est
 * jamais exposée côté frontend.
 */
export async function depositChorusFlux(
  config: ChorusConfig,
  input: ChorusFluxDepositInput,
  fetchImpl: typeof fetch = getDefaultFetchImpl(),
): Promise<ChorusFluxDepositResult> {
  const url = resolveChorusBridgeUrl(config, CHORUS_FLUX_DEPOSER_PATH);
  const formData = new FormData();
  formData.append('file', input.file, input.file.name);
  formData.append('format_flux', input.formatFlux);
  formData.append('syntaxe_flux', input.syntaxeFlux);
  formData.append('avec_signature', String(Boolean(input.avecSignature)));
  formData.append('id_utilisateur_courant', String(input.idUtilisateurCourant ?? 0));
  formData.append('force', String(Boolean(input.forceDeposit)));
  formData.append('environment', config.environment);

  let response: Response;
  try {
    // Ne pas fixer Content-Type : le navigateur ajoute la boundary multipart.
    response = await fetchImpl(url, { method: 'POST', headers: authHeaders(), body: formData });
  } catch (error) {
    throw new Error(`Dépôt de flux impossible vers ${url} : ${error instanceof Error ? error.message : 'erreur réseau'}.`);
  }

  const body = await parseResponseBody(response);
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

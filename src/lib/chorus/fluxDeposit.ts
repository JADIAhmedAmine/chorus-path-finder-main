import { authHeaders } from '@/lib/auth/session';
import { resolveChorusBridgeUrl } from '@/lib/chorus/backendAutomation';
import type { ChorusConfig } from '@/types/chorus';

export const CHORUS_FLUX_DEPOSER_PATH = '/api/chorus/flux/deposer';

/** Syntaxes de flux autorisées pour le premier MVP (alignées sur le backend). */
export const CHORUS_FLUX_SYNTAXES = [
  'IN_DP_E1_UBL_INVOICE',
  'IN_DP_E1_CII',
  'IN_DP_E2_CII_FACTURX',
  'IN_DP_E2_UBL_INVOICE_MIN',
  'IN_DP_E2_CII_MIN',
] as const;

export type ChorusFluxSyntaxe = (typeof CHORUS_FLUX_SYNTAXES)[number];

export type ChorusFluxStatusLocal = 'ACCEPTED' | 'REJECTED' | 'ERROR';

export interface ChorusFluxDepositInput {
  file: File;
  syntaxeFlux: ChorusFluxSyntaxe;
  avecSignature?: boolean;
  idUtilisateurCourant?: number;
}

export interface ChorusFluxDepositResult {
  success: boolean;
  httpStatus: number | null;
  statusLocal: ChorusFluxStatusLocal;
  codeRetour: number | null;
  libelle: string | null;
  dateDepot: string | null;
  numeroFluxDepot: string | null;
  syntaxeFlux: string | null;
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
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function asStatusLocal(value: unknown): ChorusFluxStatusLocal {
  return value === 'ACCEPTED' || value === 'REJECTED' ? value : 'ERROR';
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const rawBody = await response.text();
  const trimmed = rawBody.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return rawBody;
  }
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
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<ChorusFluxDepositResult> {
  const url = resolveChorusBridgeUrl(config, CHORUS_FLUX_DEPOSER_PATH);

  const formData = new FormData();
  formData.append('file', input.file, input.file.name);
  formData.append('syntaxe_flux', input.syntaxeFlux);
  formData.append('avec_signature', String(Boolean(input.avecSignature)));
  formData.append('id_utilisateur_courant', String(input.idUtilisateurCourant ?? 0));
  formData.append('environment', config.environment);

  let response: Response;
  try {
    // Ne pas fixer Content-Type : le navigateur ajoute la boundary multipart.
    response = await fetchImpl(url, {
      method: 'POST',
      headers: authHeaders(),
      body: formData,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur réseau inconnue';
    throw new Error(`Dépôt de flux impossible vers ${url} : ${message}.`);
  }

  const body = await parseResponseBody(response);
  const record = isRecord(body) ? body : {};

  const result: ChorusFluxDepositResult = {
    success: record.success === true,
    httpStatus: asNumberOrNull(record.http_status),
    statusLocal: asStatusLocal(record.status_local),
    codeRetour: asNumberOrNull(record.codeRetour),
    libelle: asString(record.libelle),
    dateDepot: asString(record.dateDepot),
    numeroFluxDepot: asString(record.numeroFluxDepot),
    syntaxeFlux: asString(record.syntaxeFlux),
    raw: record.raw ?? body,
    error: asString(record.error) ?? undefined,
  };

  return result;
}

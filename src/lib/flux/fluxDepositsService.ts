/**
 * Service frontend des dépôts de flux (hub /flux) — P2-1 / P2-3.
 *
 * Consomme les endpoints backend :
 * - GET /api/chorus/flux/deposits        (liste paginée)
 * - GET /api/chorus/flux/deposits/stats  (statistiques de synthèse)
 * - POST /api/chorus/flux/deposits/{id}/refresh-cr
 * - POST /api/chorus/flux/deposits/refresh-cr
 *
 * Les lectures et refresh dégradent proprement (`available: false`) si la base est indisponible.
 * Aucune logique réseau dupliquée : réutilise le bridge + les en-têtes d'auth existants.
 */

import {
  authenticatedFetch,
  authHeaders,
  getAuthToken,
} from '@/lib/auth/session';
import { resolveChorusBridgeUrl } from '@/lib/chorus/backendAutomation';
import type { ChorusConfig } from '@/types/chorus';

export const FLUX_DEPOSITS_PATH = '/api/chorus/flux/deposits';
export const FLUX_DEPOSITS_STATS_PATH = '/api/chorus/flux/deposits/stats';
export const FLUX_DEPOSITS_REFRESH_CR_PATH = '/api/chorus/flux/deposits/refresh-cr';

export interface FluxDepositsFilters {
  page?: number;
  pageSize?: number;
  status?: string;
  syntaxe?: string;
  format?: string;
  from?: string;
  to?: string;
}

/** Une ligne de dépôt de flux. Champs `null` = non stockés aujourd'hui (not_available). */
export interface FluxDepositRecord {
  id: string;
  numeroFluxDepot: string | null;
  nomFichier: string | null;
  fileSize: number | null;
  formatFlux: string | null;
  syntaxeFlux: string | null;
  formatDepot: string | null;
  detectedFileType: string | null;
  avecSignature: boolean | null;
  statusLocal: string | null;
  officialFluxStateId: string | null;
  officialFluxState: string | null;
  officialFluxStateSource?: string | null;
  hasError: boolean;
  httpStatus: number | null;
  codeRetour: number | null;
  libelle: string | null;
  invoiceCount: number | null;
  errorCount: number | null;
  crAvailable: boolean | null;
  lastCrCheckedAt?: string | null;
  lastCrError?: string | null;
  dateDepot: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface FluxDepositsListResult {
  success: boolean;
  available: boolean;
  total: number;
  page: number;
  pageSize: number;
  items: FluxDepositRecord[];
  reason?: string;
}

export interface FluxDepositsStats {
  total: number;
  submitted: number;
  blockedBeforeSend: number;
  totalErrors: number;
  successRate: number | null;
  lastDepositAt: string | null;
  firstDepositAt: string | null;
  lastDateDepot: string | null;
  byStatusLocal: Record<string, number>;
  byEtatCourantFlux?: Record<string, number>;
  crCount?: number;
  /** Compteurs par état officiel (etatCourantFlux), dérivés best-effort. */
  officialFluxStates: Record<string, number>;
  officialFluxStatesLabels: Record<string, string>;
  officialStatesSource: string;
  /** true si tous les dépôts numérotés ont un etatCourantFlux persisté. */
  officialStatesComplete: boolean;
  bySyntaxeFlux: Record<string, number>;
  byFormatFlux: Record<string, number>;
  byFormatDepot: Record<string, number> | null;
}

export interface FluxDepositsStatsResult {
  success: boolean;
  available: boolean;
  stats: FluxDepositsStats;
  reason?: string;
}

export interface FluxCrRefreshBatchResult {
  success: boolean;
  available: boolean;
  attempted: number;
  refreshed: number;
  items: { id: string; crRefreshed: boolean; error?: string | null }[];
  reason?: string;
}

export interface FluxCrRefreshResult {
  success: boolean;
  available: boolean;
  crRefreshed?: boolean;
  error?: string | null;
  deposit?: FluxDepositRecord | null;
  reason?: string;
}

export const FLUX_DEPOSITS_AUTH_ERROR = 'Session expirée ou token manquant';

async function authenticatedFluxFetch(
  url: string,
  init: RequestInit,
  fetchImpl?: typeof fetch,
): Promise<Response> {
  if (!getAuthToken()) {
    throw new Error(FLUX_DEPOSITS_AUTH_ERROR);
  }

  if (fetchImpl) {
    return fetchImpl(url, {
      ...init,
      headers: authHeaders(init.headers),
    });
  }

  return authenticatedFetch(url, init);
}

function buildQuery(filters: FluxDepositsFilters, includePagination: boolean): string {
  const params = new URLSearchParams();
  if (includePagination) {
    if (filters.page) params.set('page', String(filters.page));
    if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
  }
  if (filters.status) params.set('status', filters.status);
  if (filters.syntaxe) params.set('syntaxe', filters.syntaxe);
  if (filters.format) params.set('format', filters.format);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

async function getJson(url: string, fetchImpl?: typeof fetch): Promise<unknown> {
  const response = await authenticatedFluxFetch(
    url,
    { method: 'GET', headers: { Accept: 'application/json' } },
    fetchImpl,
  );
  const raw = await response.text();
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error(`Réponse vide (${response.status}).`);
  }
  let body: unknown;
  try {
    body = JSON.parse(trimmed);
  } catch {
    throw new Error(`Réponse non-JSON (${response.status}).`);
  }
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(FLUX_DEPOSITS_AUTH_ERROR);
    }
    const message =
      typeof body === 'object' && body !== null && 'detail' in body
        ? String((body as Record<string, unknown>).detail)
        : `Lecture des dépôts de flux impossible (${response.status}).`;
    throw new Error(message);
  }
  return body;
}

async function postJson(url: string, fetchImpl?: typeof fetch): Promise<unknown> {
  const response = await authenticatedFluxFetch(
    url,
    { method: 'POST', headers: { Accept: 'application/json' } },
    fetchImpl,
  );
  const raw = await response.text();
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error(`Réponse vide (${response.status}).`);
  }
  let body: unknown;
  try {
    body = JSON.parse(trimmed);
  } catch {
    throw new Error(`Réponse non-JSON (${response.status}).`);
  }
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(FLUX_DEPOSITS_AUTH_ERROR);
    }
    const message =
      typeof body === 'object' && body !== null && 'detail' in body
        ? String((body as Record<string, unknown>).detail)
        : `Actualisation du compte rendu impossible (${response.status}).`;
    throw new Error(message);
  }
  return body;
}

/** Liste paginée des dépôts de flux. */
export async function fetchFluxDeposits(
  config: ChorusConfig,
  filters: FluxDepositsFilters = {},
  fetchImpl?: typeof fetch,
): Promise<FluxDepositsListResult> {
  const url = resolveChorusBridgeUrl(config, FLUX_DEPOSITS_PATH) + buildQuery(filters, true);
  const body = (await getJson(url, fetchImpl)) as FluxDepositsListResult;
  return body;
}

/** Statistiques de synthèse des dépôts de flux (hub /flux). */
export async function fetchFluxDepositsStats(
  config: ChorusConfig,
  filters: FluxDepositsFilters = {},
  fetchImpl?: typeof fetch,
): Promise<FluxDepositsStatsResult> {
  const url = resolveChorusBridgeUrl(config, FLUX_DEPOSITS_STATS_PATH) + buildQuery(filters, false);
  const body = (await getJson(url, fetchImpl)) as FluxDepositsStatsResult;
  return body;
}

/** Rafraîchit le compte rendu Chorus d'un dépôt précis. */
export async function refreshFluxDepositCr(
  config: ChorusConfig,
  depositId: string,
  fetchImpl?: typeof fetch,
): Promise<FluxCrRefreshResult> {
  const params = new URLSearchParams({ environment: config.environment });
  const path = `${FLUX_DEPOSITS_PATH}/${encodeURIComponent(depositId)}/refresh-cr`;
  const url = `${resolveChorusBridgeUrl(config, path)}?${params.toString()}`;
  return (await postJson(url, fetchImpl)) as FluxCrRefreshResult;
}

/** Rafraîchit un lot borné de comptes rendus Chorus. */
export async function refreshFluxDepositCrs(
  config: ChorusConfig,
  limit = 10,
  fetchImpl?: typeof fetch,
): Promise<FluxCrRefreshBatchResult> {
  const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
  const params = new URLSearchParams({
    limit: String(safeLimit),
    environment: config.environment,
  });
  const url = `${resolveChorusBridgeUrl(config, FLUX_DEPOSITS_REFRESH_CR_PATH)}?${params.toString()}`;
  return (await postJson(url, fetchImpl)) as FluxCrRefreshBatchResult;
}

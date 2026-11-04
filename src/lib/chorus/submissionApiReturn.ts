import type { ChorusApiDebugEntry } from '@/types/chorus';

export type ChorusApiReturnTone = 'success' | 'accepted' | 'warning' | 'error' | 'neutral';

export interface ChorusApiReturnSummary {
  httpStatus?: number;
  httpDescription: string;
  codeRetour?: string;
  codeRetourDescription?: string;
  libelle?: string;
  statutFacture?: string;
  numeroFacture?: string;
  identifiantFactureCPP?: string;
  identifiantStructure?: string;
  dateDepot?: string;
  empreinteCertificatDepot?: string;
  tone: ChorusApiReturnTone;
}

const HTTP_STATUS_DESCRIPTIONS: Record<number, string> = {
  200: 'Succès de la requête',
  202: 'Requête acceptée',
  400: 'Requête mal formulée',
  401: "Problème d'authentification",
  403: 'Accès refusé',
  404: 'API non trouvée',
  415: 'Format de la requête non supporté',
  500: 'Erreur interne du serveur',
};

const CODE_RETOUR_DESCRIPTIONS: Record<string, string> = {
  '0': 'Succès Chorus',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asDisplayString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

function getLastMatchingApiCall(apiCalls: ChorusApiDebugEntry[]): ChorusApiDebugEntry | undefined {
  for (let index = apiCalls.length - 1; index >= 0; index -= 1) {
    const apiCall = apiCalls[index];
    const label = apiCall.label.toLowerCase();
    const url = apiCall.url.toLowerCase();

    if (label.includes('soumission') || url.includes('/soumettre')) {
      return apiCall;
    }
  }

  return apiCalls[apiCalls.length - 1];
}

function unwrapChorusResponse(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const nestedResponse = value.response;
  if (isRecord(nestedResponse)) {
    return nestedResponse;
  }

  return value;
}

function isZeroCodeRetour(codeRetour: string): boolean {
  const parsedCodeRetour = Number(codeRetour);
  return Number.isFinite(parsedCodeRetour) && parsedCodeRetour === 0;
}

function resolveTone(httpStatus?: number, codeRetour?: string): ChorusApiReturnTone {
  if (httpStatus !== undefined && httpStatus >= 400) {
    return 'error';
  }

  if (codeRetour !== undefined && !isZeroCodeRetour(codeRetour)) {
    return 'error';
  }

  if (httpStatus === 202) {
    return 'accepted';
  }

  if (httpStatus === 200 || (codeRetour !== undefined && isZeroCodeRetour(codeRetour))) {
    return 'success';
  }

  return 'neutral';
}

export function describeChorusSubmissionApiReturn(
  response: unknown,
  apiCalls: ChorusApiDebugEntry[],
): ChorusApiReturnSummary | null {
  const submissionCall = getLastMatchingApiCall(apiCalls);
  const rawResponse = response ?? submissionCall?.responseBody;
  const responseRecord = isRecord(unwrapChorusResponse(rawResponse))
    ? unwrapChorusResponse(rawResponse) as Record<string, unknown>
    : undefined;
  const httpStatus = submissionCall?.responseStatus;
  const codeRetour = asDisplayString(responseRecord?.codeRetour);

  if (httpStatus === undefined && !responseRecord) {
    return null;
  }

  return {
    httpStatus,
    httpDescription: httpStatus !== undefined
      ? HTTP_STATUS_DESCRIPTIONS[httpStatus] ?? `Code HTTP ${httpStatus}`
      : 'Code HTTP indisponible',
    codeRetour,
    codeRetourDescription: codeRetour !== undefined
      ? CODE_RETOUR_DESCRIPTIONS[codeRetour] ?? `Code retour Chorus ${codeRetour}`
      : undefined,
    libelle: asDisplayString(responseRecord?.libelle),
    statutFacture: asDisplayString(responseRecord?.statutFacture),
    numeroFacture: asDisplayString(responseRecord?.numeroFacture),
    identifiantFactureCPP: asDisplayString(responseRecord?.identifiantFactureCPP),
    identifiantStructure: asDisplayString(responseRecord?.identifiantStructure),
    dateDepot: asDisplayString(responseRecord?.dateDepot),
    empreinteCertificatDepot: asDisplayString(responseRecord?.empreinteCertificatDepot),
    tone: resolveTone(httpStatus, codeRetour),
  };
}

export function isChorusApiReturnFailure(summary: ChorusApiReturnSummary | null): summary is ChorusApiReturnSummary {
  return summary?.tone === 'error';
}

export function formatChorusApiReturnFailureMessage(summary: ChorusApiReturnSummary): string {
  const parts = [summary.codeRetourDescription ?? summary.httpDescription];

  if (summary.libelle) {
    parts.push(summary.libelle);
  }

  if (summary.statutFacture) {
    parts.push(`statutFacture=${summary.statutFacture}`);
  }

  if (summary.numeroFacture) {
    parts.push(`numeroFacture=${summary.numeroFacture}`);
  }

  return `Soumission Chorus échouée: ${parts.join(' - ')}`;
}

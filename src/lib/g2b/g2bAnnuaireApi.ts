import { authHeaders } from '@/lib/auth/session';
import { resolveChorusBridgeUrl } from '@/lib/chorus/backendAutomation';
import type { ChorusConfig } from '@/types/chorus';

export const G2B_ANNUAIRE_VALIDATE_RECIPIENT_PATH = '/api/g2b/annuaire/validate-recipient';

export interface G2BRecipientRules {
  serviceCodeRequired?: boolean;
  engagementRequired?: boolean;
  serviceOrEngagementRequired?: boolean;
  moa?: boolean;
  moaUniquement?: boolean;
}

export interface G2BRecipientAddress {
  line1: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
}

export interface G2BRecipientValidation {
  success: boolean;
  recipient: {
    siret: string | null;
    denomination: string | null;
    active: boolean | null;
    address: G2BRecipientAddress | null;
    rules: G2BRecipientRules;
  };
  validation: {
    severity: 'OK' | 'WARNING' | 'BLOCKING' | string;
    errors: { field?: string; message: string }[];
    warnings: { field?: string; message: string }[];
    recommendations: string[];
  };
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

/** Valide un destinataire (débiteur) par SIRET via l'Annuaire G2B. */
export async function validateG2BRecipient(
  config: ChorusConfig,
  siret: string,
  options: { serviceCode?: string; engagementNumber?: string } = {},
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<G2BRecipientValidation> {
  const url = resolveChorusBridgeUrl(config, G2B_ANNUAIRE_VALIDATE_RECIPIENT_PATH);
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: authHeaders({ Accept: 'application/json', 'Content-Type': 'application/json' }),
    body: JSON.stringify({ siret, serviceCode: options.serviceCode, engagementNumber: options.engagementNumber }),
  });
  const body = await parseBody(response);
  const record = isRecord(body) ? body : {};
  if (!response.ok || record.success !== true) {
    if (asString(record.error_code) === 'PISTE_AUTH_FAILED') {
      throw new Error('Validation annuaire indisponible : authentification PISTE ou habilitation API G2B à vérifier.');
    }
    throw new Error(asString(record.friendly_message) ?? asString(record.error) ?? `Validation du destinataire impossible (${response.status}).`);
  }
  const recipientRaw = isRecord(record.recipient) ? record.recipient : {};
  const validationRaw = isRecord(record.validation) ? record.validation : {};
  const addr = isRecord(recipientRaw.address) ? recipientRaw.address : null;
  return {
    success: true,
    recipient: {
      siret: asString(recipientRaw.siret),
      denomination: asString(recipientRaw.denomination),
      active: typeof recipientRaw.active === 'boolean' ? recipientRaw.active : null,
      address: addr
        ? { line1: asString(addr.line1), postalCode: asString(addr.postalCode), city: asString(addr.city), country: asString(addr.country) }
        : null,
      rules: (isRecord(recipientRaw.rules) ? recipientRaw.rules : {}) as G2BRecipientRules,
    },
    validation: {
      severity: typeof validationRaw.severity === 'string' ? validationRaw.severity : 'WARNING',
      errors: Array.isArray(validationRaw.errors) ? (validationRaw.errors as { field?: string; message: string }[]) : [],
      warnings: Array.isArray(validationRaw.warnings) ? (validationRaw.warnings as { field?: string; message: string }[]) : [],
      recommendations: Array.isArray(validationRaw.recommendations) ? (validationRaw.recommendations as string[]) : [],
    },
  };
}

import { loadAuthSession } from '@/lib/auth/session';
import { FIXED_CHORUS_SUPPLIER_ID } from '@/lib/chorus/constants';
import type { ChorusSubmissionTechnicalContext } from '@/lib/chorus/types';
import type { ChorusConfig } from '@/types/chorus';

function trimText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function parseOptionalInteger(value: string | undefined): number | undefined {
  const trimmed = trimText(value);
  if (!trimmed) {
    return undefined;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

export function buildChorusTechnicalContext(config: ChorusConfig): ChorusSubmissionTechnicalContext {
  const authSession = loadAuthSession();

  return {
    idUtilisateurCourant: parseOptionalInteger(config.submissionCurrentUserId) ?? parseOptionalInteger(authSession?.chorusCurrentUserId),
    codeCadreFacturation: trimText(config.submissionCadreCode),
    codeServiceValideur: trimText(config.submissionValidatorServiceCode),
    codeStructureValideur: trimText(config.submissionValidatorStructureCode),
    idFournisseur: parseOptionalInteger(config.submissionSupplierId)
      ?? parseOptionalInteger(authSession?.chorusSupplierId)
      ?? FIXED_CHORUS_SUPPLIER_ID,
    idServiceFournisseur: parseOptionalInteger(config.submissionSupplierServiceId) ?? parseOptionalInteger(authSession?.chorusSupplierServiceId),
    codeCoordonneesBancairesFournisseur: parseOptionalInteger(config.submissionBankAccountCode) ?? parseOptionalInteger(authSession?.chorusBankAccountCode),
    modePaiement: config.submissionPaymentMode,
    typeFacture: config.submissionInvoiceType,
    typeTva: config.submissionVatType === 'AUTO' ? undefined : config.submissionVatType,
    motifExonerationTva: trimText(config.submissionVatExonerationReason),
    numeroFactureOrigine: trimText(config.submissionOriginalInvoiceNumber),
    commentaire: trimText(config.submissionComment),
  };
}

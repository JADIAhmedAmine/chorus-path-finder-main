import { normalizeSiret } from '@/lib/chorus/normalizeSubmissionData';
import { validateChorusSubmissionPayload } from '@/lib/chorus/validateSubmissionPayload';
import { ChorusTransversesClient } from '@/lib/chorus/transversesClient';
import type {
  ChorusSubmissionPayload,
  ChorusSubmissionValidationResult,
  NormalizedInvoiceDraftData,
} from '@/lib/chorus/types';
import type {
  ChorusSubmissionReferenceSnapshot,
  ChorusTransverseBankAccount,
  ChorusTransverseCodeListItem,
  ChorusTransverseOperatingService,
  ChorusTransverseRecipient,
  ChorusTransverseVatRate,
} from '@/types/chorus';

export interface ChorusPayloadHydrationChange {
  path: string;
  previousValue?: string | number;
  nextValue?: string | number;
  reason: string;
}

export interface ChorusPayloadHydrationIssue {
  path: string;
  message: string;
}

export interface ChorusPayloadHydrationResult {
  payload: ChorusSubmissionPayload;
  snapshot: ChorusSubmissionReferenceSnapshot;
  validation: ChorusSubmissionValidationResult;
  changes: ChorusPayloadHydrationChange[];
  unresolved: ChorusPayloadHydrationIssue[];
}

function trimText(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function normalizeLookup(value: string | undefined | null): string {
  return trimText(value)
    ?.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase() ?? '';
}

function addChange(
  changes: ChorusPayloadHydrationChange[],
  path: string,
  previousValue: string | number | undefined,
  nextValue: string | number | undefined,
  reason: string,
): void {
  if (previousValue === nextValue) {
    return;
  }

  changes.push({
    path,
    previousValue,
    nextValue,
    reason,
  });
}

function addUnresolved(unresolved: ChorusPayloadHydrationIssue[], path: string, message: string): void {
  unresolved.push({ path, message });
}

function hasCode(items: ChorusTransverseCodeListItem[], code: string | undefined): boolean {
  return Boolean(code) && items.some((item) => item.code === code);
}

function resolveCodeValue(
  items: ChorusTransverseCodeListItem[],
  currentCode: string | undefined,
  fallbackCode?: string,
): string | undefined {
  if (currentCode && hasCode(items, currentCode)) {
    return currentCode;
  }

  if (fallbackCode && hasCode(items, fallbackCode)) {
    return fallbackCode;
  }

  if (items.length === 1) {
    return items[0]?.code;
  }

  return currentCode;
}

function resolveBankAccountCode(
  accounts: ChorusTransverseBankAccount[],
  currentCode: number | undefined,
): { value?: number; reason?: string } {
  if (currentCode !== undefined && accounts.some((account) => account.idCoordonneeBancaire === currentCode)) {
    return { value: currentCode };
  }

  if (accounts.length === 1 && accounts[0]?.idCoordonneeBancaire !== undefined) {
    return {
      value: accounts[0].idCoordonneeBancaire,
      reason: 'Une seule coordonnée bancaire valide a été retournée par Chorus Transverses.',
    };
  }

  return { value: currentCode };
}

function resolveDestinataireCode(
  recipients: ChorusTransverseRecipient[],
  currentCode: string | undefined,
  normalized: NormalizedInvoiceDraftData,
): { value?: string; reason?: string } {
  const normalizedCurrentCode = normalizeSiret(currentCode);
  if (normalizedCurrentCode && recipients.some((recipient) => recipient.codeDestinataire === normalizedCurrentCode)) {
    return { value: normalizedCurrentCode };
  }

  const explicitCustomerCode = normalizeSiret(normalized.publicCustomerCode);
  if (explicitCustomerCode) {
    const byCode = recipients.find((recipient) => recipient.codeDestinataire === explicitCustomerCode);
    if (byCode?.codeDestinataire) {
      return {
        value: byCode.codeDestinataire,
        reason: 'Destinataire rapproché automatiquement sur le code destinataire détecté dans la facture.',
      };
    }
  }

  const customerSiret = normalizeSiret(normalized.publicCustomerSiret);
  if (customerSiret) {
    const matchedRecipient = recipients.find((recipient) => recipient.siret === customerSiret);
    if (matchedRecipient) {
      return {
        value: matchedRecipient.codeDestinataire ?? customerSiret,
        reason: 'Destinataire rapproché automatiquement sur le SIRET détecté dans la facture.',
      };
    }
  }

  if (recipients.length === 1 && recipients[0]?.codeDestinataire) {
    return {
      value: recipients[0].codeDestinataire,
      reason: 'Un seul destinataire Chorus a été trouvé pour les critères fournis.',
    };
  }

  return { value: currentCode };
}

function resolveVatCode(
  rates: ChorusTransverseVatRate[],
  currentValue: string | undefined,
): string | undefined {
  if (!currentValue) {
    return currentValue;
  }

  const byCode = rates.find((rate) => rate.code === currentValue);
  if (byCode?.code) {
    return byCode.code;
  }

  const parsed = Number(currentValue);
  if (!Number.isFinite(parsed)) {
    return currentValue;
  }

  const normalizedRate = parsed > 1 ? parsed / 100 : parsed;
  const matchedRate = rates.find((rate) => rate.rate !== undefined && Math.abs(rate.rate - normalizedRate) <= 0.0001);
  return matchedRate?.code ?? currentValue;
}

function resolveServiceExecutantCode(
  services: ChorusTransverseOperatingService[],
  currentCode: string | undefined,
  normalized: NormalizedInvoiceDraftData,
): { value?: string; reason?: string } {
  if (currentCode && services.some((service) => service.codeServiceExecutant === currentCode)) {
    return { value: currentCode };
  }

  const extractedServiceCode = trimText(normalized.publicServiceCode);
  if (extractedServiceCode) {
    const byCode = services.find((service) => service.codeServiceExecutant === extractedServiceCode);
    if (byCode?.codeServiceExecutant) {
      return {
        value: byCode.codeServiceExecutant,
        reason: 'Service exécutant rapproché automatiquement sur le code détecté dans la facture.',
      };
    }
  }

  // Le service exécutant est optionnel dans le dépôt minimal Chorus.
  // On le rapproche seulement si un code est explicitement présent dans le formulaire.
  return { value: currentCode };
}

export function hydrateChorusSubmissionPayloadWithSnapshot(
  payload: ChorusSubmissionPayload,
  snapshot: ChorusSubmissionReferenceSnapshot,
  normalized: NormalizedInvoiceDraftData,
): ChorusPayloadHydrationResult {
  const changes: ChorusPayloadHydrationChange[] = [];
  const unresolved: ChorusPayloadHydrationIssue[] = [];

  const nextPayload: ChorusSubmissionPayload = {
    ...payload,
    cadreDeFacturation: { ...payload.cadreDeFacturation },
    destinataire: { ...payload.destinataire },
    fournisseur: { ...payload.fournisseur },
    montantTotal: { ...payload.montantTotal },
    references: { ...payload.references },
    lignePoste: [...payload.lignePoste],
    ligneTva: [...payload.ligneTva],
    pieceJointePrincipale: [...payload.pieceJointePrincipale],
    pieceJointeComplementaire: [...(payload.pieceJointeComplementaire ?? [])],
  };

  const nextCadreCode = resolveCodeValue(
    snapshot.cadresFacturation,
    nextPayload.cadreDeFacturation.codeCadreFacturation,
    'A1_FACTURE_FOURNISSEUR',
  );
  if (nextCadreCode) {
    addChange(
      changes,
      'cadreDeFacturation.codeCadreFacturation',
      nextPayload.cadreDeFacturation.codeCadreFacturation,
      nextCadreCode,
      'Cadre de facturation validé/résolu via le référentiel Chorus Transverses.',
    );
    nextPayload.cadreDeFacturation.codeCadreFacturation = nextCadreCode;
  }

  const nextDevise = resolveCodeValue(snapshot.devises, nextPayload.references.deviseFacture, 'EUR');
  if (nextDevise) {
    addChange(
      changes,
      'references.deviseFacture',
      nextPayload.references.deviseFacture,
      nextDevise,
      'Devise validée/résolue via le référentiel Chorus Transverses.',
    );
    nextPayload.references.deviseFacture = nextDevise;
  }

  const nextModePaiement = resolveCodeValue(snapshot.modesReglement, nextPayload.references.modePaiement);
  if (nextModePaiement) {
    addChange(
      changes,
      'references.modePaiement',
      nextPayload.references.modePaiement,
      nextModePaiement,
      'Mode de paiement validé/résolu via le référentiel Chorus Transverses.',
    );
    nextPayload.references.modePaiement = nextModePaiement;
  }

  const bankAccountResolution = resolveBankAccountCode(
    snapshot.coordonneesBancaires,
    nextPayload.fournisseur.codeCoordonneesBancairesFournisseur,
  );
  if (bankAccountResolution.value !== undefined) {
    addChange(
      changes,
      'fournisseur.codeCoordonneesBancairesFournisseur',
      nextPayload.fournisseur.codeCoordonneesBancairesFournisseur,
      bankAccountResolution.value,
      bankAccountResolution.reason ?? 'Coordonnée bancaire validée via Chorus Transverses.',
    );
    nextPayload.fournisseur.codeCoordonneesBancairesFournisseur = bankAccountResolution.value;
  }

  const destinataireResolution = resolveDestinataireCode(
    snapshot.destinataires,
    nextPayload.destinataire.codeDestinataire,
    normalized,
  );
  if (destinataireResolution.value) {
    addChange(
      changes,
      'destinataire.codeDestinataire',
      nextPayload.destinataire.codeDestinataire,
      destinataireResolution.value,
      destinataireResolution.reason ?? 'Destinataire validé via Chorus Transverses.',
    );
    nextPayload.destinataire.codeDestinataire = destinataireResolution.value;
  }

  const serviceResolution = resolveServiceExecutantCode(
    snapshot.servicesExecutants,
    nextPayload.destinataire.codeServiceExecutant,
    normalized,
  );
  if (serviceResolution.value) {
    addChange(
      changes,
      'destinataire.codeServiceExecutant',
      nextPayload.destinataire.codeServiceExecutant,
      serviceResolution.value,
      serviceResolution.reason ?? 'Service exécutant validé via Chorus Transverses.',
    );
    nextPayload.destinataire.codeServiceExecutant = serviceResolution.value;
  }

  nextPayload.lignePoste = nextPayload.lignePoste.map((line, index) => {
    const nextVatCode = resolveVatCode(snapshot.tauxTva, line.lignePosteTauxTva);
    if (nextVatCode && nextVatCode !== line.lignePosteTauxTva) {
      addChange(
        changes,
        `lignePoste[${index}].lignePosteTauxTva`,
        line.lignePosteTauxTva,
        nextVatCode,
        'Taux TVA converti vers le code Chorus issu du référentiel Transverses.',
      );
    }

    return {
      ...line,
      lignePosteTauxTva: nextVatCode,
      lignePosteTauxTvaManuel: nextVatCode ? undefined : line.lignePosteTauxTvaManuel,
    };
  });

  nextPayload.ligneTva = nextPayload.ligneTva.map((line, index) => {
    const nextVatCode = resolveVatCode(snapshot.tauxTva, line.ligneTvaTaux);
    if (nextVatCode && nextVatCode !== line.ligneTvaTaux) {
      addChange(
        changes,
        `ligneTva[${index}].ligneTvaTaux`,
        line.ligneTvaTaux,
        nextVatCode,
        'Taux TVA converti vers le code Chorus issu du référentiel Transverses.',
      );
    }

    return {
      ...line,
      ligneTvaTaux: nextVatCode,
      ligneTvaTauxManuel: nextVatCode ? undefined : line.ligneTvaTauxManuel,
    };
  });

  return {
    payload: nextPayload,
    snapshot,
    validation: validateChorusSubmissionPayload(nextPayload),
    changes,
    unresolved,
  };
}

export async function resolveAndHydrateChorusSubmissionPayload(
  client: ChorusTransversesClient,
  payload: ChorusSubmissionPayload,
  normalized: NormalizedInvoiceDraftData,
): Promise<ChorusPayloadHydrationResult> {
  const snapshot = await client.resolveSubmissionReferences({
    payload,
    supplierSiret: normalized.supplierSiret,
    recipientCode: normalized.publicCustomerCode,
    recipientSiret: normalized.publicCustomerSiret,
  });
  return hydrateChorusSubmissionPayloadWithSnapshot(payload, snapshot, normalized);
}

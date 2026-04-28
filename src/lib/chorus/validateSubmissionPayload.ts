import type {
  ChorusSubmissionPayload,
  ChorusSubmissionValidationIssue,
  ChorusSubmissionValidationResult,
} from '@/lib/chorus/types';

const AMOUNT_TOLERANCE = 0.05;

function nearlyEqual(left: number, right: number, tolerance = AMOUNT_TOLERANCE): boolean {
  return Math.abs(left - right) <= tolerance;
}

function pushIssue(
  issues: ChorusSubmissionValidationIssue[],
  path: string,
  code: string,
  message: string,
): void {
  issues.push({ path, code, message });
}

export function validateChorusSubmissionPayload(payload: ChorusSubmissionPayload): ChorusSubmissionValidationResult {
  const errors: ChorusSubmissionValidationIssue[] = [];
  const warnings: ChorusSubmissionValidationIssue[] = [];

  if (!payload.numeroFactureSaisi) {
    pushIssue(errors, 'numeroFactureSaisi', 'NUMERO_FACTURE_REQUIRED', 'Le numero de facture saisi est obligatoire.');
  }

  if (!payload.dateFacture) {
    pushIssue(errors, 'dateFacture', 'DATE_FACTURE_REQUIRED', 'La date de facture est obligatoire.');
  }

  if (!payload.destinataire.codeDestinataire) {
    pushIssue(errors, 'destinataire.codeDestinataire', 'DESTINATAIRE_REQUIRED', 'Le code destinataire est obligatoire.');
  }

  if (payload.lignePoste.length === 0) {
    pushIssue(errors, 'lignePoste', 'LIGNE_POSTE_REQUIRED', 'Au moins une lignePoste est obligatoire.');
  }

  if (payload.montantTotal.montantTVA > 0 && payload.ligneTva.length === 0) {
    pushIssue(errors, 'ligneTva', 'LIGNE_TVA_REQUIRED', 'Au moins une ligneTva est obligatoire quand le montant TVA est positif.');
  }

  const expectedTtc = payload.montantTotal.montantHtTotal + payload.montantTotal.montantTVA;
  if (!nearlyEqual(expectedTtc, payload.montantTotal.montantTtcTotal)) {
    pushIssue(
      errors,
      'montantTotal.montantTtcTotal',
      'TOTALS_INCONSISTENT',
      'La coherence entre montant HT, montant TVA et montant TTC n est pas respectee.',
    );
  }

  if (!nearlyEqual(payload.montantTotal.montantAPayer, payload.montantTotal.montantTtcTotal)) {
    pushIssue(
      warnings,
      'montantTotal.montantAPayer',
      'AMOUNT_TO_PAY_DIFFERS',
      'Le montant a payer differe du montant TTC total.',
    );
  }

  if (payload.modeDepot !== 'SAISIE_API' && payload.pieceJointePrincipale.length === 0) {
    pushIssue(
      errors,
      'pieceJointePrincipale',
      'MAIN_ATTACHMENT_REQUIRED',
      'Une pieceJointePrincipale est obligatoire pour un depot PDF.',
    );
  }

  if (payload.modeDepot !== 'SAISIE_API' && payload.pieceJointePrincipale[0]?.pieceJointePrincipaleId === undefined) {
    pushIssue(
      errors,
      'pieceJointePrincipale[0].pieceJointePrincipaleId',
      'MAIN_ATTACHMENT_ID_REQUIRED',
      'L identifiant Chorus de la piece jointe principale est obligatoire apres deposer/pdf.',
    );
  }

  if (payload.references.typeTva === 'EXONERATION' && !payload.references.motifExonerationTva) {
    pushIssue(
      errors,
      'references.motifExonerationTva',
      'MOTIF_EXONERATION_REQUIRED',
      'Le motif d exoneration TVA est obligatoire quand typeTva vaut EXONERATION.',
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

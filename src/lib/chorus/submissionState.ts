// Reflète les contraintes serveur (chorus_python/submission_state.py).
// Toute mise à jour ici DOIT rester synchronisée avec le backend.

export const CHORUS_SUBMISSION_STATE_ERROR_CODE = 'INVALID_PAYMENT_REQUEST_STATE';

export const CHORUS_ALLOWED_SUBMISSION_STATES = [
  'BROUILLON',
  'ERREUR_FOURNISSEUR_SUR_VALIDEUR',
] as const;

export type ChorusAllowedSubmissionState = typeof CHORUS_ALLOWED_SUBMISSION_STATES[number];

export const CHORUS_BLOCKED_SUBMISSION_STATE = 'REJETEE';

export type ChorusSubmissionStateReason = 'rejected' | 'recyclable' | 'missing' | 'unknown';

export type ChorusSubmissionEvaluationKind =
  | 'allowed'
  | 'rejected'
  | 'recyclable'
  | 'missing'
  | 'unknown';

export interface ChorusSubmissionStateEvaluation {
  /** État courant normalisé (uppercase), ou `null` si absent. */
  currentState: string | null;
  /** Verdict pour la soumission. */
  kind: ChorusSubmissionEvaluationKind;
  /** Liste figée des états acceptés (sans muter la constante). */
  allowedStates: readonly ChorusAllowedSubmissionState[];
  /** Phrase courte adaptée au manager (sans jargon). */
  message: string;
  /** Liste d'actions recommandées en langage métier. */
  recommendedActions: string[];
  /** Indique si l'utilisateur peut tenter une soumission. */
  canSubmit: boolean;
}

const ALLOWED_SET = new Set<string>(CHORUS_ALLOWED_SUBMISSION_STATES);

const STATE_HUMAN_LABEL: Record<string, string> = {
  BROUILLON: 'Brouillon',
  ERREUR_FOURNISSEUR_SUR_VALIDEUR: 'Erreur fournisseur sur valideur',
  A_RECYCLER: 'À recycler',
  REJETEE: 'Rejetée',
};

export function getChorusStateHumanLabel(state: string | null | undefined): string {
  if (!state) {
    return 'Inconnu';
  }
  const normalized = state.trim().toUpperCase();
  return STATE_HUMAN_LABEL[normalized] || normalized;
}

export function formatAllowedStatesForHuman(): string {
  return CHORUS_ALLOWED_SUBMISSION_STATES.map(getChorusStateHumanLabel).join(', ');
}

export function normalizeChorusState(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  return normalized || null;
}

export function evaluateChorusSubmissionState(
  value: string | null | undefined,
): ChorusSubmissionStateEvaluation {
  const currentState = normalizeChorusState(value);
  const allowedStates = CHORUS_ALLOWED_SUBMISSION_STATES;

  if (currentState === null) {
    return {
      currentState: null,
      kind: 'missing',
      allowedStates,
      message:
        'Aucun état Chorus n’est encore connu pour cette demande de paiement.',
      recommendedActions: [
        'Synchroniser la facture avec Chorus Pro pour récupérer son état courant.',
      ],
      canSubmit: false,
    };
  }

  if (currentState === CHORUS_BLOCKED_SUBMISSION_STATE) {
    return {
      currentState,
      kind: 'rejected',
      allowedStates,
      message:
        'Cette demande de paiement ne peut pas être soumise car elle est actuellement rejetée.',
      recommendedActions: [
        'Vérifier dans Chorus Pro le motif précis du rejet.',
        'Créer une nouvelle facture corrigée avec un nouveau numéro.',
        'Ne pas relancer la soumission tant que l’état reste REJETEE.',
      ],
      canSubmit: false,
    };
  }

  if (currentState === 'A_RECYCLER') {
    return {
      currentState,
      kind: 'recyclable',
      allowedStates,
      message:
        'Cette demande de paiement doit passer par le recyclage dédié, sans modification libre de la facture.',
      recommendedActions: [
        'Corriger uniquement le SIRET destinataire, le code service ou l’engagement juridique.',
        'Utiliser ensuite l’action « Recycler la facture ».',
        'Ne pas modifier le montant, la TVA, les lignes, le fournisseur ou le numéro de facture.',
      ],
      canSubmit: false,
    };
  }

  if (ALLOWED_SET.has(currentState)) {
    return {
      currentState,
      kind: 'allowed',
      allowedStates,
      message:
        'La demande de paiement est dans un état compatible avec une soumission Chorus Pro.',
      recommendedActions: [
        'Lancer la soumission si les pièces et montants sont à jour.',
      ],
      canSubmit: true,
    };
  }

  return {
    currentState,
    kind: 'unknown',
    allowedStates,
    message:
      'L’état Chorus actuel n’est pas reconnu comme compatible avec une soumission.',
    recommendedActions: [
      'Synchroniser la facture pour confirmer son état courant côté Chorus Pro.',
      'Si l’état persiste, traiter la facture dans Chorus Pro avant de réessayer.',
    ],
    canSubmit: false,
  };
}

export interface ChorusSubmissionStateErrorPayload {
  errorCode: typeof CHORUS_SUBMISSION_STATE_ERROR_CODE;
  reason: ChorusSubmissionStateReason;
  currentState: string | null;
  allowedStates: string[];
  message: string;
}

export function parseChorusSubmissionStateErrorPayload(
  body: unknown,
): ChorusSubmissionStateErrorPayload | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (record.error_code !== CHORUS_SUBMISSION_STATE_ERROR_CODE) {
    return null;
  }
  const reason = record.reason;
  const normalizedReason: ChorusSubmissionStateReason =
    reason === 'rejected' || reason === 'recyclable' || reason === 'missing' || reason === 'unknown'
      ? reason
      : 'unknown';
  const allowedStates = Array.isArray(record.allowed_states)
    ? record.allowed_states.filter((value): value is string => typeof value === 'string')
    : [...CHORUS_ALLOWED_SUBMISSION_STATES];
  const message =
    typeof record.message === 'string' && record.message.trim()
      ? record.message
      : 'État de la demande de paiement incompatible avec la soumission.';
  const currentStateRaw = record.current_state;
  const currentState = typeof currentStateRaw === 'string' ? currentStateRaw : null;

  return {
    errorCode: CHORUS_SUBMISSION_STATE_ERROR_CODE,
    reason: normalizedReason,
    currentState,
    allowedStates,
    message,
  };
}

export class ChorusSubmissionStateError extends Error {
  readonly errorCode = CHORUS_SUBMISSION_STATE_ERROR_CODE;

  readonly currentState: string | null;

  readonly allowedStates: string[];

  readonly reason: ChorusSubmissionStateReason;

  constructor(payload: ChorusSubmissionStateErrorPayload) {
    super(payload.message);
    this.name = 'ChorusSubmissionStateError';
    this.currentState = payload.currentState;
    this.allowedStates = payload.allowedStates;
    this.reason = payload.reason;
  }
}

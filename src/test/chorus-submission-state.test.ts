import { describe, expect, it } from 'vitest';
import {
  CHORUS_ALLOWED_SUBMISSION_STATES,
  CHORUS_SUBMISSION_STATE_ERROR_CODE,
  ChorusSubmissionStateError,
  evaluateChorusSubmissionState,
  parseChorusSubmissionStateErrorPayload,
} from '@/lib/chorus/submissionState';

describe('evaluateChorusSubmissionState', () => {
  it.each(CHORUS_ALLOWED_SUBMISSION_STATES)('treats %s as a submittable state', (state) => {
    const evaluation = evaluateChorusSubmissionState(state);
    expect(evaluation.kind).toBe('allowed');
    expect(evaluation.canSubmit).toBe(true);
    expect(evaluation.currentState).toBe(state);
  });

  it('flags REJETEE as a non-submittable rejected state', () => {
    const evaluation = evaluateChorusSubmissionState('REJETEE');
    expect(evaluation.kind).toBe('rejected');
    expect(evaluation.canSubmit).toBe(false);
    expect(evaluation.recommendedActions.length).toBeGreaterThan(0);
  });

  it('routes A_RECYCLER to the dedicated recycle action', () => {
    const evaluation = evaluateChorusSubmissionState('A_RECYCLER');
    expect(evaluation.kind).toBe('recyclable');
    expect(evaluation.canSubmit).toBe(false);
    expect(evaluation.recommendedActions.join(' ')).toContain('SIRET');
  });

  it('flags absent state as missing', () => {
    const evaluation = evaluateChorusSubmissionState(null);
    expect(evaluation.kind).toBe('missing');
    expect(evaluation.canSubmit).toBe(false);
  });

  it('flags an unknown raw state as unknown', () => {
    const evaluation = evaluateChorusSubmissionState('FOO_BAR');
    expect(evaluation.kind).toBe('unknown');
    expect(evaluation.canSubmit).toBe(false);
    expect(evaluation.currentState).toBe('FOO_BAR');
  });

  it('normalizes lowercase states before evaluation', () => {
    const evaluation = evaluateChorusSubmissionState('brouillon');
    expect(evaluation.kind).toBe('allowed');
    expect(evaluation.currentState).toBe('BROUILLON');
  });
});

describe('parseChorusSubmissionStateErrorPayload', () => {
  it('parses a well-formed backend rejection payload', () => {
    const payload = parseChorusSubmissionStateErrorPayload({
      success: false,
      ok: false,
      error_code: CHORUS_SUBMISSION_STATE_ERROR_CODE,
      reason: 'rejected',
      current_state: 'REJETEE',
      allowed_states: ['BROUILLON', 'ERREUR_FOURNISSEUR_SUR_VALIDEUR'],
      message:
        'La demande de paiement ne peut pas être soumise car son état est REJETEE.',
    });

    expect(payload).not.toBeNull();
    expect(payload?.reason).toBe('rejected');
    expect(payload?.currentState).toBe('REJETEE');
    expect(payload?.allowedStates).toEqual([
      'BROUILLON',
      'ERREUR_FOURNISSEUR_SUR_VALIDEUR',
    ]);
  });

  it('returns null when the error code does not match', () => {
    const payload = parseChorusSubmissionStateErrorPayload({
      ok: false,
      error_code: 'SOMETHING_ELSE',
    });
    expect(payload).toBeNull();
  });

  it('falls back to a default message when the backend omits one', () => {
    const payload = parseChorusSubmissionStateErrorPayload({
      ok: false,
      error_code: CHORUS_SUBMISSION_STATE_ERROR_CODE,
      reason: 'unknown',
      current_state: null,
      allowed_states: [],
    });

    expect(payload).not.toBeNull();
    expect(payload?.reason).toBe('unknown');
    expect(payload?.message.length).toBeGreaterThan(0);
  });

  it('builds a typed error that preserves the structured payload', () => {
    const payload = parseChorusSubmissionStateErrorPayload({
      ok: false,
      error_code: CHORUS_SUBMISSION_STATE_ERROR_CODE,
      reason: 'rejected',
      current_state: 'REJETEE',
      allowed_states: ['BROUILLON'],
      message: 'État REJETEE incompatible.',
    });

    const error = new ChorusSubmissionStateError(payload!);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ChorusSubmissionStateError');
    expect(error.currentState).toBe('REJETEE');
    expect(error.reason).toBe('rejected');
    expect(error.allowedStates).toEqual(['BROUILLON']);
    expect(error.message).toBe('État REJETEE incompatible.');
  });
});

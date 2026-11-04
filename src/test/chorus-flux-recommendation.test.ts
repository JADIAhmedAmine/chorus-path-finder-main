import { describe, it, expect } from 'vitest';
import { buildFluxRecommendation } from '@/lib/chorus/fluxDetection';

describe('buildFluxRecommendation', () => {
  it('returns null when no file is detected', () => {
    expect(
      buildFluxRecommendation({ detectedFileType: null, selectedFormatFlux: null, selectedSyntaxeFlux: null }),
    ).toBeNull();
  });

  it('recommends a Factur-X deposit for FACTURX_CII', () => {
    const reco = buildFluxRecommendation({
      detectedFileType: 'FACTURX_CII',
      selectedFormatFlux: null,
      selectedSyntaxeFlux: null,
    });
    expect(reco).toMatchObject({
      status: 'recommended',
      title: 'Dépôt Factur-X recommandé',
      recommendedFormatFlux: 'IN_DP_E2_FACTURX_FE',
      recommendedSyntaxeFlux: 'IN_DP_E2_CII_FACTURX_FE',
    });
  });

  it('prefers the available Chorus format/syntaxe over the first preference', () => {
    const reco = buildFluxRecommendation({
      detectedFileType: 'FACTURX_CII',
      selectedFormatFlux: 'IN_DP_E2_FACTURX',
      selectedSyntaxeFlux: null,
      availableFormats: ['IN_DP_E2_FACTURX'],
      availableSyntaxes: ['IN_DP_E2_CII_FACTURX'],
    });
    expect(reco?.recommendedFormatFlux).toBe('IN_DP_E2_FACTURX');
    expect(reco?.recommendedSyntaxeFlux).toBe('IN_DP_E2_CII_FACTURX');
  });

  it('recommends UBL E1 for UBL_INVOICE', () => {
    const reco = buildFluxRecommendation({
      detectedFileType: 'UBL_INVOICE',
      selectedFormatFlux: null,
      selectedSyntaxeFlux: null,
    });
    expect(reco).toMatchObject({
      status: 'recommended',
      recommendedFormatFlux: 'IN_DP_E1_STRUCT',
      recommendedSyntaxeFlux: 'IN_DP_E1_UBL_INVOICE',
    });
  });

  it('confirms the match when the chosen UBL syntaxe is compatible', () => {
    const reco = buildFluxRecommendation({
      detectedFileType: 'UBL_INVOICE',
      selectedFormatFlux: 'IN_DP_E1_STRUCT',
      selectedSyntaxeFlux: 'IN_DP_E1_UBL_INVOICE',
    });
    expect(reco?.status).toBe('recommended');
    expect(reco?.why).toBe('Le type détecté correspond à la syntaxe choisie.');
  });

  it('warns when the chosen syntaxe mismatches the detected type', () => {
    const reco = buildFluxRecommendation({
      detectedFileType: 'UBL_INVOICE',
      selectedFormatFlux: 'IN_DP_E1_STRUCT',
      selectedSyntaxeFlux: 'IN_DP_E1_CII_16B',
    });
    expect(reco?.status).toBe('warning');
    expect(reco?.why).toContain('ne correspond pas');
  });

  it('recommends CII E1 and steers away from UBL for CII_INVOICE', () => {
    const reco = buildFluxRecommendation({
      detectedFileType: 'CII_INVOICE',
      selectedFormatFlux: null,
      selectedSyntaxeFlux: null,
    });
    expect(reco).toMatchObject({
      status: 'recommended',
      recommendedFormatFlux: 'IN_DP_E1_STRUCT',
      recommendedSyntaxeFlux: 'IN_DP_E1_CII_16B',
    });
  });

  it('flags CPP facture mixte as à vérifier when no CPP syntaxe is available', () => {
    const reco = buildFluxRecommendation({
      detectedFileType: 'CPP_FACTURE_MIXTE',
      selectedFormatFlux: 'IN_DP_E2_MIXTE',
      selectedSyntaxeFlux: null,
      availableSyntaxes: ['IN_DP_E2_UBL_INVOICE_MIN'],
    });
    expect(reco?.status).toBe('warning');
    expect(reco?.recommendedFormatFlux).toBe('IN_DP_E2_MIXTE');
  });

  it('recommends CPP facture mixte when a CPP syntaxe is returned by Chorus', () => {
    const reco = buildFluxRecommendation({
      detectedFileType: 'CPP_FACTURE_MIXTE',
      selectedFormatFlux: 'IN_DP_E2_MIXTE',
      selectedSyntaxeFlux: null,
      availableSyntaxes: ['IN_DP_E2_CPP_FACTURE_MIN'],
    });
    expect(reco?.status).toBe('recommended');
  });

  it('blocks CPPFacturePivot output flows', () => {
    const reco = buildFluxRecommendation({
      detectedFileType: 'CHORUS_PIVOT_OUTPUT',
      selectedFormatFlux: null,
      selectedSyntaxeFlux: null,
    });
    expect(reco).toMatchObject({
      status: 'blocked',
      title: 'Dépôt non autorisé',
      recommendedFormatFlux: null,
      recommendedSyntaxeFlux: null,
      shortExplanation: 'Ce fichier est un flux pivot sortant Chorus.',
      why: "Ce n'est pas une facture entrante à déposer.",
      actionLabel: 'Choisissez un autre fichier.',
    });
  });

  it('blocks CPPStatut lifecycle return flows', () => {
    const reco = buildFluxRecommendation({
      detectedFileType: 'CHORUS_LIFECYCLE_STATUS_OUTPUT',
      selectedFormatFlux: null,
      selectedSyntaxeFlux: null,
    });
    expect(reco?.status).toBe('blocked');
    expect(reco?.recommendedFormatFlux).toBeNull();
  });

  it('marks a generic PDF as conversion required', () => {
    const reco = buildFluxRecommendation({
      detectedFileType: 'PDF_GENERIC',
      selectedFormatFlux: null,
      selectedSyntaxeFlux: null,
    });
    expect(reco?.status).toBe('warning');
    expect(reco?.recommendedFormatFlux).toBeNull();
    expect(reco?.actionLabel).toContain('PDF facture');
  });
});

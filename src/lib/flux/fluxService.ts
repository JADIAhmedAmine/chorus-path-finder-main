/**
 * Façade de service « flux » pour l'espace Flux.
 *
 * Ce module n'introduit AUCUNE nouvelle logique réseau : il regroupe et ré-expose les
 * opérations de flux déjà implémentées (Chorus Pro classique + API G2B exposées sur
 * PISTE), afin d'offrir un point d'import unique et stable au nouveau hub `/flux`.
 * Les pages existantes continuent d'importer directement leurs modules d'origine.
 */

// --- Dépôt de flux Chorus Pro (XML / Factur-X) -----------------------------
export {
  detectChorusFlux,
  businessValidateChorusFlux,
  depositChorusFlux,
  fetchChorusFluxFormats,
  fetchChorusFluxSyntaxes,
  fetchChorusFluxGuide,
} from '@/lib/chorus/fluxDeposit';
export type {
  ChorusFluxDepositResult,
  ChorusFluxGuideEntry,
} from '@/lib/chorus/fluxDeposit';

// --- Dépôt de flux via API G2B (PISTE) -------------------------------------
export {
  G2B_CODE_INTERFACES,
  detectG2BFlux,
  businessValidateG2BFlux,
  depositG2BFlux,
  getG2BFluxStatus,
} from '@/lib/g2b/g2bFluxApi';
export type {
  G2BDetectResult,
  G2BBusinessValidation,
  G2BDepositResult,
  G2BStatusResult,
} from '@/lib/g2b/g2bFluxApi';

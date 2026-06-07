/**
 * Façade de service « annuaire » pour l'espace Flux.
 *
 * Ré-expose la validation de destinataire via l'API Annuaire G2B (catalogue PISTE).
 * Aucune nouvelle logique : point d'import unique pour les contrôles annuaire du hub.
 */

export {
  validateG2BRecipient,
  G2B_ANNUAIRE_VALIDATE_RECIPIENT_PATH,
} from '@/lib/g2b/g2bAnnuaireApi';
export type {
  G2BRecipientValidation,
  G2BRecipientRules,
  G2BRecipientAddress,
} from '@/lib/g2b/g2bAnnuaireApi';

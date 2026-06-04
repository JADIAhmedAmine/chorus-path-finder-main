import { getChorusRawStatusConfig } from '@/lib/status-utils';

export type InvoiceBusinessContext = 'reception' | 'emission';
export type InvoiceGuideSeverity = 'info' | 'warning' | 'error' | 'success';
export type InvoiceGuideActionAvailability = 'available' | 'planned' | 'unavailable';

export interface InvoiceGuideInput {
  context: InvoiceBusinessContext;
  status?: string | null;
  source?: string | null;
}

export interface InvoiceGuideAction {
  label: string;
  availability: InvoiceGuideActionAvailability;
  note?: string;
}

export interface InvoiceStatusGuide {
  statusLabel: string;
  context: InvoiceBusinessContext;
  contextLabel: string;
  contextDescription: string;
  description: string;
  actions: InvoiceGuideAction[];
  recommendedAction: string;
  severity: InvoiceGuideSeverity;
}

function normalizeStatus(status?: string | null): string {
  return String(status ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_');
}

function hasAny(status: string, parts: string[]): boolean {
  return parts.some((part) => status.includes(part));
}

function contextDescription(context: InvoiceBusinessContext): string {
  if (context === 'reception') {
    return 'Facture reçue par votre structure, action attendue côté valideur/récepteur.';
  }
  return 'Facture envoyée ou déposée par votre structure, suivi attendu côté dépôt/émetteur.';
}

function severityFor(status: string): InvoiceGuideSeverity {
  if (hasAny(status, ['REJET', 'REFUS', 'ERREUR', 'NON_CONFORME', 'ABANDON', 'SUPPRIM'])) {
    return 'error';
  }
  if (hasAny(status, ['SUSPEND', 'RECYCL', 'A_VALIDER', 'A_COMPLETER', 'A_ASSOCIER', 'HORS_DELAI'])) {
    return 'warning';
  }
  if (hasAny(status, ['PAY', 'PAIE', 'PAIEMENT', 'MANDAT', 'COMPTABIL', 'SERVICE_FAIT', 'VALIDEE', 'PRISE_EN_COMPTE'])) {
    return 'success';
  }
  return 'info';
}

function action(label: string, availability: InvoiceGuideActionAvailability = 'available', note?: string): InvoiceGuideAction {
  return { label, availability, note };
}

export function getInvoiceGuide(input: InvoiceGuideInput): InvoiceStatusGuide {
  const status = normalizeStatus(input.status);
  const statusLabel = getChorusRawStatusConfig(input.status || '').label || 'Statut inconnu';
  const contextLabel = input.context === 'reception' ? 'Réception' : 'Émission';
  const base = {
    statusLabel,
    context: input.context,
    contextLabel,
    contextDescription: contextDescription(input.context),
    severity: severityFor(status),
  } satisfies Pick<InvoiceStatusGuide, 'statusLabel' | 'context' | 'contextLabel' | 'contextDescription' | 'severity'>;

  if (input.context === 'reception' && hasAny(status, ['SUSPEND', 'A_COMPLETER'])) {
    return {
      ...base,
      description: 'La facture nécessite un complément ou une correction avant traitement.',
      actions: [
        action('Compléter la facture', 'available'),
        action('Ajouter un commentaire', 'available'),
        action('Ajouter une pièce jointe', 'planned', 'Disponible seulement si le endpoint Chorus l’autorise pour ce statut.'),
        action('Traiter ensuite la facture reçue', 'available'),
      ],
      recommendedAction: 'Vérifier la raison de suspension et fournir les éléments manquants.',
    };
  }

  if (input.context === 'reception' && hasAny(status, ['A_VALIDER', 'MISE_A_DISPOSITION', 'A_ASSOCIER'])) {
    return {
      ...base,
      description: 'La facture attend une décision ou une qualification côté valideur.',
      actions: [
        action('Accepter ou prendre en compte', 'available'),
        action('Refuser', 'available'),
        action('Suspendre', 'available'),
        action('Compléter selon les droits disponibles', 'planned'),
      ],
      recommendedAction: 'Vérifier les données principales puis appliquer une décision métier.',
    };
  }

  if (input.context === 'emission' && hasAny(status, ['REJET', 'REFUS', 'ERREUR', 'NON_CONFORME'])) {
    return {
      ...base,
      description: 'Le dépôt, l’acheminement ou la validation Chorus a échoué.',
      actions: [
        action('Consulter le motif de rejet', 'available'),
        action('Corriger les données', 'available'),
        action('Télécharger ou consulter le flux initial', 'available'),
        action('Redéposer la facture corrigée', 'planned', 'À faire uniquement si le statut et le flux le permettent.'),
      ],
      recommendedAction: 'Identifier l’erreur bloquante et préparer une correction.',
    };
  }

  if (input.context === 'emission' && hasAny(status, ['DEPOSEE', 'EN_COURS', 'MISE_A_DISPOSITION', 'STATUS_SYNC', 'ASSOCIEE'])) {
    return {
      ...base,
      description: 'La facture a été envoyée à Chorus et attend un traitement ou une mise à jour de statut.',
      actions: [
        action('Suivre le statut', 'available'),
        action('Consulter le flux', 'available'),
        action('Vérifier les retours Chorus', 'available'),
      ],
      recommendedAction: 'Attendre le retour ou surveiller le changement de statut.',
    };
  }

  if (base.severity === 'success') {
    return {
      ...base,
      description: input.context === 'reception'
        ? 'La facture a reçu une prise en compte ou une décision favorable côté réception.'
        : 'La facture suit un état favorable ou finalisé côté émission.',
      actions: [
        action('Consulter l’historique', 'available'),
        action('Télécharger les justificatifs disponibles', 'available'),
      ],
      recommendedAction: 'Archiver ou surveiller uniquement si une action métier reste attendue.',
    };
  }

  return {
    ...base,
    description: input.context === 'reception'
      ? 'La facture est suivie côté réception. Le détail Chorus permet de confirmer l’action attendue.'
      : 'La facture est suivie côté émission. Le détail Chorus permet de confirmer l’état de dépôt.',
    actions: [
      action(input.context === 'reception' ? 'Voir détails Chorus' : 'Voir statut', 'available'),
      action('Télécharger PDF', 'available'),
      action(input.context === 'reception' ? 'Traiter si le statut le permet' : 'Corriger si un rejet apparaît', 'planned'),
    ],
    recommendedAction: input.context === 'reception'
      ? 'Ouvrir le détail et vérifier si une décision côté valideur est attendue.'
      : 'Ouvrir le détail et vérifier le dernier retour Chorus.',
  };
}

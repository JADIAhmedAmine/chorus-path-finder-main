import { describe, expect, it } from 'vitest';
import { getInvoiceGuide } from '@/lib/chorus/invoiceStatusGuide';

describe('invoice correction workflows', () => {
  it('requires a new invoice number after a rejection', () => {
    const guide = getInvoiceGuide({ context: 'emission', status: 'REJETEE' });

    expect(guide.description).toContain('nouveau numéro');
    expect(guide.actions.map((action) => action.label)).toContain(
      'Créer une nouvelle facture corrigée',
    );
  });

  it('limits a suspension to complements, attachments and comments', () => {
    const guide = getInvoiceGuide({ context: 'emission', status: 'SUSPENDUE' });
    const labels = guide.actions.map((action) => action.label).join(' ');

    expect(labels).toContain('complément');
    expect(labels).toContain('commentaire');
    expect(labels).toContain('pièce jointe');
  });

  it('limits A_RECYCLER to routing corrections', () => {
    const guide = getInvoiceGuide({ context: 'emission', status: 'A_RECYCLER' });
    const labels = guide.actions.map((action) => action.label).join(' ');

    expect(labels).toContain('SIRET destinataire');
    expect(labels).toContain('code service destinataire');
    expect(guide.recommendedAction).toContain('TVA');
    expect(guide.recommendedAction).toContain('numéro');
  });

  it('keeps an integrated invoice read-only', () => {
    const guide = getInvoiceGuide({ context: 'emission', status: 'INTEGREE' });

    expect(guide.description).toContain('lecture seule');
    expect(guide.recommendedAction).toContain('Aucune correction');
  });
});

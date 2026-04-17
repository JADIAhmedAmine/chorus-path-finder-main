import { beforeEach, describe, expect, it } from 'vitest';
import { saveAuthSession } from '@/lib/auth/session';
import { buildChorusTechnicalContext } from '@/lib/chorus/technicalContext';
import { getDefaultChorusConfig } from '@/lib/chorus/storage';

describe('chorus technical context', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('maps persisted config strings to a typed Chorus submission context', () => {
    const context = buildChorusTechnicalContext({
      ...getDefaultChorusConfig(),
      submissionCurrentUserId: '331',
      submissionSupplierId: '160',
      submissionSupplierServiceId: '436',
      submissionBankAccountCode: '132',
      submissionCadreCode: 'A1_FACTURE_FOURNISSEUR',
      submissionValidatorServiceCode: 'VAL-SERVICE',
      submissionValidatorStructureCode: 'VAL-STRUCT',
      submissionPaymentMode: 'VIREMENT',
      submissionInvoiceType: 'FACTURE',
      submissionVatType: 'TVA_SUR_DEBIT',
      submissionVatExonerationReason: '',
      submissionOriginalInvoiceNumber: 'FAC-2025-001',
      submissionComment: 'Test Chorus',
    });

    expect(context).toEqual({
      idUtilisateurCourant: 331,
      idFournisseur: 160,
      idServiceFournisseur: 436,
      codeCoordonneesBancairesFournisseur: 132,
      codeCadreFacturation: 'A1_FACTURE_FOURNISSEUR',
      codeServiceValideur: 'VAL-SERVICE',
      codeStructureValideur: 'VAL-STRUCT',
      modePaiement: 'VIREMENT',
      typeFacture: 'FACTURE',
      typeTva: 'TVA_SUR_DEBIT',
      motifExonerationTva: undefined,
      numeroFactureOrigine: 'FAC-2025-001',
      commentaire: 'Test Chorus',
    });
  });

  it('omits optional values and keeps VAT type automatic when configured', () => {
    const context = buildChorusTechnicalContext({
      ...getDefaultChorusConfig(),
      submissionVatType: 'AUTO',
    });

    expect(context.typeTva).toBeUndefined();
    expect(context.idUtilisateurCourant).toBeUndefined();
    expect(context.idFournisseur).toBeUndefined();
  });

  it('falls back to the local auth session when Chorus config ids are empty', () => {
    saveAuthSession({
      email: 'marie.dupont@example.test',
      firstName: 'Marie',
      lastName: 'Dupont',
      roleCode: 'GESTIONNAIRE',
      chorusCurrentUserId: '331',
      chorusSupplierId: '160',
      chorusSupplierServiceId: '436',
      chorusBankAccountCode: '132',
      createdAt: new Date().toISOString(),
    });

    const context = buildChorusTechnicalContext({
      ...getDefaultChorusConfig(),
      submissionCurrentUserId: '',
      submissionSupplierId: '',
      submissionSupplierServiceId: '',
      submissionBankAccountCode: '',
    });

    expect(context.idUtilisateurCourant).toBe(331);
    expect(context.idFournisseur).toBe(160);
    expect(context.idServiceFournisseur).toBe(436);
    expect(context.codeCoordonneesBancairesFournisseur).toBe(132);
  });
});

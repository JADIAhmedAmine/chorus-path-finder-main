import { describe, expect, it } from 'vitest';
import { PisteChorusRoutes } from '@/lib/chorus/pisteRoutes';
import { getDefaultChorusConfig } from '@/lib/chorus/storage';

describe('PisteChorusRoutes', () => {
  it('builds factures urls from the configured api base', () => {
    const routes = new PisteChorusRoutes({
      ...getDefaultChorusConfig(),
      apiBaseUrl: 'https://sandbox-api.piste.gouv.fr/cpro/factures',
      connectionTestPath: '/v1/rechercher/fournisseur',
      uploadFilePath: '/v1/deposer/pdf',
      submitInvoicePath: '/v1/soumettre',
    });

    expect(routes.connectionTestUrl()).toBe('https://sandbox-api.piste.gouv.fr/cpro/factures/v1/rechercher/fournisseur');
    expect(routes.uploadFileUrl()).toBe('https://sandbox-api.piste.gouv.fr/cpro/factures/v1/deposer/pdf');
    expect(routes.submitInvoiceUrl()).toBe('https://sandbox-api.piste.gouv.fr/cpro/factures/v1/soumettre');
    expect(routes.isPdfDepositUpload()).toBe(true);
    expect(routes.transversesBaseUrl()).toBe('https://sandbox-api.piste.gouv.fr/cpro/transverses');
    expect(routes.transversesCadresFacturationUrl()).toBe('https://sandbox-api.piste.gouv.fr/cpro/transverses/v1/recuperer/cadrefacturation');
    expect(routes.transversesRechercherDestinataireUrl()).toBe('https://sandbox-api.piste.gouv.fr/cpro/transverses/v1/rechercher/destinataire');
  });

  it('builds utilisateurs urls from the platform root when using /cpro paths', () => {
    const routes = new PisteChorusRoutes({
      ...getDefaultChorusConfig(),
      apiBaseUrl: 'https://sandbox-api.piste.gouv.fr/cpro/factures',
      userAccountPath: '/cpro/utilisateurs/v1/consulter/compte',
      userConnectionsPath: '/cpro/utilisateurs/v1/monCompte/recuperer/rattachements',
    });

    expect(routes.userAccountUrl()).toBe('https://sandbox-api.piste.gouv.fr/cpro/utilisateurs/v1/consulter/compte');
    expect(routes.userConnectionsUrl()).toBe('https://sandbox-api.piste.gouv.fr/cpro/utilisateurs/v1/monCompte/recuperer/rattachements');
  });

  it('preserves absolute urls for user apis and detects qualification-only endpoints', () => {
    const routes = new PisteChorusRoutes({
      ...getDefaultChorusConfig(),
      apiBaseUrl: 'https://sandbox-api.piste.gouv.fr/cpro/factures',
      userAccountPath: 'https://chorus-pro.gouv.fr:5443/service-qualif/utilisateurs/consulter/compte',
      userConnectionsPath: 'https://chorus-pro.gouv.fr:5443/service-qualif/utilisateurs/monCompte/recuperer/rattachements',
    });

    expect(routes.userAccountUrl()).toBe('https://chorus-pro.gouv.fr:5443/service-qualif/utilisateurs/consulter/compte');
    expect(routes.userConnectionsUrl()).toBe('https://chorus-pro.gouv.fr:5443/service-qualif/utilisateurs/monCompte/recuperer/rattachements');
    expect(routes.usesQualificationUserApis()).toBe(true);
  });
});

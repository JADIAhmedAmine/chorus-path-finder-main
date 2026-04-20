import { describe, expect, it } from 'vitest';
import { parseChorusAnnuaireXml } from '@/lib/references/annuaire';

describe('parseChorusAnnuaireXml', () => {
  it('maps structures and services into public customers and public services', () => {
    const catalog = parseChorusAnnuaireXml(`
      <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <CPPStructuresPartenaires>
        <CPPStructurePartenaireUnitaire>
          <TypeIdentifiant>SIRET</TypeIdentifiant>
          <Identifiant>23440003400026</Identifiant>
          <RaisonSociale>REGION DES PAYS DE LA LOIRE - SI EPLE</RaisonSociale>
          <Services>
            <Service>
              <Code>FACTURES_PUBLIQUES</Code>
              <Nom>Service des factures publiques</Nom>
              <ServiceActif>true</ServiceActif>
            </Service>
            <Service>
              <Code>SE_COMPTA</Code>
              <Nom>Comptabilite fournisseurs</Nom>
              <ServiceActif>true</ServiceActif>
            </Service>
          </Services>
          <GestionEngagement>true</GestionEngagement>
          <GestionService>true</GestionService>
          <StructureActive>true</StructureActive>
        </CPPStructurePartenaireUnitaire>
      </CPPStructuresPartenaires>
    `);

    expect(catalog.publicCustomers).toHaveLength(1);
    expect(catalog.publicCustomers[0]).toMatchObject({
      codeDestinataire: '23440003400026',
      legalName: 'REGION DES PAYS DE LA LOIRE - SI EPLE',
      siret: '23440003400026',
      active: true,
    });

    expect(catalog.publicServices).toHaveLength(2);
    expect(catalog.publicServices[0]?.publicCustomerId).toBe('annuaire-23440003400026');
    expect(catalog.publicServices[1]).toMatchObject({
      codeServiceExecutant: 'SE_COMPTA',
      label: 'Comptabilite fournisseurs',
      engagementRequired: true,
      active: true,
    });
  });
});

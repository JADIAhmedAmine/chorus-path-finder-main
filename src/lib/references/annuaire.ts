import type { PublicCustomer, PublicService } from '@/types';

export interface ChorusAnnuaireCatalog {
  publicCustomers: PublicCustomer[];
  publicServices: PublicService[];
  structureCount: number;
  serviceCount: number;
}

const ANNuaire_TENANT_ID = 'chorus-annuaire';
const ANNuaire_TIMESTAMP = new Date(0).toISOString();

function getDirectChild(parent: Element, tagName: string): Element | null {
  return Array.from(parent.children).find((child) => child.tagName === tagName) ?? null;
}

function getDirectChildText(parent: Element, tagName: string): string {
  return getDirectChild(parent, tagName)?.textContent?.trim() ?? '';
}

function getBooleanText(parent: Element, tagName: string, fallback = false): boolean {
  const text = getDirectChildText(parent, tagName).toLowerCase();
  if (!text) {
    return fallback;
  }

  return text === 'true' || text === '1' || text === 'oui';
}

function normalizeIdentifier(value: string): string {
  return value.trim();
}

function deriveStructureType(structureNode: Element): string {
  if (getBooleanText(structureNode, 'EstMOAUniquement')) {
    return 'MOA';
  }

  if (getBooleanText(structureNode, 'EstMOA')) {
    return 'MOA';
  }

  if (getBooleanText(structureNode, 'GestionService')) {
    return 'SERVICE';
  }

  return 'PUBLIC';
}

function deriveSiret(typeIdentifiant: string, identifiant: string): string {
  const digits = identifiant.replace(/\D/g, '');
  if (digits.length === 14) {
    return digits;
  }

  if (typeIdentifiant === 'SIRET' && digits.length > 0) {
    return digits;
  }

  return '';
}

export function parseChorusAnnuaireXml(xmlContent: string): ChorusAnnuaireCatalog {
  if (typeof DOMParser === 'undefined') {
    throw new Error('DOMParser indisponible dans cet environnement.');
  }

  const parser = new DOMParser();
  const document = parser.parseFromString(xmlContent.trim(), 'application/xml');
  const parserError = document.querySelector('parsererror');

  if (parserError) {
    throw new Error('Le fichier annuaire Chorus XML est invalide.');
  }

  const customersById = new Map<string, PublicCustomer>();
  const servicesById = new Map<string, PublicService>();
  const structureNodes = Array.from(document.getElementsByTagName('CPPStructurePartenaireUnitaire'));
  let serviceCount = 0;

  for (const structureNode of structureNodes) {
    const identifiant = normalizeIdentifier(getDirectChildText(structureNode, 'Identifiant'));
    if (!identifiant) {
      continue;
    }

    const typeIdentifiant = normalizeIdentifier(getDirectChildText(structureNode, 'TypeIdentifiant'));
    const customerId = `annuaire-${identifiant}`;

    customersById.set(customerId, {
      id: customerId,
      tenantId: ANNuaire_TENANT_ID,
      codeDestinataire: identifiant,
      legalName: getDirectChildText(structureNode, 'RaisonSociale') || identifiant,
      siret: deriveSiret(typeIdentifiant, identifiant),
      structureType: deriveStructureType(structureNode),
      active: getBooleanText(structureNode, 'StructureActive', true),
      createdAt: ANNuaire_TIMESTAMP,
      updatedAt: ANNuaire_TIMESTAMP,
    });

    const servicesContainer = getDirectChild(structureNode, 'Services');
    if (!servicesContainer) {
      continue;
    }

    const serviceNodes = Array.from(servicesContainer.children).filter((child) => child.tagName === 'Service');

    for (const serviceNode of serviceNodes) {
      const codeServiceExecutant = normalizeIdentifier(getDirectChildText(serviceNode, 'Code'));
      if (!codeServiceExecutant) {
        continue;
      }

      serviceCount += 1;
      const serviceId = `${customerId}::${codeServiceExecutant}`;
      servicesById.set(serviceId, {
        id: serviceId,
        tenantId: ANNuaire_TENANT_ID,
        publicCustomerId: customerId,
        codeServiceExecutant,
        label: getDirectChildText(serviceNode, 'Nom') || codeServiceExecutant,
        engagementRequired: getBooleanText(structureNode, 'GestionEngagement') || getBooleanText(structureNode, 'GestionServiceEngagement'),
        purchaseOrderRequired: false,
        active: getBooleanText(serviceNode, 'ServiceActif', true),
        createdAt: ANNuaire_TIMESTAMP,
        updatedAt: ANNuaire_TIMESTAMP,
      });
    }
  }

  return {
    publicCustomers: [...customersById.values()],
    publicServices: [...servicesById.values()],
    structureCount: structureNodes.length,
    serviceCount,
  };
}

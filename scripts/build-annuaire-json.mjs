import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function decodeXml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractFirst(block, tagName) {
  const match = block.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`));
  return match ? decodeXml(match[1].trim()) : '';
}

function extractAll(block, tagName) {
  return [...block.matchAll(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'g'))].map((match) => decodeXml(match[1].trim()));
}

function asBoolean(value, fallback = false) {
  if (!value) {
    return fallback;
  }

  return ['true', '1', 'oui'].includes(value.toLowerCase());
}

function deriveStructureType(structureBlock) {
  if (asBoolean(extractFirst(structureBlock, 'EstMOAUniquement'))) {
    return 'MOA';
  }

  if (asBoolean(extractFirst(structureBlock, 'EstMOA'))) {
    return 'MOA';
  }

  if (asBoolean(extractFirst(structureBlock, 'GestionService'))) {
    return 'SERVICE';
  }

  return 'PUBLIC';
}

function deriveSiret(typeIdentifiant, identifiant) {
  const digits = identifiant.replace(/\D/g, '');
  if (digits.length === 14) {
    return digits;
  }

  if (typeIdentifiant === 'SIRET' && digits.length > 0) {
    return digits;
  }

  return '';
}

async function main() {
  const inputPath = process.argv[2] ?? 'src/data/annuaire_out/FAR0037A_SEC001_CPP0010037000000000007495';
  const outputPath = process.argv[3] ?? 'public/annuaire/annuaire.normalized.json';
  const absoluteInputPath = path.resolve(process.cwd(), inputPath);
  const absoluteOutputPath = path.resolve(process.cwd(), outputPath);
  const publicXmlOutputPath = path.resolve(process.cwd(), 'public/annuaire', path.basename(inputPath));

  const xmlContent = await readFile(absoluteInputPath, 'utf8');
  const structureBlocks = [...xmlContent.matchAll(/<CPPStructurePartenaireUnitaire>([\s\S]*?)<\/CPPStructurePartenaireUnitaire>/g)].map((match) => match[1]);

  const publicCustomers = [];
  const publicServices = [];
  let serviceCount = 0;

  for (const structureBlock of structureBlocks) {
    const typeIdentifiant = extractFirst(structureBlock, 'TypeIdentifiant');
    const identifiant = extractFirst(structureBlock, 'Identifiant');

    if (!identifiant) {
      continue;
    }

    const customerId = `annuaire-${identifiant}`;
    publicCustomers.push({
      id: customerId,
      tenantId: 'chorus-annuaire',
      codeDestinataire: identifiant,
      legalName: extractFirst(structureBlock, 'RaisonSociale') || identifiant,
      siret: deriveSiret(typeIdentifiant, identifiant),
      structureType: deriveStructureType(structureBlock),
      active: asBoolean(extractFirst(structureBlock, 'StructureActive'), true),
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    });

    const servicesSection = extractFirst(structureBlock, 'Services');
    const serviceBlocks = [...servicesSection.matchAll(/<Service>([\s\S]*?)<\/Service>/g)].map((match) => match[1]);

    for (const serviceBlock of serviceBlocks) {
      const codeServiceExecutant = extractFirst(serviceBlock, 'Code');
      if (!codeServiceExecutant) {
        continue;
      }

      serviceCount += 1;
      publicServices.push({
        id: `${customerId}::${codeServiceExecutant}`,
        tenantId: 'chorus-annuaire',
        publicCustomerId: customerId,
        codeServiceExecutant,
        label: extractFirst(serviceBlock, 'Nom') || codeServiceExecutant,
        engagementRequired: asBoolean(extractFirst(structureBlock, 'GestionEngagement')) || asBoolean(extractFirst(structureBlock, 'GestionServiceEngagement')),
        purchaseOrderRequired: false,
        active: asBoolean(extractFirst(serviceBlock, 'ServiceActif'), true),
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      });
    }
  }

  const payload = {
    metadata: {
      generatedAt: new Date().toISOString(),
      sourceFile: inputPath,
      structureCount: structureBlocks.length,
      serviceCount,
      format: 'json',
    },
    publicCustomers,
    publicServices,
  };

  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await mkdir(path.dirname(publicXmlOutputPath), { recursive: true });
  await writeFile(absoluteOutputPath, JSON.stringify(payload), 'utf8');
  await copyFile(absoluteInputPath, publicXmlOutputPath);

  console.log(`Annuaire JSON généré : ${outputPath}`);
  console.log(`Annuaire XML copié : ${path.relative(process.cwd(), publicXmlOutputPath)}`);
  console.log(`Structures: ${payload.metadata.structureCount}`);
  console.log(`Services: ${payload.metadata.serviceCount}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

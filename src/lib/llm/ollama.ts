import { canUseLlmExtraction, loadLlmConfig, resolveLlmRuntimeConfig } from '@/lib/llm/config';
import { requestLlmCompletion } from '@/lib/llm/client';
import type {
  ChorusPaymentMode,
  ExtractedInvoiceDraftData,
  ExtractedInvoiceLineItemData,
  ExtractedInvoiceVatLineData,
  InvoiceSourceFormat,
} from '@/lib/chorus/types';

interface OllamaExtractionPromptContext {
  evidenceText?: string;
  referenceHints?: string;
}

const CHORUS_TVA_CODE_TO_RATE: Record<string, number> = {
  TVA20: 1.05,
  TVA7: 2.1,
  TV20: 5,
  TVA8: 5.5,
  TVA9: 7,
  TVA4: 8.5,
  TV10: 10,
  TV11: 13,
  TV21: 16,
  TVA5: 19.6,
  TV12: 20,
  TV13: 20.6,
};

function isTestRuntime(): boolean {
  const runtime = globalThis as typeof globalThis & {
    process?: {
      env?: Record<string, string | undefined>;
    };
  };

  return runtime.process?.env?.VITEST === 'true' || runtime.process?.env?.NODE_ENV === 'test';
}

function extractJsonObject(value: string): string | undefined {
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');

  if (start < 0 || end < start) {
    return undefined;
  }

  return value.slice(start, end + 1);
}

function normalizeDate(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const cleaned = value.trim().replace(/\./g, '/').replace(/-/g, '/');
  const isoMatch = cleaned.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const frMatch = cleaned.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (frMatch) {
    return `${frMatch[3]}-${frMatch[2]}-${frMatch[1]}`;
  }

  return undefined;
}

function normalizeAmount(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const cleaned = value
    .trim()
    .replace(/\s/g, '')
    .replace(/['’]/g, '')
    .replace(/[A-Za-z€$£]/g, '');

  if (!cleaned) {
    return undefined;
  }

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  let normalized = cleaned;
  if (lastComma > lastDot) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma && lastComma >= 0) {
    normalized = cleaned.replace(/,/g, '');
  } else if (lastComma >= 0) {
    normalized = cleaned.replace(',', '.');
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeVatRate(value: unknown): number | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim().toUpperCase();

    const directCodeRate = CHORUS_TVA_CODE_TO_RATE[trimmed];
    if (directCodeRate !== undefined) {
      return directCodeRate;
    }

    const codeMatch = trimmed.match(/\b(TVA?\d+|TV\d+)\b/);
    if (codeMatch) {
      const codeRate = CHORUS_TVA_CODE_TO_RATE[codeMatch[1]];
      if (codeRate !== undefined) {
        return codeRate;
      }
    }

    const percentMatch = trimmed.match(/(\d+(?:[.,]\d+)?)\s*%/);
    if (percentMatch) {
      return normalizeAmount(percentMatch[1]);
    }
  }

  const amount = normalizeAmount(value);
  if (amount === undefined) {
    return undefined;
  }

  if (amount > 0 && amount <= 1) {
    return roundMoney(amount * 100);
  }

  return amount;
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeSiret(value: unknown): string | undefined {
  const digits = normalizeString(value)?.replace(/\D/g, '') ?? '';
  return digits.length === 14 ? digits : undefined;
}

function normalizePaymentMode(value: unknown): ChorusPaymentMode | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const upperValue = trimmed.toUpperCase() as ChorusPaymentMode;
  if (['CHEQUE', 'ESPECE', 'VIREMENT', 'PRELEVEMENT', 'AUTRE', 'REPORT'].includes(upperValue)) {
    return upperValue;
  }

  const normalized = trimmed
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (/(virement|transfer|wire|sepa)/.test(normalized)) {
    return 'VIREMENT';
  }

  if (/(cheque|cheque bancaire|check)/.test(normalized)) {
    return 'CHEQUE';
  }

  if (/(prelevement|direct debit|sepa debit)/.test(normalized)) {
    return 'PRELEVEMENT';
  }

  if (/(espece|cash)/.test(normalized)) {
    return 'ESPECE';
  }

  if (/report/.test(normalized)) {
    return 'REPORT';
  }

  if (/(autre|other)/.test(normalized)) {
    return 'AUTRE';
  }

  return undefined;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return true;
}

function buildPromptDocumentText(text: string): string {
  const structuredLines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const structuredText = structuredLines.join('\n');

  if (!structuredText) {
    return structuredText;
  }

  if (structuredText.length <= 42000) {
    return structuredText;
  }

  const totalLines = structuredLines.length;
  const sliceSize = Math.max(80, Math.floor(totalLines / 4));
  const middleStart = Math.max(sliceSize, Math.floor(totalLines / 2) - Math.floor(sliceSize / 2));
  const head = structuredLines.slice(0, sliceSize).join('\n');
  const middle = structuredLines.slice(middleStart, middleStart + sliceSize).join('\n');
  const tail = structuredLines.slice(-sliceSize).join('\n');

  return [
    '[DEBUT_DOCUMENT]',
    head,
    '[MILIEU_DOCUMENT]',
    middle,
    '[FIN_DOCUMENT]',
    tail,
  ].join('\n');
}

const OLLAMA_EXTRACTION_FIELDS = [
  'supplierOrganizationId',
  'supplierName',
  'supplierInvoiceNumber',
  'paymentMode',
  'supplierSiret',
  'supplierVatNumber',
  'publicCustomerId',
  'publicCustomerName',
  'publicCustomerSiret',
  'publicCustomerCode',
  'publicServiceId',
  'publicServiceLabel',
  'publicServiceCode',
  'engagementNumber',
  'marketNumber',
  'purchaseOrderNumber',
  'customerReference',
  'invoiceDate',
  'dueDate',
  'currencyCode',
  'totalAmountHt',
  'totalVat',
  'totalAmountTtc',
  'lineItems',
  'vatLines',
] as const;

const OLLAMA_EXTRACTION_EXAMPLE: ExtractedInvoiceDraftData = {
  supplierName: 'GIP Gigalis',
  supplierInvoiceNumber: '2026-003-00565',
  paymentMode: 'CHEQUE',
  supplierSiret: '25440253000011',
  supplierVatNumber: 'FR59254402530',
  publicCustomerName: 'REGION DES PAYS DE LA LOIRE - SI EPLE',
  publicCustomerSiret: '23440003400026',
  publicServiceLabel: 'Comptabilite fournisseurs',
  engagementNumber: 'BC2025/25-007915',
  customerReference: '1903',
  invoiceDate: '2026-03-16',
  dueDate: '2026-04-15',
  currencyCode: 'EUR',
  totalAmountHt: 45903.52,
  totalVat: 9180.7,
  totalAmountTtc: 55084.22,
  lineItems: [
    {
      description: 'INF - Accessoires reseaux type 1 Module SFP 1G Base-T',
      quantity: 15,
      unitPriceHt: 38.44,
      totalHt: 576.6,
      vatRate: 20,
    },
  ],
  vatLines: [
    {
      rate: 20,
      baseHt: 45903.52,
      taxAmount: 9180.7,
    },
  ],
};

function parseLineItems(value: unknown): ExtractedInvoiceLineItemData[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value
    .map((item): ExtractedInvoiceLineItemData | null => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const record = item as Record<string, unknown>;
      const description = normalizeString(record.description ?? record.designation ?? record.lignePosteDenomination);
      const reference = normalizeString(record.reference ?? record.lignePosteReference);
      const quantity = normalizeAmount(record.quantity ?? record.quantite ?? record.lignePosteQuantite);
      const unit = normalizeString(record.unit ?? record.unite ?? record.lignePosteUnite);
      const unitPriceHt = normalizeAmount(record.unitPriceHt ?? record.prixUnitaireHt ?? record.lignePosteMontantUnitaireHT);
      const discountHt = normalizeAmount(record.discountHt ?? record.remiseHt ?? record.lignePosteMontantRemiseHT);
      const totalHt = normalizeAmount(record.totalHt ?? record.montantHt ?? record.lineTotalHt);
      const vatRate = normalizeVatRate(
        record.vatRate ??
          record.tauxTva ??
          record.tauxTVA ??
          record.lignePosteTauxTvaManuel ??
          record.lignePosteTauxTva,
      );

      if (!description && unitPriceHt === undefined && totalHt === undefined) {
        return null;
      }

      return {
        description,
        reference,
        quantity,
        unit,
        unitPriceHt,
        discountHt,
        totalHt,
        vatRate,
      };
    })
    .filter((item): item is ExtractedInvoiceLineItemData => item !== null);

  return items.length > 0 ? items : undefined;
}

function parseVatLines(value: unknown): ExtractedInvoiceVatLineData[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value
    .map((item): ExtractedInvoiceVatLineData | null => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const record = item as Record<string, unknown>;
      const rate = normalizeVatRate(
        record.rate ??
          record.tauxTva ??
          record.tauxTVA ??
          record.ligneTvaTauxManuel ??
          record.ligneTvaTaux,
      );
      const baseHt = normalizeAmount(record.baseHt ?? record.baseMontantHt ?? record.ligneTvaMontantBaseHtParTaux);
      const taxAmount = normalizeAmount(record.taxAmount ?? record.montantTva ?? record.ligneTvaMontantTvaParTaux);

      if (baseHt === undefined && taxAmount === undefined) {
        return null;
      }

      return {
        rate,
        baseHt,
        taxAmount,
      };
    })
    .filter((item): item is ExtractedInvoiceVatLineData => item !== null);

  return items.length > 0 ? items : undefined;
}

function parseLlmExtraction(content: string): ExtractedInvoiceDraftData | null {
  const jsonPayload = extractJsonObject(content);
  if (!jsonPayload) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonPayload) as Record<string, unknown>;

    return {
      supplierOrganizationId: normalizeString(parsed.supplierOrganizationId),
      supplierInvoiceNumber: normalizeString(parsed.supplierInvoiceNumber),
      supplierName: normalizeString(parsed.supplierName),
      paymentMode: normalizePaymentMode(parsed.paymentMode ?? parsed.modePaiement ?? parsed.modeReglement),
      publicCustomerId: normalizeString(parsed.publicCustomerId),
      supplierSiret: normalizeSiret(parsed.supplierSiret),
      supplierVatNumber: normalizeString(parsed.supplierVatNumber)?.toUpperCase(),
      publicCustomerName: normalizeString(parsed.publicCustomerName),
      publicCustomerSiret: normalizeSiret(parsed.publicCustomerSiret),
      publicCustomerCode: normalizeString(parsed.publicCustomerCode ?? parsed.codeDestinataire),
      publicServiceId: normalizeString(parsed.publicServiceId),
      publicServiceLabel: normalizeString(parsed.publicServiceLabel),
      publicServiceCode: normalizeString(parsed.publicServiceCode),
      engagementNumber: normalizeString(parsed.engagementNumber),
      marketNumber: normalizeString(parsed.marketNumber),
      purchaseOrderNumber: normalizeString(parsed.purchaseOrderNumber),
      invoiceDate: normalizeDate(parsed.invoiceDate),
      dueDate: normalizeDate(parsed.dueDate),
      currencyCode: normalizeString(parsed.currencyCode)?.toUpperCase(),
      customerReference: normalizeString(parsed.customerReference),
      totalAmountHt: normalizeAmount(parsed.totalAmountHt),
      totalVat: normalizeAmount(parsed.totalVat),
      totalAmountTtc: normalizeAmount(parsed.totalAmountTtc),
      lineItems: parseLineItems(parsed.lineItems ?? parsed.lines ?? parsed.lignePoste),
      vatLines: parseVatLines(parsed.vatLines ?? parsed.taxLines ?? parsed.ligneTva),
    };
  } catch {
    return null;
  }
}

function mergeExtractedData(
  heuristicFields: ExtractedInvoiceDraftData,
  llmFields: ExtractedInvoiceDraftData | null,
): ExtractedInvoiceDraftData {
  if (!llmFields) {
    return heuristicFields;
  }

  const merged: ExtractedInvoiceDraftData = { ...heuristicFields };

  const protectedFields: Array<keyof ExtractedInvoiceDraftData> = [
    'supplierInvoiceNumber',
    'invoiceDate',
    'totalAmountHt',
    'totalVat',
    'totalAmountTtc',
    'supplierSiret',
    'supplierVatNumber',
    'publicCustomerSiret',
    'publicCustomerCode',
  ];

  for (const [key, value] of Object.entries(llmFields) as [keyof ExtractedInvoiceDraftData, unknown][]) {
    if (!isPresent(value)) {
      continue;
    }

    const currentValue = merged[key];

    if (protectedFields.includes(key) && isPresent(currentValue)) {
      continue;
    }

    if ((key === 'lineItems' || key === 'vatLines') && isPresent(currentValue)) {
      continue;
    }

    (merged as Record<string, unknown>)[key] = value;
  }

  return merged;
}

function validateAndRepairTotals(data: ExtractedInvoiceDraftData): ExtractedInvoiceDraftData {
  const totalHt = data.totalAmountHt;
  const totalVat = data.totalVat;
  const totalTtc = data.totalAmountTtc;

  if (
    typeof totalHt === 'number' &&
    typeof totalVat === 'number' &&
    totalTtc === undefined
  ) {
    return {
      ...data,
      totalAmountTtc: roundMoney(totalHt + totalVat),
    };
  }

  if (
    typeof totalHt === 'number' &&
    typeof totalTtc === 'number' &&
    totalVat === undefined
  ) {
    return {
      ...data,
      totalVat: roundMoney(totalTtc - totalHt),
    };
  }

  if (
    typeof totalVat === 'number' &&
    typeof totalTtc === 'number' &&
    totalHt === undefined
  ) {
    return {
      ...data,
      totalAmountHt: roundMoney(totalTtc - totalVat),
    };
  }

  if (
    typeof totalHt === 'number' &&
    typeof totalVat === 'number' &&
    typeof totalTtc === 'number'
  ) {
    const expectedTtc = roundMoney(totalHt + totalVat);
    const diff = Math.abs(expectedTtc - totalTtc);

    if (diff > 0.05 && totalTtc > totalVat) {
      return {
        ...data,
        totalAmountHt: roundMoney(totalTtc - totalVat),
      };
    }

    if (diff > 0 && diff <= 0.05) {
      return {
        ...data,
        totalAmountTtc: expectedTtc,
      };
    }
  }

  return data;
}

export async function extractInvoiceDataWithLlm(
  text: string,
  sourceFormat: InvoiceSourceFormat,
  fileName: string,
  heuristicFields: ExtractedInvoiceDraftData,
  promptContext: OllamaExtractionPromptContext = {},
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<ExtractedInvoiceDraftData> {
  const config = resolveLlmRuntimeConfig(loadLlmConfig());

  if (isTestRuntime() || !canUseLlmExtraction(config) || !text.trim()) {
    return validateAndRepairTotals(heuristicFields);
  }

  const prompt = [
    'Tu es un expert en traitement de factures françaises pour Chorus Pro.',
    'Ta mission est d extraire les donnees d une facture en un JSON metier exploitable par le code applicatif.',
    '',
    'Regles STRICTES :',
    '- Reponds UNIQUEMENT en JSON brut',
    '- Aucun texte, aucun commentaire, aucun markdown',
    '- N invente aucune donnee',
    '- Si une donnee est absente, omets le champ',
    '- Si plusieurs modalites de paiement generiques sont listees, ne renseigne paymentMode que si la facture indique explicitement celui qui est payable ou a utiliser',
    '',
    'Objectif :',
    'Retourner les champs utiles a une soumission Chorus minimale, plus eventuellement des lignes de facture et des lignes TVA.',
    '',
    'Champs attendus :',
    '- supplierOrganizationId (seulement si un indice de reference candidat le rend certain)',
    '- supplierName',
    '- supplierInvoiceNumber',
    '- paymentMode (CHEQUE, ESPECE, VIREMENT, PRELEVEMENT, AUTRE ou REPORT)',
    '- publicCustomerId (seulement si un indice de reference candidat le rend certain)',
    '- supplierSiret',
    '- supplierVatNumber',
    '- publicCustomerName',
    '- publicCustomerSiret',
    '- publicCustomerCode',
    '- publicServiceId (optionnel, seulement si un indice de reference candidat le rend certain)',
    '- publicServiceLabel (optionnel, seulement si present explicitement)',
    '- publicServiceCode (optionnel, seulement si present explicitement)',
    '- engagementNumber',
    '- marketNumber (optionnel, ne jamais l inventer)',
    '- purchaseOrderNumber',
    '- customerReference',
    '- invoiceDate',
    '- dueDate',
    '- currencyCode',
    '- totalAmountHt',
    '- totalVat',
    '- totalAmountTtc',
    '- optionnel: lineItems[]',
    '- optionnel: vatLines[]',
    '',
    'Format des dates : YYYY-MM-DD',
    'Format des montants : nombres decimaux avec point',
    'Format SIRET : exactement 14 chiffres, chiffres uniquement. Si la valeur contient des lettres ou n a pas 14 chiffres, omets supplierSiret/publicCustomerSiret.',
    'Format TVA : toujours retourner le taux en pourcentage numerique. Exemple : 20% -> 20, 10% -> 10, 5,5% -> 5.5. Ne jamais retourner 0.2 pour 20%.',
    '',
    'Format des lineItems :',
    '{ description, reference, quantity, unit, unitPriceHt, discountHt, totalHt, vatRate }',
    '',
    'Format des vatLines :',
    '{ rate, baseHt, taxAmount }',
    '',
    'Champs autorises, sans aucun autre nom de champ :',
    OLLAMA_EXTRACTION_FIELDS.join(', '),
    '',
    'Exemple de sortie attendue. Ne copie pas ces valeurs si elles ne sont pas presentes dans le document :',
    JSON.stringify(OLLAMA_EXTRACTION_EXAMPLE, null, 2),
    '',
    'Points d attention pour les factures Docling/Markdown :',
    '- publicServiceLabel correspond au service destinataire ou service executant seulement si ce champ est explicitement visible',
    '- Les tableaux Markdown peuvent contenir Total HT, NET A PAYER, TVA et les lignes de facture',
    '- Si totalVat est absent mais totalAmountHt et totalAmountTtc sont presents, calcule totalVat = totalAmountTtc - totalAmountHt',
    '- Si le document contient un bloc Total HT / TVA xx% / Total TTC, ce bloc est prioritaire: totalAmountHt doit toujours valoir totalAmountTtc - totalVat',
    '- Ne jamais utiliser le taux TVA 20% comme montant. Dans "TVA 20% : 4 400,00", totalVat vaut 4400.00, pas 20 ni 200.',
    '- Si le numero client apparait dans ID CLIENT ou Client [1903], renseigne customerReference',
    '',
    'Regles de fiabilite :',
    '- Ne jamais transformer un code TVA Chorus comme TV12 en taux 12. TV12 correspond a TVA 20%.',
    '- Si un montant est ambigu entre HT et TTC, ne le renseigne pas sauf si le libelle est clair.',
    '- Si plusieurs numeros ressemblent a un numero de facture, choisir celui proche des libelles Facture, Invoice, Numero facture, N facture.',
    '- Ne pas confondre numero client, numero engagement, numero bon de commande et numero de facture.',
    '- Les SIRET ont 14 chiffres. Ne pas inventer de SIRET incomplet.',
    '- Ne jamais mettre une chaine comme TEST, N/A, inconnu ou un nom de service dans supplierSiret ou publicCustomerSiret.',
    '- Pour les lignes de facture, extraire uniquement les lignes de prestation ou produit, pas les lignes Total, TVA, Net a payer.',
    '',
    'Priorites de decision :',
    '1. Extraire numero de facture, date, client public, montants, devise, mode de paiement',
    '2. Utiliser les indices de references seulement si le match est clair',
    '3. Mieux vaut omettre un champ que l inventer',
    '',
    `Nom du fichier: ${fileName}`,
    `Format source: ${sourceFormat}`,
    promptContext.referenceHints ? `Indices de references candidates:\n${promptContext.referenceHints}` : undefined,
    promptContext.evidenceText ? `Extraits cibles:\n${promptContext.evidenceText}` : undefined,
    'Texte facture:',
    buildPromptDocumentText(text),
  ].filter(Boolean).join('\n');

  const content = await requestLlmCompletion(config, prompt, fetchImpl);
  const llmFields = content ? parseLlmExtraction(content) : null;

  return validateAndRepairTotals(mergeExtractedData(heuristicFields, llmFields));
}

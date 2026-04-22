import { canUseLlmExtraction, loadLlmConfig, resolveLlmRuntimeConfig } from '@/lib/llm/config';
import type {
  ChorusPaymentMode,
  ExtractedInvoiceDraftData,
  ExtractedInvoiceLineItemData,
  ExtractedInvoiceVatLineData,
  InvoiceSourceFormat,
} from '@/lib/chorus/types';

interface OllamaChatResponse {
  message?: {
    content?: string;
  };
}

interface OllamaExtractionPromptContext {
  evidenceText?: string;
  referenceHints?: string;
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

  const cleaned = value.trim().replace(/\s/g, '').replace(/['’]/g, '').replace(/[A-Za-z€$£]/g, '');
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

function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
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
      const vatRate = normalizeAmount(record.vatRate ?? record.tauxTva ?? record.lignePosteTauxTva ?? record.lignePosteTauxTvaManuel);

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
      const rate = normalizeAmount(record.rate ?? record.tauxTva ?? record.ligneTvaTaux ?? record.ligneTvaTauxManuel);
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
      supplierSiret: normalizeString(parsed.supplierSiret)?.replace(/\D/g, ''),
      supplierVatNumber: normalizeString(parsed.supplierVatNumber)?.toUpperCase(),
      publicCustomerName: normalizeString(parsed.publicCustomerName),
      publicCustomerSiret: normalizeString(parsed.publicCustomerSiret)?.replace(/\D/g, ''),
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

  return {
    ...heuristicFields,
    ...Object.fromEntries(
      Object.entries(llmFields).filter(([, value]) => value !== undefined && value !== null && value !== ''),
    ),
  };
}

export async function extractInvoiceDataWithOllama(
  text: string,
  sourceFormat: InvoiceSourceFormat,
  fileName: string,
  heuristicFields: ExtractedInvoiceDraftData,
  promptContext: OllamaExtractionPromptContext = {},
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<ExtractedInvoiceDraftData> {
  const config = resolveLlmRuntimeConfig(loadLlmConfig());

  if (!canUseLlmExtraction(config) || !text.trim()) {
    return heuristicFields;
  }

  const prompt = [
    "Tu es un expert en traitement de factures françaises pour Chorus Pro.",
    "Ta mission est d extraire les donnees d une facture en un JSON metier exploitable par le code applicatif.",
    "",
    "Regles STRICTES :",
    "- Reponds UNIQUEMENT en JSON brut",
    "- Aucun texte, aucun commentaire, aucun markdown",
    "- N invente aucune donnee",
    "- Si une donnee est absente, omets le champ",
    "- Si plusieurs modalites de paiement generiques sont listees, ne renseigne paymentMode que si la facture indique explicitement celui qui est payable ou a utiliser",
    "",
    "Objectif :",
    "Retourner les champs utiles a une soumission Chorus minimale, plus eventuellement des lignes de facture et des lignes TVA.",
    "",
    "Champs attendus :",
    "- supplierOrganizationId (seulement si un indice de reference candidat le rend certain)",
    "- supplierName",
    "- supplierInvoiceNumber",
    "- paymentMode (CHEQUE, ESPECE, VIREMENT, PRELEVEMENT, AUTRE ou REPORT)",
    "- publicCustomerId (seulement si un indice de reference candidat le rend certain)",
    "- supplierSiret",
    "- supplierVatNumber",
    "- publicCustomerName",
    "- publicCustomerSiret",
    "- publicCustomerCode",
    "- publicServiceId (seulement si un indice de reference candidat le rend certain)",
    "- publicServiceLabel",
    "- publicServiceCode",
    "- engagementNumber",
    "- marketNumber",
    "- purchaseOrderNumber",
    "- customerReference",
    "- invoiceDate",
    "- dueDate",
    "- currencyCode",
    "- totalAmountHt",
    "- totalVat",
    "- totalAmountTtc",
    "- optionnel: lineItems[]",
    "- optionnel: vatLines[]",
    "",
    "Format des dates : YYYY-MM-DD",
    "Format des montants : nombres decimaux avec point",
    "Format SIRET : chiffres uniquement",
    "Format TVA : 20% -> 20 ou 0.2 acceptes",
    "",
    "Format des lineItems :",
    "{ description, reference, quantity, unit, unitPriceHt, discountHt, totalHt, vatRate }",
    "",
    "Format des vatLines :",
    "{ rate, baseHt, taxAmount }",
    "",
    "Priorites de decision :",
    "1. Extraire numero de facture, date, client public, service, montants, devise, mode de paiement",
    "2. Utiliser les indices de references seulement si le match est clair",
    "3. Mieux vaut omettre un champ que l inventer",
    "",
    `Nom du fichier: ${fileName}`,
    `Format source: ${sourceFormat}`,
    promptContext.referenceHints ? `Indices de references candidates:\n${promptContext.referenceHints}` : undefined,
    promptContext.evidenceText ? `Extraits cibles:\n${promptContext.evidenceText}` : undefined,
    "Texte facture:",
    buildPromptDocumentText(text),
  ].filter(Boolean).join("\n");

  try {
    const response = await fetchImpl(`${config.baseUrl.replace(/\/+$/, '')}/api/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        stream: false,
        format: 'json',
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        options: {
          temperature: config.temperature,
          top_p: config.topP,
          num_predict: config.maxNewTokens,
        },
      }),
    });

    if (!response.ok) {
      return heuristicFields;
    }

    const payload = await response.json() as OllamaChatResponse;
    const llmFields = payload.message?.content ? parseLlmExtraction(payload.message.content) : null;

    return mergeExtractedData(heuristicFields, llmFields);
  } catch {
    return heuristicFields;
  }
}

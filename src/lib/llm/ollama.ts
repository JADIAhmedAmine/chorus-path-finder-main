import { canUseLlmExtraction, loadLlmConfig, resolveLlmRuntimeConfig } from '@/lib/llm/config';
import type {
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
      supplierInvoiceNumber: normalizeString(parsed.supplierInvoiceNumber),
      supplierName: normalizeString(parsed.supplierName),
      supplierSiret: normalizeString(parsed.supplierSiret)?.replace(/\D/g, ''),
      supplierVatNumber: normalizeString(parsed.supplierVatNumber)?.toUpperCase(),
      publicCustomerName: normalizeString(parsed.publicCustomerName),
      publicCustomerSiret: normalizeString(parsed.publicCustomerSiret)?.replace(/\D/g, ''),
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
    "",
    "Objectif :",
    "Retourner des champs de facture normalises, plus eventuellement des lignes de facture et des lignes TVA.",
    "",
    "Champs attendus :",
    "- supplierName",
    "- supplierInvoiceNumber",
    "- supplierSiret",
    "- supplierVatNumber",
    "- publicCustomerName",
    "- publicCustomerSiret",
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
    `Nom du fichier: ${fileName}`,
    "Texte facture:",
    text.slice(0, 20000),
  ].join("\n");

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

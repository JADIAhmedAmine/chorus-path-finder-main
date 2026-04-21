import type {
  ChorusSubmissionLineItem,
  ChorusSubmissionVatLine,
  ExtractedInvoiceLineItemData,
  ExtractedInvoiceVatLineData,
  NormalizedInvoiceDraftData,
} from '@/lib/chorus/types';

const DEFAULT_LINE_UNIT = 'UNITE';
const AMOUNT_EPSILON = 0.01;
const CHORUS_VAT_CODE_BY_RATE: Array<[number, string]> = [
  [0.0105, 'TVA20'],
  [0.021, 'TV7'],
  [0.05, 'TV20'],
  [0.055, 'TV8'],
  [0.07, 'TV9'],
  [0.085, 'TVA4'],
  [0.1, 'TV10'],
  [0.13, 'TV11'],
  [0.16, 'TV21'],
  [0.196, 'TVA5'],
  [0.2, 'TV12'],
  [0.206, 'TV13'],
];

function trimText(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function normalizeFrenchDateToIsoDate(value: string | undefined | null): string | undefined {
  const trimmed = trimText(value);
  if (!trimmed) {
    return undefined;
  }

  const normalized = trimmed.replace(/\./g, '/').replace(/-/g, '/');
  const isoMatch = normalized.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const frMatch = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (frMatch) {
    return `${frMatch[3]}-${frMatch[2]}-${frMatch[1]}`;
  }

  return undefined;
}

export function normalizeFrenchAmountToNumber(value: string | number | undefined | null): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  const trimmed = trimText(value);
  if (!trimmed) {
    return undefined;
  }

  const cleaned = trimmed
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

export function normalizeSiret(value: string | undefined | null): string | undefined {
  const cleaned = trimText(value)?.replace(/\D/g, '');
  return cleaned || undefined;
}

export function roundAmount(value: number | undefined, digits = 2): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }

  return Number(value.toFixed(digits));
}

export function normalizeVatRate(value: string | number | undefined | null): number | undefined {
  const numeric = normalizeFrenchAmountToNumber(value);
  if (numeric === undefined) {
    return undefined;
  }

  if (numeric > 1 + AMOUNT_EPSILON) {
    return roundAmount(numeric / 100, 4);
  }

  return roundAmount(numeric, 4);
}

export function formatVatRateForPayload(rate: number | undefined): string | undefined {
  if (rate === undefined) {
    return undefined;
  }

  const matchedVatCode = CHORUS_VAT_CODE_BY_RATE.find(([candidateRate]) => Math.abs(candidateRate - rate) <= 0.0001);
  if (matchedVatCode) {
    return matchedVatCode[1];
  }

  return rate.toString();
}

function buildSingleFallbackLineItem(normalized: NormalizedInvoiceDraftData): ChorusSubmissionLineItem {
  const fallbackUnitPrice = normalized.totalAmountHt ?? normalized.totalAmountTtc ?? 0;
  const computedRate = normalized.totalAmountHt && normalized.totalVat !== undefined && normalized.totalAmountHt > 0
    ? normalizeVatRate(normalized.totalVat / normalized.totalAmountHt)
    : undefined;

  return {
    lignePosteDenomination: normalized.supplierInvoiceNumber
      ? `Facture ${normalized.supplierInvoiceNumber}`
      : 'Ligne globale facture',
    lignePosteMontantRemiseHT: 0,
    lignePosteMontantUnitaireHT: roundAmount(fallbackUnitPrice) ?? 0,
    lignePosteNumero: 1,
    lignePosteQuantite: 1,
    lignePosteReference: normalized.customerReference || normalized.supplierInvoiceNumber,
    lignePosteTauxTva: formatVatRateForPayload(computedRate),
    lignePosteTauxTvaManuel: computedRate === undefined ? 0 : undefined,
    lignePosteUnite: DEFAULT_LINE_UNIT,
  };
}

export function normalizeSubmissionLineItems(
  lineItems: ExtractedInvoiceLineItemData[] | undefined,
  normalized: NormalizedInvoiceDraftData,
): ChorusSubmissionLineItem[] {
  const normalizedLines = (lineItems ?? [])
    .map((item, index): ChorusSubmissionLineItem | null => {
      const quantity = item.quantity && item.quantity > 0 ? item.quantity : 1;
      const totalHt = normalizeFrenchAmountToNumber(item.totalHt);
      const unitPriceHt = normalizeFrenchAmountToNumber(item.unitPriceHt)
        ?? (totalHt !== undefined ? totalHt / quantity : undefined);
      const vatRate = normalizeVatRate(item.vatRate);

      if (!item.description && unitPriceHt === undefined && totalHt === undefined) {
        return null;
      }

      return {
        lignePosteDenomination: trimText(item.description) || `Ligne ${index + 1}`,
        lignePosteMontantRemiseHT: roundAmount(normalizeFrenchAmountToNumber(item.discountHt) ?? 0),
        lignePosteMontantUnitaireHT: roundAmount(unitPriceHt) ?? 0,
        lignePosteNumero: index + 1,
        lignePosteQuantite: roundAmount(quantity, 4) ?? 1,
        lignePosteReference: trimText(item.reference),
        lignePosteTauxTva: formatVatRateForPayload(vatRate),
        lignePosteTauxTvaManuel: vatRate === undefined ? 0 : undefined,
        lignePosteUnite: trimText(item.unit) || DEFAULT_LINE_UNIT,
      };
    })
    .filter((item): item is ChorusSubmissionLineItem => item !== null);

  return normalizedLines.length > 0 ? normalizedLines : [buildSingleFallbackLineItem(normalized)];
}

export function normalizeSubmissionVatLines(
  vatLines: ExtractedInvoiceVatLineData[] | undefined,
  normalized: NormalizedInvoiceDraftData,
): ChorusSubmissionVatLine[] {
  const normalizedVatLines = (vatLines ?? [])
    .map((item): ChorusSubmissionVatLine | null => {
      const baseHt = roundAmount(normalizeFrenchAmountToNumber(item.baseHt));
      const taxAmount = roundAmount(normalizeFrenchAmountToNumber(item.taxAmount));
      const rate = normalizeVatRate(item.rate);

      if (baseHt === undefined && taxAmount === undefined) {
        return null;
      }

      return {
        ligneTvaMontantBaseHtParTaux: baseHt ?? 0,
        ligneTvaMontantTvaParTaux: taxAmount ?? 0,
        ligneTvaTaux: formatVatRateForPayload(rate),
        ligneTvaTauxManuel: rate === undefined ? 0 : undefined,
      };
    })
    .filter((item): item is ChorusSubmissionVatLine => item !== null);

  if (normalizedVatLines.length > 0) {
    return normalizedVatLines;
  }

  const totalVat = roundAmount(normalized.totalVat ?? 0) ?? 0;
  const totalHt = roundAmount(normalized.totalAmountHt ?? 0) ?? 0;
  if (totalVat <= 0 && totalHt <= 0) {
    return [];
  }

  const computedRate = totalHt > 0 && totalVat > 0
    ? normalizeVatRate(totalVat / totalHt)
    : undefined;

  return [{
    ligneTvaMontantBaseHtParTaux: totalHt,
    ligneTvaMontantTvaParTaux: totalVat,
    ligneTvaTaux: formatVatRateForPayload(computedRate),
    ligneTvaTauxManuel: computedRate === undefined ? 0 : undefined,
  }];
}

export function computeSubmissionTotals(
  normalized: NormalizedInvoiceDraftData,
  vatLines: ChorusSubmissionVatLine[],
): {
  montantHtTotal: number;
  montantTVA: number;
  montantTtcTotal: number;
  montantAPayer: number;
} {
  const montantHtTotal = roundAmount(normalized.totalAmountHt) ?? 0;
  const montantTVA = roundAmount(
    normalized.totalVat
      ?? vatLines.reduce((sum, line) => sum + line.ligneTvaMontantTvaParTaux, 0),
  ) ?? 0;
  const montantTtcTotal = roundAmount(normalized.totalAmountTtc ?? (montantHtTotal + montantTVA)) ?? 0;

  return {
    montantHtTotal,
    montantTVA,
    montantTtcTotal,
    montantAPayer: montantTtcTotal,
  };
}

export function inferChorusVatType(totalVat: number, motifExonerationTva?: string): 'TVA_SUR_ENCAISSEMENT' | 'EXONERATION' | 'SANS_TVA' {
  if (totalVat <= 0) {
    return motifExonerationTva ? 'EXONERATION' : 'SANS_TVA';
  }

  return 'TVA_SUR_ENCAISSEMENT';
}

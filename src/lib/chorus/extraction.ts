import type {
  ExtractedInvoiceDraftData,
  InvoiceExtractionReferences,
  InvoiceSourceFormat,
  LocalInvoiceExtractionResult,
} from '@/lib/chorus/types';
import { extractInvoiceDataWithOllama } from '@/lib/llm/ollama';

interface CandidateMatch<T> {
  value?: T;
  confidence?: number;
}

interface NamedReference {
  id: string;
  legalName: string;
  siret: string;
}

interface ServiceReference {
  id: string;
  publicCustomerId: string;
  codeServiceExecutant: string;
  label: string;
}

function compactWhitespace(value: string): string {
  return value
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLookup(value: string): string {
  return compactWhitespace(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function cleanDigits(value: string): string {
  return value.replace(/\D/g, '');
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function scoreReadableText(value: string): number {
  const compact = value.replace(/\s+/g, '');
  if (!compact) {
    return 0;
  }

  const readableChars = compact.match(/[A-Za-z0-9À-ÿ€.,:/_#-]/g)?.length ?? 0;
  return readableChars / compact.length;
}

function decodeOctalSequence(value: string): string {
  const parsed = Number.parseInt(value, 8);
  return Number.isFinite(parsed) ? String.fromCharCode(parsed) : '';
}

function decodePdfLiteralString(value: string): string {
  return value
    .replace(/\\([nrtbf()\\])/g, (_, escaped: string) => {
      switch (escaped) {
        case 'n':
          return '\n';
        case 'r':
          return '\r';
        case 't':
          return '\t';
        case 'b':
          return '\b';
        case 'f':
          return '\f';
        default:
          return escaped;
      }
    })
    .replace(/\\([0-7]{1,3})/g, (_, octal: string) => decodeOctalSequence(octal));
}

function extractPdfLiteralStrings(content: string): string[] {
  const values: string[] = [];
  let current = '';
  let depth = 0;
  let escaped = false;

  for (const character of content) {
    if (depth === 0) {
      if (character === '(') {
        depth = 1;
        current = '';
        escaped = false;
      }
      continue;
    }

    if (escaped) {
      current += `\\${character}`;
      escaped = false;
      continue;
    }

    if (character === '\\') {
      escaped = true;
      continue;
    }

    if (character === '(') {
      depth += 1;
      current += character;
      continue;
    }

    if (character === ')') {
      depth -= 1;
      if (depth === 0) {
        const decoded = compactWhitespace(decodePdfLiteralString(current));
        if (decoded.length >= 2) {
          values.push(decoded);
        }
        current = '';
      } else {
        current += character;
      }
      continue;
    }

    current += character;
  }

  return values;
}

function decodePdfHexString(value: string): string {
  const normalized = value.replace(/\s+/g, '');
  if (!normalized || normalized.length % 2 !== 0) {
    return '';
  }

  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }

  return compactWhitespace(new TextDecoder('windows-1252').decode(bytes));
}

function extractPdfHexStrings(content: string): string[] {
  return Array.from(content.matchAll(/<([0-9A-Fa-f\s]{6,})>\s*Tj/g))
    .map((match) => decodePdfHexString(match[1]))
    .filter((value) => value.length >= 2);
}

function extractPrintableRuns(content: string): string[] {
  return Array.from(content.matchAll(/[A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9@&/.,:;_#'’()\- ]{4,}/g))
    .map((match) => compactWhitespace(match[0]))
    .filter((value) => value.length >= 5);
}

function latin1BytesToString(bytes: Uint8Array): string {
  let result = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    result += String.fromCharCode(...chunk);
  }

  return result;
}

async function inflatePdfStreamBytes(bytes: Uint8Array): Promise<string | null> {
  if (typeof DecompressionStream === 'undefined') {
    return null;
  }

  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    const inflated = await new Response(stream).arrayBuffer();
    return new TextDecoder('windows-1252').decode(inflated);
  } catch {
    return null;
  }
}

async function decodePdfBufferToText(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const binaryText = new TextDecoder('windows-1252').decode(buffer);
  const contents: string[] = [binaryText];
  const streamRegex = /stream\r?\n([\s\S]*?)endstream/g;
  let match: RegExpExecArray | null;

  while ((match = streamRegex.exec(binaryText)) !== null) {
    const streamContent = match[1].replace(/^\r?\n/, '').replace(/\r?\n$/, '');
    const dictWindowStart = Math.max(0, match.index - 300);
    const dictText = binaryText.slice(dictWindowStart, match.index);

    if (/FlateDecode/.test(dictText)) {
      const startIndex = match.index + match[0].indexOf(streamContent);
      const streamBytes = bytes.subarray(startIndex, startIndex + streamContent.length);
      const inflated = await inflatePdfStreamBytes(streamBytes);
      if (inflated) {
        contents.push(inflated);
      }
    } else {
      contents.push(streamContent);
    }
  }

  const fragments = uniqueValues(contents.flatMap((content) => [
    ...extractPdfLiteralStrings(content),
    ...extractPdfHexStrings(content),
    ...extractPrintableRuns(content),
  ]));

  if (fragments.length > 0) {
    return compactWhitespace(fragments.join(' '));
  }

  return compactWhitespace(latin1BytesToString(bytes));
}

async function decodeFileToText(file: File): Promise<string> {
  const lowerName = file.name.toLowerCase();
  const lowerType = file.type.toLowerCase();
  const isPdf = lowerName.endsWith('.pdf') || lowerType.includes('pdf');

  if (!isPdf && typeof file.text === 'function') {
    const directText = await file.text();
    if (directText) {
      return directText;
    }
  }

  if (typeof FileReader !== 'undefined') {
    const readerText = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error('Impossible de lire le fichier.'));
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      if (isPdf) {
        reader.readAsArrayBuffer(file);
      } else {
        reader.readAsText(file);
      }
    });

    if (readerText && !isPdf) {
      return readerText;
    }
  }

  const buffer = typeof file.arrayBuffer === 'function'
    ? await file.arrayBuffer()
    : await new Response(file).arrayBuffer();

  if (isPdf) {
    return decodePdfBufferToText(buffer);
  }

  const encodings = ['utf-8', 'windows-1252'] as const;
  let bestText = '';
  let bestScore = -1;

  for (const encoding of encodings) {
    try {
      const decoded = new TextDecoder(encoding).decode(buffer);
      const score = scoreReadableText(decoded);

      if (score > bestScore) {
        bestText = decoded;
        bestScore = score;
      }
    } catch {
      // Ignore unsupported encoding and continue with the next one.
    }
  }

  return bestText;
}

// This extractor deliberately stays frontend-native and heuristic.
// It works well for XML and text PDFs, but it is not a full PDF parser and does not perform OCR.
function determineSourceFormat(file: File): InvoiceSourceFormat {
  const lowerName = file.name.toLowerCase();
  const lowerType = file.type.toLowerCase();

  if (lowerName.endsWith('.xml') || lowerType.includes('xml')) {
    return 'XML';
  }

  return 'PDF';
}

function sanitizeToken(value: string): string {
  return value
    .trim()
    .replace(/^[\s:;#-]+/, '')
    .replace(/[;,.\s]+$/, '')
    .trim();
}

function pickFirstMatch(text: string, patterns: Array<{ regex: RegExp; confidence: number }>): CandidateMatch<string> {
  for (const pattern of patterns) {
    const match = text.match(pattern.regex);
    const candidate = match?.[1] ? sanitizeToken(match[1]) : '';

    if (candidate) {
      return {
        value: candidate,
        confidence: pattern.confidence,
      };
    }
  }

  return {};
}

function extractXmlTagValue(text: string, tagNames: string[]): string | undefined {
  for (const tagName of tagNames) {
    const regex = new RegExp(
      `<(?:[\\w-]+:)?${tagName}[^>]*>\\s*([^<]+?)\\s*<\\/(?:[\\w-]+:)?${tagName}>`,
      'i',
    );
    const match = text.match(regex);
    const candidate = match?.[1] ? sanitizeToken(match[1]) : '';

    if (candidate) {
      return candidate;
    }
  }

  return undefined;
}

function extractFullUppercaseLine(text: string): string | undefined {
  const match = text.match(/\b([A-Z][A-Z'’.-]{2,}(?:\s+[A-Z][A-Z'’.-]{2,}){1,}(?:\s+-\s+[A-Z][A-Z'’.-]{2,}(?:\s+[A-Z][A-Z'’.-]{2,})*)?)\b/);
  return match?.[1] ? compactWhitespace(match[1]) : undefined;
}

function normalizeDate(value: string): string | undefined {
  const cleaned = sanitizeToken(value).replace(/\./g, '/').replace(/-/g, '/');

  if (/^\d{8}$/.test(cleaned)) {
    if (cleaned.startsWith('19') || cleaned.startsWith('20')) {
      return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)}`;
    }

    return `${cleaned.slice(4, 8)}-${cleaned.slice(2, 4)}-${cleaned.slice(0, 2)}`;
  }

  if (/^\d{4}\/\d{2}\/\d{2}$/.test(cleaned)) {
    return cleaned.replace(/\//g, '-');
  }

  const match = cleaned.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return undefined;
  }

  return `${match[3]}-${match[2]}-${match[1]}`;
}

function parseAmount(value: string): number | undefined {
  const cleaned = sanitizeToken(value)
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

function detectCurrency(text: string, rawText: string, sourceFormat: InvoiceSourceFormat): CandidateMatch<string> {
  const xmlCurrency = sourceFormat === 'XML'
    ? extractXmlTagValue(rawText, ['Currency', 'InvoiceCurrencyCode', 'DocumentCurrencyCode'])
    : undefined;

  if (xmlCurrency) {
    return {
      value: xmlCurrency.toUpperCase(),
      confidence: 0.92,
    };
  }

  const explicitLabelMatch = pickFirstMatch(text, [
    { regex: /\b(?:currency|devise)\s*[:#-]?\s*(EUR|USD|GBP|CHF)\b/i, confidence: 0.92 },
    { regex: /\b(?:montant|total|net\s+a\s+payer|net\s+à\s+payer)[^A-Z]{0,25}(EUR|USD|GBP|CHF)\b/i, confidence: 0.82 },
  ]);

  if (explicitLabelMatch.value) {
    return {
      value: explicitLabelMatch.value.toUpperCase(),
      confidence: explicitLabelMatch.confidence,
    };
  }

  const amountWithCurrency = text.match(/\b[0-9][0-9\s.,']{0,20}\s*(EUR|USD|GBP|CHF)\b/i);
  if (amountWithCurrency?.[1]) {
    return {
      value: amountWithCurrency[1].toUpperCase(),
      confidence: 0.8,
    };
  }

  if (/€/.test(rawText)) {
    return { value: 'EUR', confidence: 0.7 };
  }

  return {};
}

function extractInvoiceNumber(text: string, rawText: string, filename: string, sourceFormat: InvoiceSourceFormat): CandidateMatch<string> {
  const xmlInvoiceNumber = sourceFormat === 'XML'
    ? extractXmlTagValue(rawText, ['InvoiceNumber', 'NumeroFacture', 'InvoiceID', 'DocumentNumber'])
    : undefined;

  const regexMatch = pickFirstMatch(text, [
    {
      regex: /\b(?:facture|invoice)\s*(?:n[°ºo]?|numero|numéro|number|reference|référence)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{2,})/i,
      confidence: 0.94,
    },
    {
      regex: /\b(?:n[°ºo]?|numero|numéro)\s*de\s*facture\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{2,})/i,
      confidence: 0.92,
    },
  ]);

  if (xmlInvoiceNumber) {
    return { value: xmlInvoiceNumber, confidence: 0.94 };
  }

  if (regexMatch.value) {
    return regexMatch;
  }

  const baseName = filename.replace(/\.[^.]+$/, '');
  const filenameMatch = baseName.match(/([A-Z]{2,}[-_]\d{2,}(?:[-_][A-Z0-9]+)*)/i);

  if (filenameMatch?.[1]) {
    return {
      value: filenameMatch[1].replace(/_/g, '-'),
      confidence: 0.55,
    };
  }

  return {};
}

function extractInvoiceDate(text: string, rawText: string, sourceFormat: InvoiceSourceFormat): CandidateMatch<string> {
  const xmlDate = sourceFormat === 'XML'
    ? extractXmlTagValue(rawText, ['InvoiceDate', 'IssueDate', 'DateTimeString'])
    : undefined;

  const regexMatch = pickFirstMatch(text, [
    {
      regex: /\bfacture\b[^0-9]{0,10}(?:n[°ºo]?|numero|numéro)?[^A-Z0-9]{0,10}[A-Z0-9/_-]{2,}[^0-9]{0,12}(?:du|le)\s*(\d{2}[\/.-]\d{2}[\/.-]\d{4})/i,
      confidence: 0.96,
    },
    {
      regex: /\b(?:date\s+facture|invoice\s+date|date\s+d['’]emission|date\s+d['’]émission|issue\s+date)\s*[:#-]?\s*(\d{2}[\/.-]\d{2}[\/.-]\d{4}|\d{4}[\/.-]\d{2}[\/.-]\d{2}|\d{8})/i,
      confidence: 0.93,
    },
    {
      regex: /\b(?:date)\s*[:#-]?\s*(\d{2}[\/.-]\d{2}[\/.-]\d{4}|\d{4}[\/.-]\d{2}[\/.-]\d{2})/i,
      confidence: 0.74,
    },
  ]);

  const candidate = xmlDate ?? regexMatch.value;
  const normalized = candidate ? normalizeDate(candidate) : undefined;

  return normalized
    ? { value: normalized, confidence: xmlDate ? 0.94 : regexMatch.confidence }
    : {};
}

function extractDueDate(text: string, rawText: string, sourceFormat: InvoiceSourceFormat): CandidateMatch<string> {
  const xmlDate = sourceFormat === 'XML'
    ? extractXmlTagValue(rawText, ['DueDate', 'PaymentDueDate', 'PaymentTermsDate'])
    : undefined;

  const regexMatch = pickFirstMatch(text, [
    {
      regex: /\b(?:jusqu['’]au|date\s+echeance|date\s+échéance|echeance|échéance|delai\s+de\s+reglement|délai\s+de\s+règlement)\s*[:#-]?\s*(\d{2}[\/.-]\d{2}[\/.-]\d{4}|\d{4}[\/.-]\d{2}[\/.-]\d{2})/i,
      confidence: 0.94,
    },
  ]);

  const candidate = xmlDate ?? regexMatch.value;
  const normalized = candidate ? normalizeDate(candidate) : undefined;

  return normalized
    ? { value: normalized, confidence: xmlDate ? 0.94 : regexMatch.confidence }
    : {};
}

function extractCode(text: string, rawText: string, sourceFormat: InvoiceSourceFormat, field: 'engagement' | 'market' | 'purchaseOrder' | 'service' | 'publicCustomer'): CandidateMatch<string> {
  const xmlTags: Record<typeof field, string[]> = {
    engagement: ['EngagementNumber', 'CommitmentNumber'],
    market: ['MarketNumber', 'ContractNumber'],
    purchaseOrder: ['PurchaseOrderNumber', 'OrderReference', 'OrderID'],
    service: ['ServiceCode', 'BuyerReference', 'AccountingCost'],
    publicCustomer: ['CodeDestinataire', 'DestinationCode'],
  };

  const regexes: Record<typeof field, Array<{ regex: RegExp; confidence: number }>> = {
    engagement: [
      { regex: /\b(?:engagement|commitment)\s*(?:n[°ºo]?|numero|numéro|number)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{2,})/i, confidence: 0.9 },
    ],
    market: [
      { regex: /\b(?:marche|marché|contract)\s*(?:n[°ºo]?|numero|numéro|number)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{2,})/i, confidence: 0.9 },
    ],
    purchaseOrder: [
      { regex: /\b(?:bon\s+de\s+commande|purchase\s+order|order)\s*(?:n[°ºo]?|numero|numéro|number)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{2,})/i, confidence: 0.9 },
    ],
    service: [
      { regex: /\b(?:code\s+service|service\s+destinataire|service\s+executant|service\s+exécutant|service\s+code)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{1,19})/i, confidence: 0.92 },
    ],
    publicCustomer: [
      { regex: /\b(?:code\s+destinataire|destinataire)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{2,19})/i, confidence: 0.9 },
    ],
  };

  const xmlValue = sourceFormat === 'XML'
    ? extractXmlTagValue(rawText, xmlTags[field])
    : undefined;

  if (xmlValue) {
    return {
      value: xmlValue,
      confidence: 0.91,
    };
  }

  return pickFirstMatch(text, regexes[field]);
}

function extractAmount(text: string, rawText: string, sourceFormat: InvoiceSourceFormat, field: 'ht' | 'ttc'): CandidateMatch<number> {
  const xmlTags: Record<typeof field, string[]> = {
    ht: ['TotalHT', 'TaxExclusiveAmount', 'LineExtensionAmount'],
    ttc: ['TotalTTC', 'TaxInclusiveAmount', 'PayableAmount'],
  };

  const regexes: Record<typeof field, Array<{ regex: RegExp; confidence: number }>> = {
    ht: [
      { regex: /\b(?:total\s*ht|montant\s*ht|hors\s*taxes)\s*[:#-]?\s*([0-9\s.,]+)\s*(?:€|eur|usd|gbp|chf)?/i, confidence: 0.88 },
    ],
    ttc: [
      { regex: /\b(?:total\s*ttc|montant\s*ttc|net\s+a\s+payer|net\s+à\s+payer|amount\s+due)\s*[:#-]?\s*([0-9\s.,]+)\s*(?:€|eur|usd|gbp|chf)?/i, confidence: 0.88 },
    ],
  };

  const xmlValue = sourceFormat === 'XML'
    ? extractXmlTagValue(rawText, xmlTags[field])
    : undefined;
  const candidate = xmlValue ?? pickFirstMatch(text, regexes[field]).value;
  const amount = candidate ? parseAmount(candidate) : undefined;

  return amount !== undefined
    ? { value: amount, confidence: xmlValue ? 0.9 : 0.88 }
    : {};
}

function extractVatAmount(text: string, rawText: string, sourceFormat: InvoiceSourceFormat): CandidateMatch<number> {
  const xmlValue = sourceFormat === 'XML'
    ? extractXmlTagValue(rawText, ['TaxAmount', 'TotalTaxAmount'])
    : undefined;

  const regexMatch = pickFirstMatch(text, [
    { regex: /\b(?:montant\s+tva|total\s+tva|tva\s*\d{1,2}(?:[.,]\d+)?%)\s*[:#-]?\s*([0-9\s.,']+)\s*(?:€|eur|usd|gbp|chf)?/i, confidence: 0.86 },
  ]);

  const candidate = xmlValue ?? regexMatch.value;
  const amount = candidate ? parseAmount(candidate) : undefined;

  return amount !== undefined
    ? { value: amount, confidence: xmlValue ? 0.9 : regexMatch.confidence }
    : {};
}

function extractCustomerReference(text: string, rawText: string, sourceFormat: InvoiceSourceFormat): CandidateMatch<string> {
  const xmlValue = sourceFormat === 'XML'
    ? extractXmlTagValue(rawText, ['CustomerReference', 'BuyerReference'])
    : undefined;

  if (xmlValue) {
    return { value: xmlValue, confidence: 0.9 };
  }

  return pickFirstMatch(text, [
    { regex: /\b(?:id\s+client|reference\s+client|référence\s+client)\s*(?:n[°ºo]?|numero|numéro|number)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{1,19})/i, confidence: 0.9 },
  ]);
}

function extractSupplierVatNumber(text: string, rawText: string, sourceFormat: InvoiceSourceFormat): CandidateMatch<string> {
  const xmlValue = sourceFormat === 'XML'
    ? extractXmlTagValue(rawText, ['CompanyVATNumber', 'SupplierVATIdentifier', 'TaxRegistrationIdentifier'])
    : undefined;

  if (xmlValue) {
    return { value: xmlValue.toUpperCase(), confidence: 0.9 };
  }

  return pickFirstMatch(text, [
    { regex: /\b(?:n[°ºo]?\s*tva\s+fournisseur|tva\s+fournisseur|vat\s+number)\s*[:#-]?\s*([A-Z]{2}[A-Z0-9]{8,20})/i, confidence: 0.9 },
  ]);
}

function extractServiceLabel(text: string): CandidateMatch<string> {
  const normalizedText = compactWhitespace(text);
  const explicitMatch = normalizedText.match(/\b((?:comptabilite|comptabilité)\s+fournisseurs)\b/i);
  if (explicitMatch?.[1]) {
    return {
      value: explicitMatch[1],
      confidence: 0.86,
    };
  }

  return {};
}

function extractLabelledSirets(text: string): string[] {
  return uniqueValues(
    Array.from(text.matchAll(/\bsiret\s*:\s*((?:\d[\s.-]?){14,20})/gi))
      .map((match) => cleanDigits(match[1]))
      .filter((candidate) => candidate.length === 14),
  );
}

function findMentionedCode(text: string, codes: string[]): string | undefined {
  for (const code of codes) {
    const regex = new RegExp(`\\b${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (regex.test(text)) {
      return code;
    }
  }

  return undefined;
}

function findMatchByName<T extends { id: string; legalName: string }>(text: string, refs: T[]): T | undefined {
  const normalizedText = normalizeLookup(text);

  return refs
    .map((item) => ({ item, normalizedName: normalizeLookup(item.legalName) }))
    .filter(({ normalizedName }) => normalizedName.length > 5 && normalizedText.includes(normalizedName))
    .sort((left, right) => right.normalizedName.length - left.normalizedName.length)[0]?.item;
}

function findLabelledSiret(text: string, labels: string[]): string | undefined {
  const escapedLabels = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(?:${escapedLabels.join('|')})[^\\d]{0,30}((?:\\d[\\s.-]?){14,20})`, 'i');
  const digits = cleanDigits(text.match(regex)?.[1] ?? '');

  return digits.length === 14 ? digits : undefined;
}

function extractSiretCandidates(text: string): string[] {
  return uniqueValues(
    Array.from(text.matchAll(/\b(?:\d[\s.-]?){14}\b/g))
      .map((match) => cleanDigits(match[0]))
      .filter((candidate) => candidate.length === 14),
  );
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return Number((total / values.length).toFixed(2));
}

export async function extractInvoiceData(
  file: File,
  references: InvoiceExtractionReferences,
): Promise<LocalInvoiceExtractionResult> {
  const sourceFormat = determineSourceFormat(file);
  const rawText = await decodeFileToText(file);
  const text = compactWhitespace(rawText);
  const readabilityScore = scoreReadableText(rawText);
  const warnings: string[] = [];
  const fieldConfidences: number[] = [];
  const fields: ExtractedInvoiceDraftData = {};

  const invoiceNumber = extractInvoiceNumber(text, rawText, file.name, sourceFormat);
  if (invoiceNumber.value) {
    fields.supplierInvoiceNumber = invoiceNumber.value;
    fieldConfidences.push(invoiceNumber.confidence ?? 0.6);
  }

  const invoiceDate = extractInvoiceDate(text, rawText, sourceFormat);
  if (invoiceDate.value) {
    fields.invoiceDate = invoiceDate.value;
    fieldConfidences.push(invoiceDate.confidence ?? 0.6);
  }

  const dueDate = extractDueDate(text, rawText, sourceFormat);
  if (dueDate.value) {
    fields.dueDate = dueDate.value;
    fieldConfidences.push(dueDate.confidence ?? 0.6);
  }

  const engagementNumber = extractCode(text, rawText, sourceFormat, 'engagement');
  if (engagementNumber.value) {
    fields.engagementNumber = engagementNumber.value;
    fieldConfidences.push(engagementNumber.confidence ?? 0.6);
  }

  const marketNumber = extractCode(text, rawText, sourceFormat, 'market');
  if (marketNumber.value) {
    fields.marketNumber = marketNumber.value;
    fieldConfidences.push(marketNumber.confidence ?? 0.6);
  }

  const purchaseOrderNumber = extractCode(text, rawText, sourceFormat, 'purchaseOrder');
  if (purchaseOrderNumber.value) {
    fields.purchaseOrderNumber = purchaseOrderNumber.value;
    fieldConfidences.push(purchaseOrderNumber.confidence ?? 0.6);
  }

  const currency = detectCurrency(text, rawText, sourceFormat);
  if (currency.value) {
    fields.currencyCode = currency.value;
    fieldConfidences.push(currency.confidence ?? 0.6);
  }

  const totalAmountHt = extractAmount(text, rawText, sourceFormat, 'ht');
  if (totalAmountHt.value !== undefined) {
    fields.totalAmountHt = totalAmountHt.value;
    fieldConfidences.push(totalAmountHt.confidence ?? 0.6);
  }

  const totalVat = extractVatAmount(text, rawText, sourceFormat);
  if (totalVat.value !== undefined) {
    fields.totalVat = totalVat.value;
    fieldConfidences.push(totalVat.confidence ?? 0.6);
  }

  const totalAmountTtc = extractAmount(text, rawText, sourceFormat, 'ttc');
  if (totalAmountTtc.value !== undefined) {
    fields.totalAmountTtc = totalAmountTtc.value;
    fieldConfidences.push(totalAmountTtc.confidence ?? 0.6);
  }

  const customerReference = extractCustomerReference(text, rawText, sourceFormat);
  if (customerReference.value) {
    fields.customerReference = customerReference.value;
    fieldConfidences.push(customerReference.confidence ?? 0.6);
  }

  const supplierVatNumber = extractSupplierVatNumber(text, rawText, sourceFormat);
  if (supplierVatNumber.value) {
    fields.supplierVatNumber = supplierVatNumber.value;
    fieldConfidences.push(supplierVatNumber.confidence ?? 0.6);
  }

  const llmEnrichedFields = await extractInvoiceDataWithOllama(text, sourceFormat, file.name, fields);
  Object.assign(fields, llmEnrichedFields);

  const candidateSirets = extractSiretCandidates(rawText);
  const labelledSirets = extractLabelledSirets(rawText);
  const supplierRefs = references.suppliers as NamedReference[];
  const customerRefs = references.publicCustomers as NamedReference[];

  const supplierSiret = findLabelledSiret(rawText, ['siret fournisseur', 'supplier', 'seller', 'vendeur', 'fournisseur'])
    ?? labelledSirets[0]
    ?? candidateSirets.find((candidate) => supplierRefs.some((supplier) => supplier.siret === candidate));
  if (supplierSiret) {
    fields.supplierSiret = supplierSiret;
    fieldConfidences.push(0.93);
  }

  const publicCustomerSiret = findLabelledSiret(rawText, ['siret destinataire', 'client public', 'buyer', 'destinataire', 'administration'])
    ?? labelledSirets.find((candidate) => candidate !== supplierSiret)
    ?? candidateSirets.find((candidate) => customerRefs.some((customer) => customer.siret === candidate));
  if (publicCustomerSiret) {
    fields.publicCustomerSiret = publicCustomerSiret;
    fieldConfidences.push(0.93);
  }

  const publicCustomerCode = extractCode(text, rawText, sourceFormat, 'publicCustomer');
  if (publicCustomerCode.value) {
    fields.publicCustomerCode = publicCustomerCode.value;
    fieldConfidences.push(publicCustomerCode.confidence ?? 0.6);
  }

  let supplier = supplierSiret
    ? references.suppliers.find((item) => item.siret === supplierSiret)
    : undefined;
  if (!supplier && fields.supplierName) {
    supplier = references.suppliers.find((item) => normalizeLookup(item.legalName) === normalizeLookup(fields.supplierName ?? ''));
  }
  if (!supplier) {
    supplier = findMatchByName(text, references.suppliers);
  }
  if (supplier) {
    fields.supplierOrganizationId = supplier.id;
    fields.supplierSiret = supplier.siret;
    fields.supplierName = supplier.legalName;
    fieldConfidences.push(supplierSiret ? 0.97 : 0.8);
  }

  if (!fields.supplierName) {
    const supplierName = pickFirstMatch(text, [
      { regex: /\b(GIP\s+Gigalis)\b/i, confidence: 0.82 },
    ]);

    if (supplierName.value) {
      fields.supplierName = supplierName.value;
      fieldConfidences.push(supplierName.confidence ?? 0.6);
    }
  }

  let publicCustomer = fields.publicCustomerCode
    ? references.publicCustomers.find((item) => item.codeDestinataire.toLowerCase() === fields.publicCustomerCode?.toLowerCase())
    : undefined;
  if (!publicCustomer && publicCustomerSiret) {
    publicCustomer = references.publicCustomers.find((item) => item.siret === publicCustomerSiret);
  }
  if (!publicCustomer && fields.publicCustomerName) {
    publicCustomer = references.publicCustomers.find((item) => normalizeLookup(item.legalName) === normalizeLookup(fields.publicCustomerName ?? ''));
  }
  if (!publicCustomer) {
    publicCustomer = findMatchByName(text, references.publicCustomers);
  }
  if (publicCustomer) {
    fields.publicCustomerId = publicCustomer.id;
    fields.publicCustomerSiret = publicCustomer.siret;
    fields.publicCustomerCode = publicCustomer.codeDestinataire;
    fields.publicCustomerName = publicCustomer.legalName;
    fieldConfidences.push(publicCustomerSiret || fields.publicCustomerCode ? 0.97 : 0.82);
  }

  if (!fields.publicCustomerName) {
    const upperLine = extractFullUppercaseLine(text);
    if (upperLine && upperLine !== fields.supplierName) {
      fields.publicCustomerName = upperLine;
      fieldConfidences.push(0.8);
    }
  }

  const explicitServiceCode = extractCode(text, rawText, sourceFormat, 'service').value
    ?? findMentionedCode(text, references.publicServices.map((item) => item.codeServiceExecutant));
  if (explicitServiceCode) {
    fields.publicServiceCode = explicitServiceCode;
    fieldConfidences.push(0.9);
  }

  const explicitServiceLabel = extractServiceLabel(text);
  if (explicitServiceLabel.value) {
    fields.publicServiceLabel = explicitServiceLabel.value;
    fieldConfidences.push(explicitServiceLabel.confidence ?? 0.6);
  }

  let serviceCandidates = references.publicServices as ServiceReference[];
  if (fields.publicCustomerId) {
    serviceCandidates = serviceCandidates.filter((item) => item.publicCustomerId === fields.publicCustomerId);
  }

  let publicService = explicitServiceCode
    ? serviceCandidates.find((item) => item.codeServiceExecutant.toLowerCase() === explicitServiceCode.toLowerCase())
    : undefined;
  if (!publicService && fields.publicServiceLabel) {
    publicService = serviceCandidates.find((item) => normalizeLookup(item.label) === normalizeLookup(fields.publicServiceLabel ?? ''));
  }
  if (!publicService) {
    const matchedByLabel = serviceCandidates.find((item) => normalizeLookup(text).includes(normalizeLookup(item.label)));
    publicService = matchedByLabel;
  }
  if (!publicService && explicitServiceCode) {
    publicService = (references.publicServices as ServiceReference[]).find((item) => item.codeServiceExecutant.toLowerCase() === explicitServiceCode.toLowerCase());
  }
  if (publicService) {
    fields.publicServiceId = publicService.id;
    fields.publicServiceCode = publicService.codeServiceExecutant;
    fields.publicServiceLabel = publicService.label;
    fieldConfidences.push(explicitServiceCode ? 0.95 : 0.78);

    if (!fields.publicCustomerId) {
      const derivedCustomer = references.publicCustomers.find((item) => item.id === publicService?.publicCustomerId);
      if (derivedCustomer) {
        fields.publicCustomerId = derivedCustomer.id;
        fields.publicCustomerSiret = derivedCustomer.siret;
        fields.publicCustomerCode = derivedCustomer.codeDestinataire;
        fieldConfidences.push(0.86);
      }
    }
  }

  if (sourceFormat === 'PDF' && text.length < 80) {
    warnings.push('Le PDF semble peu textuel. Les PDF scannés ou OCRisés ne sont pas encore pris en charge.');
  }

  if (sourceFormat === 'PDF' && readabilityScore < 0.75) {
    warnings.push('Le texte extrait du PDF est bruité. Certaines métadonnées peuvent être incorrectes sans un vrai parseur PDF/OCR.');
  }

  if (!fields.supplierInvoiceNumber) {
    warnings.push('Numéro de facture non détecté automatiquement.');
  }
  if (!fields.invoiceDate) {
    warnings.push('Date de facture non détectée automatiquement.');
  }
  if (!fields.publicCustomerId && !fields.publicCustomerSiret && !fields.publicCustomerName) {
    warnings.push('Destinataire public non reconnu dans le document.');
  } else if (!fields.publicCustomerId) {
    warnings.push('Destinataire extrait mais non rapproché des références locales.');
  }
  if (!fields.publicServiceId && !fields.publicServiceCode && !fields.publicServiceLabel) {
    warnings.push('Code service non reconnu automatiquement.');
  } else if (!fields.publicServiceId) {
    warnings.push('Service destinataire extrait mais non rapproché des références locales.');
  }
  if (!fields.currencyCode) {
    warnings.push('Devise non détectée automatiquement.');
  }

  const criticalFieldCount = [
    fields.supplierInvoiceNumber,
    fields.invoiceDate,
    fields.supplierOrganizationId ?? fields.supplierSiret,
    fields.publicCustomerId ?? fields.publicCustomerSiret,
  ].filter(Boolean).length;
  const confidence = average(fieldConfidences);
  const requiresReview = confidence < 0.78 || criticalFieldCount < 3 || readabilityScore < 0.75;

  return {
    sourceFormat,
    fields,
    confidence,
    requiresReview,
    warnings: uniqueValues(warnings),
    rawText: text,
    rawTextPreview: text.slice(0, 240),
  };
}

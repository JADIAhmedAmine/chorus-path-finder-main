import type { PublicCustomer, PublicService, SupplierOrganization } from '@/types';

export type InvoiceSourceFormat = 'PDF' | 'XML';

export interface InvoiceExtractionReferences {
  suppliers: Pick<SupplierOrganization, 'id' | 'legalName' | 'siret'>[];
  publicCustomers: Pick<PublicCustomer, 'id' | 'legalName' | 'siret' | 'codeDestinataire'>[];
  publicServices: Pick<PublicService, 'id' | 'publicCustomerId' | 'codeServiceExecutant' | 'label'>[];
}

export interface ExtractedInvoiceDraftData {
  supplierOrganizationId?: string;
  supplierInvoiceNumber?: string;
  publicCustomerId?: string;
  publicServiceId?: string;
  engagementNumber?: string;
  marketNumber?: string;
  purchaseOrderNumber?: string;
  invoiceDate?: string;
  currencyCode?: string;
  supplierSiret?: string;
  publicCustomerSiret?: string;
  publicServiceCode?: string;
  publicCustomerCode?: string;
  totalAmountHt?: number;
  totalAmountTtc?: number;
}

export interface LocalInvoiceExtractionResult {
  sourceFormat: InvoiceSourceFormat;
  fields: ExtractedInvoiceDraftData;
  confidence: number;
  requiresReview: boolean;
  warnings: string[];
  rawTextPreview: string;
}

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

async function decodeFileToText(file: File): Promise<string> {
  if (typeof file.text === 'function') {
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
      reader.readAsText(file);
    });

    if (readerText) {
      return readerText;
    }
  }

  const buffer = typeof file.arrayBuffer === 'function'
    ? await file.arrayBuffer()
    : await new Response(file).arrayBuffer();
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

  const candidate = (xmlCurrency ?? pickFirstMatch(text, [
    { regex: /\b(?:currency|devise)\s*[:#-]?\s*([A-Z]{3})\b/i, confidence: 0.9 },
    { regex: /\b(EUR|USD|GBP|CHF)\b/i, confidence: 0.72 },
  ]).value);

  if (!candidate && /€/.test(rawText)) {
    return { value: 'EUR', confidence: 0.7 };
  }

  if (!candidate) {
    return {};
  }

  return {
    value: candidate.toUpperCase(),
    confidence: xmlCurrency ? 0.92 : 0.9,
  };
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

  const totalAmountTtc = extractAmount(text, rawText, sourceFormat, 'ttc');
  if (totalAmountTtc.value !== undefined) {
    fields.totalAmountTtc = totalAmountTtc.value;
    fieldConfidences.push(totalAmountTtc.confidence ?? 0.6);
  }

  const candidateSirets = extractSiretCandidates(rawText);
  const supplierRefs = references.suppliers as NamedReference[];
  const customerRefs = references.publicCustomers as NamedReference[];

  const supplierSiret = findLabelledSiret(rawText, ['siret fournisseur', 'supplier', 'seller', 'vendeur', 'fournisseur'])
    ?? candidateSirets.find((candidate) => supplierRefs.some((supplier) => supplier.siret === candidate));
  if (supplierSiret) {
    fields.supplierSiret = supplierSiret;
    fieldConfidences.push(0.93);
  }

  const publicCustomerSiret = findLabelledSiret(rawText, ['siret destinataire', 'client public', 'buyer', 'destinataire', 'administration'])
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
  if (!supplier) {
    supplier = findMatchByName(text, references.suppliers);
  }
  if (supplier) {
    fields.supplierOrganizationId = supplier.id;
    fields.supplierSiret = supplier.siret;
    fieldConfidences.push(supplierSiret ? 0.97 : 0.8);
  }

  let publicCustomer = fields.publicCustomerCode
    ? references.publicCustomers.find((item) => item.codeDestinataire.toLowerCase() === fields.publicCustomerCode?.toLowerCase())
    : undefined;
  if (!publicCustomer && publicCustomerSiret) {
    publicCustomer = references.publicCustomers.find((item) => item.siret === publicCustomerSiret);
  }
  if (!publicCustomer) {
    publicCustomer = findMatchByName(text, references.publicCustomers);
  }
  if (publicCustomer) {
    fields.publicCustomerId = publicCustomer.id;
    fields.publicCustomerSiret = publicCustomer.siret;
    fields.publicCustomerCode = publicCustomer.codeDestinataire;
    fieldConfidences.push(publicCustomerSiret || fields.publicCustomerCode ? 0.97 : 0.82);
  }

  const explicitServiceCode = extractCode(text, rawText, sourceFormat, 'service').value
    ?? findMentionedCode(text, references.publicServices.map((item) => item.codeServiceExecutant));
  if (explicitServiceCode) {
    fields.publicServiceCode = explicitServiceCode;
    fieldConfidences.push(0.9);
  }

  let serviceCandidates = references.publicServices as ServiceReference[];
  if (fields.publicCustomerId) {
    serviceCandidates = serviceCandidates.filter((item) => item.publicCustomerId === fields.publicCustomerId);
  }

  let publicService = explicitServiceCode
    ? serviceCandidates.find((item) => item.codeServiceExecutant.toLowerCase() === explicitServiceCode.toLowerCase())
    : undefined;
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

  if (!fields.supplierInvoiceNumber) {
    warnings.push('Numéro de facture non détecté automatiquement.');
  }
  if (!fields.invoiceDate) {
    warnings.push('Date de facture non détectée automatiquement.');
  }
  if (!fields.publicCustomerId) {
    warnings.push('Destinataire public non reconnu dans le document.');
  }
  if (!fields.publicServiceId) {
    warnings.push('Code service non reconnu automatiquement.');
  }

  const criticalFieldCount = [
    fields.supplierInvoiceNumber,
    fields.invoiceDate,
    fields.supplierOrganizationId ?? fields.supplierSiret,
    fields.publicCustomerId ?? fields.publicCustomerSiret,
  ].filter(Boolean).length;
  const confidence = average(fieldConfidences);
  const requiresReview = confidence < 0.78 || criticalFieldCount < 3;

  return {
    sourceFormat,
    fields,
    confidence,
    requiresReview,
    warnings: uniqueValues(warnings),
    rawTextPreview: text.slice(0, 240),
  };
}

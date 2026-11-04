import type { ExtractedInvoiceDraftData } from '@/lib/chorus/types';
import type { ExtractionTemplate } from './types';

const GIGALIS_SUPPLIER_SIRET = '25440253000011';

function normalizeSiret(value: string | undefined): string | undefined {
  const digits = value?.replace(/\D/g, '') ?? '';
  return digits.length === 14 ? digits : undefined;
}

function parseFrenchAmount(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const cleaned = value.replace(/\s/g, '').replace(',', '.');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function frenchDateToIso(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return undefined;
  }
  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

function extractCustomerReference(rawText: string, compact: string): string | undefined {
  const explicitMatch = rawText.match(/ID\s+CLIENT[^0-9]{0,80}(\d{2,5})(?![-/\d])/i);
  if (explicitMatch) {
    return explicitMatch[1];
  }

  const afterIdClient = compact.split(/ID\s+CLIENT/i)[1]?.slice(0, 220) ?? '';
  const nearIdClientMatch = Array.from(afterIdClient.matchAll(/\bN\b[^0-9]{0,12}(\d{2,})(?![-/\d])/gi))[0];
  if (nearIdClientMatch) {
    return nearIdClientMatch[1];
  }

  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const idClientIndex = lines.findIndex((line) => /ID\s+CLIENT/i.test(line));
  if (idClientIndex >= 0) {
    const nearby = lines.slice(idClientIndex, idClientIndex + 6).join('\n');
    const nearbyMatch = nearby.match(/(?:^|\n|ID\s+CLIENT\s+)(?:Facture\s+)?N[^0-9]{0,12}(\d{2,})(?![-/\d])/i);
    if (nearbyMatch) {
      return nearbyMatch[1];
    }
  }

  return compact.match(/Client\s*:\s*[^[]+\[(\d{2,})]/i)?.[1];
}

function matchGigalis(rawText: string): boolean {
  const compact = rawText.replace(/\s+/g, ' ');
  return /\bGIP\s+Gigalis\b/i.test(compact)
    || /\b254\s*402\s*530\s*00011\b/.test(compact)
    || /\bgigalis\b/i.test(compact);
}

function extractGigalisFields(rawText: string): Partial<ExtractedInvoiceDraftData> {
  const fields: Partial<ExtractedInvoiceDraftData> = {};
  const compact = rawText.replace(/\s+/g, ' ');

  fields.supplierSiret = GIGALIS_SUPPLIER_SIRET;
  fields.supplierName = 'GIP Gigalis';
  fields.supplierVatNumber = 'FR59254402530';

  const invoiceNumberMatch = compact.match(/N°\s*:\s*(\d{4}-\d{3}-\d{5})/);
  if (invoiceNumberMatch) {
    fields.supplierInvoiceNumber = invoiceNumberMatch[1];
  }

  const customerReference = extractCustomerReference(rawText, compact);
  if (customerReference) {
    fields.customerReference = customerReference;
  }

  const invoiceDateMatch = compact.match(/Le\s+(\d{2}\/\d{2}\/\d{4})/);
  const isoInvoiceDate = frenchDateToIso(invoiceDateMatch?.[1]);
  if (isoInvoiceDate) {
    fields.invoiceDate = isoInvoiceDate;
  }

  const dueDateMatch = compact.match(/Jusqu'au\s+(\d{2}\/\d{2}\/\d{4})/)
    ?? compact.match(/payable avant le\s*:\s*(\d{2}\/\d{2}\/\d{4})/i);
  const isoDueDate = frenchDateToIso(dueDateMatch?.[1]);
  if (isoDueDate) {
    fields.dueDate = isoDueDate;
  }

  const sirets = Array.from(compact.matchAll(/Siret\s*:\s*([\d\s]{14,20})/g))
    .map((match) => normalizeSiret(match[1]))
    .filter((siret): siret is string => Boolean(siret));
  const customerSiret = sirets.find((siret) => siret !== GIGALIS_SUPPLIER_SIRET);
  if (customerSiret) {
    fields.publicCustomerSiret = customerSiret;
  }

  const codeServiceMatch = compact.match(/Code\s+Service\s*:\s*([A-Z0-9_-]+)/i);
  if (codeServiceMatch) {
    fields.publicServiceCode = codeServiceMatch[1].trim();
  }

  const nomServiceMatch = compact.match(/Nom\s+Service\s*:\s*([^\n]+?)(?=\s*(?:Facture\s+N°|Total\s+HT|$))/i);
  if (nomServiceMatch) {
    fields.publicServiceLabel = nomServiceMatch[1].trim();
  }

  const customerNameMatch = compact.match(/(CENTRE\s+HOSPITALIER[^\n]+?)(?=\s*Comptabilit|\s*Siret|\s*Code\s+Service)/i);
  if (customerNameMatch) {
    fields.publicCustomerName = customerNameMatch[1].replace(/\s+/g, ' ').trim();
  }

  const totalHtMatch = compact.match(/Total\s+HT\s+([\d\s]+,\d{2})/i);
  const totalHt = parseFrenchAmount(totalHtMatch?.[1]);
  if (totalHt !== undefined) {
    fields.totalAmountHt = totalHt;
  }

  const totalTtcMatch = compact.match(/Total\s+TTC\s+([\d\s]+,\d{2})/i);
  const totalTtc = parseFrenchAmount(totalTtcMatch?.[1]);
  if (totalTtc !== undefined) {
    fields.totalAmountTtc = totalTtc;
  }

  const tvaMatch = compact.match(/TVA\s+\d+%\s+([\d\s]+,\d{2})/i);
  const totalVat = parseFrenchAmount(tvaMatch?.[1]);
  if (totalVat !== undefined) {
    fields.totalVat = totalVat;
  }

  fields.paymentMode = 'VIREMENT';

  fields.currencyCode = 'EUR';

  return fields;
}

export const gigalisTemplate: ExtractionTemplate = {
  id: 'gigalis-v1',
  matches: matchGigalis,
  extract: extractGigalisFields,
};

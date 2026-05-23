import type {
  ChorusPaymentMode,
  ExtractedInvoiceDraftData,
  InvoiceExtractionReferences,
  InvoiceSourceFormat,
  LocalInvoiceExtractionResult,
} from '@/lib/chorus/types';
import { authenticatedFetch } from '@/lib/auth/session';
import { applyExtractionTemplates } from '@/lib/chorus/extraction-templates';

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

interface PositionedPdfTextFragment {
  x: number;
  y: number;
  width: number;
  text: string;
}

const PDF_TECHNICAL_INLINE_PATTERNS = [
  /%PDF-[\d.]+/gi,
  /\b\d+\s+\d+\s+obj\b/gi,
  /\b(?:endobj|stream|endstream|xref|trailer|startxref)\b/gi,
  /\/(?:Type|Subtype|Length|Filter|Producer|Creator|Font|BaseFont|Encoding|Resources|Parent|MediaBox|BBox)\b(?:\s*\/[A-Za-z0-9]+|\s+\d+)?/gi,
  /\b(?:FlateDecode|ASCII85Decode|ASCIIHexDecode|ReportLab)\b/gi,
  /\b(?:BT|ET|T\*)\b/gi,
  /(?:^|\s)(?:-?\d+(?:\.\d+)?\s+){2,}(?:Tf|Tm|Td|TD|TL|cm|rg|RG|re|w|m|l|c|Do)\b/gi,
];

const PDF_FONT_METADATA_NOISE_PATTERN = /\b(?:Arial(?:[- ][A-Za-z]+)?|Times(?: New Roman|NewRoman[A-Za-z]*)|Monotype|Microsoft supplied font|Type Drawing Office|trademark|license terms|embedding restrictions|Ralph Hancock|John Hudson|Robin Nicholas|Patricia Saunders|Stanley Morison|Victor Lardent|Biblical Hebrew|cmap|glyf|GSUB|GPOS|DSIG|head|hhea|hmtx|kern|loca|maxp|prep|fpgm|cvt|post|mark|mkmk|ccmp|dlig|liga|rlig|locl|lnum|tnum|numr)\b/i;
const PDF_OPERATOR_NOISE_PATTERN = /\b(?:BT|ET|Tf|Tm|Td|TD|TJ|Tj|TL|Do|cm|rg|RG|re|w|m|l|c|obj|endobj|stream|endstream|xref|trailer|startxref)\b/i;
const PDF_DICTIONARY_NOISE_PATTERN = /<<|>>|\/[A-Za-z][A-Za-z0-9]+/;

type PdfApiExtractionResult =
  | { status: 'success'; text: string }
  | { status: 'backend-error'; error: string }
  | { status: 'unavailable' };

// Local Docling extraction can be slow on the first request, especially on Windows/WSL.
// Keep a wider timeout so the browser does not abort the Python bridge too early.
const PDF_API_TIMEOUT_MS = 45000;

function isTestRuntime(): boolean {
  const runtime = globalThis as typeof globalThis & {
    process?: {
      env?: Record<string, string | undefined>;
    };
  };

  return runtime.process?.env?.VITEST === 'true' || runtime.process?.env?.NODE_ENV === 'test';
}

async function tryExtractPdfViaApi(buffer: ArrayBuffer): Promise<PdfApiExtractionResult> {
  if (isTestRuntime()) {
    return { status: 'unavailable' };
  }

  try {
    // Try to use Python backend if available at localhost:8008
    const bytes = new Uint8Array(buffer);
    let binaryString = '';
    const chunkSize = 0x8000;

    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binaryString += String.fromCharCode.apply(null, Array.from(chunk));
    }

    const encoded = btoa(binaryString);
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
    const timeoutId = controller
      ? globalThis.setTimeout(() => controller.abort(), PDF_API_TIMEOUT_MS)
      : undefined;

    const response = await authenticatedFetch('/api/extract-pdf-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pdfBase64: encoded }),
      signal: controller?.signal,
    }).finally(() => {
      if (timeoutId !== undefined) {
        globalThis.clearTimeout(timeoutId);
      }
    });

    const data = await response.json().catch(() => null) as { ok?: boolean; text?: string; error?: string } | null;

    if (!response.ok) {
      return {
        status: 'backend-error',
        error: data?.error?.trim() || `Le service Python a répondu avec le code ${response.status}.`,
      };
    }

    if (data?.ok && typeof data.text === 'string' && data.text.trim()) {
      console.debug('Successfully extracted PDF via Python API');
      return {
        status: 'success',
        text: data.text,
      };
    }

    return {
      status: 'backend-error',
      error: data?.error?.trim() || "Le service Python n'a renvoyé aucun texte exploitable.",
    };
  } catch {
    // Python backend not available, will use fallback
    return { status: 'unavailable' };
  }
}
function compactWhitespace(value: string): string {
  return value
    // Control bytes appear in raw PDFs; replacing them keeps downstream regexes readable.
    // eslint-disable-next-line no-control-regex
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

function isValidExtractedDestinationCode(value: string, references: InvoiceExtractionReferences): boolean {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed)
    || references.publicCustomers.some((customer) => customer.codeDestinataire.toLowerCase() === trimmed.toLowerCase());
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function collapseSequentialDuplicates(values: string[]): string[] {
  const collapsed: string[] = [];

  for (const value of values) {
    if (!value) {
      continue;
    }

    if (collapsed[collapsed.length - 1] !== value) {
      collapsed.push(value);
    }
  }

  return collapsed;
}

function scoreReadableText(value: string): number {
  const compact = value.replace(/\s+/g, '');
  if (!compact) {
    return 0;
  }

  const readableChars = compact.match(/[A-Za-z0-9À-ÿ€.,:/_#-]/g)?.length ?? 0;
  return readableChars / compact.length;
}

function countPatternMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

function stripPdfLineNoise(line: string): string {
  // eslint-disable-next-line no-control-regex
  let cleaned = line.replace(/\u0000/g, ' ').replace(/\r/g, '');

  for (const pattern of PDF_TECHNICAL_INLINE_PATTERNS) {
    cleaned = cleaned.replace(pattern, ' ');
  }

  return cleaned.replace(/[ \t]+/g, ' ').trim();
}

function isLikelyPdfNoiseLine(line: string): boolean {
  const normalized = stripPdfLineNoise(line);

  if (!normalized) {
    return true;
  }

  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x1F\x7F-\x9F\s]+$/.test(line)) {
    return true;
  }

  if (/^(?:obj|endobj|stream|endstream|xref|trailer|startxref|q|Q|BT|ET)$/i.test(normalized)) {
    return true;
  }

  if (PDF_FONT_METADATA_NOISE_PATTERN.test(normalized)) {
    return true;
  }

  const letters = countPatternMatches(normalized, /[A-Za-zÀ-ÿ]/g);
  const digits = countPatternMatches(normalized, /\d/g);
  const weirdSymbols = countPatternMatches(normalized, /[^A-Za-zÀ-ÿ0-9\s€$£¥.,:;()\-/'"%+]/g);
  const operatorTokens = countPatternMatches(normalized, /\b(?:Tf|Tm|Td|TD|TJ|Tj|TL|Do|cm|rg|RG|re|w|m|l|c)\b/g);
  const readableScore = scoreReadableText(normalized);

  if (PDF_DICTIONARY_NOISE_PATTERN.test(normalized) && letters < 6) {
    return true;
  }

  if (operatorTokens >= 1 && digits >= 4 && letters < 12) {
    return true;
  }

  if (weirdSymbols >= 6 && weirdSymbols > letters + digits) {
    return true;
  }

  if (normalized.length >= 24 && readableScore < 0.62) {
    return true;
  }

  if (letters === 0 && digits >= 6) {
    return true;
  }

  if (letters < 2 && !/[€$£¥]/.test(normalized)) {
    return true;
  }

  if (PDF_OPERATOR_NOISE_PATTERN.test(normalized) && readableScore < 0.78) {
    return true;
  }

  return false;
}

function isLikelyHumanPdfLine(line: string): boolean {
  const normalized = stripPdfLineNoise(line);

  if (!normalized || isLikelyPdfNoiseLine(normalized)) {
    return false;
  }

  const letters = countPatternMatches(normalized, /[A-Za-zÀ-ÿ]/g);
  const digits = countPatternMatches(normalized, /\d/g);

  return letters >= 3 || (letters >= 2 && digits >= 2) || /[€$£¥]/.test(normalized);
}

function cleanPdfTechnicalNoise(text: string): string {
  const cleanedLines = collapseSequentialDuplicates(
    text
      .replace(/\r\n?/g, '\n')
      .replace(/[^\S\n]+/g, ' ')
      .split('\n')
      .map((line) => stripPdfLineNoise(line))
      .filter((line) => isLikelyHumanPdfLine(line)),
  );

  return normalizeStructuredPdfText(cleanedLines.join('\n'));
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

function normalizePdfFragment(value: string): string {
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeStructuredPdfText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function estimatePdfTextWidth(value: string): number {
  const normalized = normalizePdfFragment(value);
  if (!normalized) {
    return 0;
  }

  const weightedLength = Array.from(normalized).reduce((count, character) => {
    return count + (/[A-Z0-9€%]/.test(character) ? 1.15 : 1);
  }, 0);

  return Math.max(8, weightedLength * 4.6);
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

function decodePdfHexStringRaw(value: string): string {
  const normalized = value.replace(/\s+/g, '');
  if (!normalized || normalized.length % 2 !== 0) {
    return '';
  }

  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }

  return normalizePdfFragment(new TextDecoder('windows-1252').decode(bytes));
}

function extractPdfHexStrings(content: string): string[] {
  return Array.from(content.matchAll(/<([0-9A-Fa-f\s]{6,})>\s*Tj/g))
    .map((match) => decodePdfHexString(match[1]))
    .filter((value) => value.length >= 2);
}

function extractPrintableRuns(content: string): string[] {
  return Array.from(content.matchAll(/[A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9€$£¥@&/.,:;_#'’()\- ]{4,}/g))
    .map((match) => compactWhitespace(match[0]))
    .filter((value) => value.length >= 5 && isLikelyHumanPdfLine(value));
}

function decodePdfTextArray(value: string): string {
  const fragments: string[] = [];
  let needsSpace = false;

  for (const match of value.matchAll(/\(((?:\\.|[^\\)])*)\)|<([0-9A-Fa-f\s]{2,})>|(-?\d+(?:\.\d+)?)/g)) {
    if (match[1]) {
      const decoded = normalizePdfFragment(decodePdfLiteralString(match[1]));
      if (decoded) {
        fragments.push(needsSpace && fragments.length > 0 ? ` ${decoded}` : decoded);
        needsSpace = false;
      }
      continue;
    }

    if (match[2]) {
      const decoded = decodePdfHexStringRaw(match[2]);
      if (decoded) {
        fragments.push(needsSpace && fragments.length > 0 ? ` ${decoded}` : decoded);
        needsSpace = false;
      }
      continue;
    }

    if (match[3]) {
      const spacing = Number(match[3]);
      if (Number.isFinite(spacing) && Math.abs(spacing) >= 120) {
        needsSpace = true;
      }
    }
  }

  return normalizePdfFragment(fragments.join(''));
}

function extractPositionedPdfTextFragments(content: string): PositionedPdfTextFragment[] {
  const fragments: PositionedPdfTextFragment[] = [];
  const textBlocks = Array.from(content.matchAll(/BT([\s\S]*?)ET/g));

  for (const block of textBlocks) {
    const body = block[1] ?? '';
    let currentX = 0;
    let currentY = 0;
    let lineStartX = 0;
    let lineLeading = 12;

    const tokenRegex = /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+TD|(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+Td|(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+Tm|(-?\d+(?:\.\d+)?)\s+TL|T\*|\(((?:\\.|[^\\)])*)\)\s*'|(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+\(((?:\\.|[^\\)])*)\)\s*"|\(((?:\\.|[^\\)])*)\)\s*Tj|<([0-9A-Fa-f\s]{2,})>\s*Tj|\[((?:.|\r|\n)*?)\]\s*TJ/g;
    let tokenMatch: RegExpExecArray | null;

    while ((tokenMatch = tokenRegex.exec(body)) !== null) {
      if (tokenMatch[1] && tokenMatch[2]) {
        currentX += Number(tokenMatch[1]);
        currentY += Number(tokenMatch[2]);
        lineLeading = Math.abs(Number(tokenMatch[2])) || lineLeading;
        lineStartX = currentX;
        continue;
      }

      if (tokenMatch[3] && tokenMatch[4]) {
        currentX += Number(tokenMatch[3]);
        currentY += Number(tokenMatch[4]);
        lineStartX = currentX;
        continue;
      }

      if (tokenMatch[9] && tokenMatch[10]) {
        currentX = Number(tokenMatch[9]);
        currentY = Number(tokenMatch[10]);
        lineStartX = currentX;
        continue;
      }

      if (tokenMatch[11]) {
        lineLeading = Math.abs(Number(tokenMatch[11])) || lineLeading;
        continue;
      }

      if (tokenMatch[0] === 'T*') {
        currentY -= lineLeading;
        currentX = lineStartX;
        continue;
      }

      if (tokenMatch[12]) {
        currentY -= lineLeading;
        currentX = lineStartX;
      }

      if (tokenMatch[13] && tokenMatch[14] && tokenMatch[15]) {
        currentY -= lineLeading;
        currentX = lineStartX;
      }

      const text = tokenMatch[12]
        ? normalizePdfFragment(decodePdfLiteralString(tokenMatch[12]))
        : tokenMatch[15]
          ? normalizePdfFragment(decodePdfLiteralString(tokenMatch[15]))
          : tokenMatch[16]
            ? normalizePdfFragment(decodePdfLiteralString(tokenMatch[16]))
            : tokenMatch[17]
              ? decodePdfHexStringRaw(tokenMatch[17])
              : tokenMatch[18]
                ? decodePdfTextArray(tokenMatch[18])
                : '';
      const width = estimatePdfTextWidth(text);

      if (!text || width <= 0) {
        continue;
      }

      fragments.push({
        x: Number.isFinite(currentX) ? currentX : 0,
        y: Number.isFinite(currentY) ? currentY : 0,
        width,
        text,
      });

      currentX += width;
    }
  }

  return fragments;
}

function renderPositionedPdfLine(parts: PositionedPdfTextFragment[]): string {
  const sortedParts = [...parts].sort((left, right) => left.x - right.x);

  return normalizePdfFragment(sortedParts.reduce((line, part, index) => {
    if (index === 0) {
      return part.text;
    }

    const previous = sortedParts[index - 1];
    const gap = part.x - (previous.x + previous.width);
    const separator = gap >= 60 ? '    ' : gap >= 18 ? '  ' : ' ';

    return `${line}${separator}${part.text}`;
  }, ''));
}

function buildPositionedPdfReadingView(fragments: PositionedPdfTextFragment[]): string {
  if (fragments.length === 0) {
    return '';
  }

  const sortedFragments = [...fragments].sort((left, right) => {
    if (Math.abs(left.y - right.y) > 1.5) {
      return right.y - left.y;
    }

    return left.x - right.x;
  });

  const lines: Array<{ y: number; parts: PositionedPdfTextFragment[] }> = [];
  for (const fragment of sortedFragments) {
    const targetLine = lines.find((line) => Math.abs(line.y - fragment.y) <= 2.8);
    if (targetLine) {
      targetLine.parts.push(fragment);
    } else {
      lines.push({ y: fragment.y, parts: [fragment] });
    }
  }

  return normalizeStructuredPdfText(
    collapseSequentialDuplicates(
      lines
        .map((line) => renderPositionedPdfLine(line.parts))
        .filter((line) => line.length >= 2),
    ).join('\n'),
  );
}

function mergePdfTextViews(structuredText: string, fragments: string[]): string {
  const normalizedStructured = normalizeStructuredPdfText(structuredText);
  const looseLines = collapseSequentialDuplicates(
    fragments
      .map((fragment) => normalizePdfFragment(fragment))
      .filter((fragment) => fragment.length >= 2),
  );
  const looseText = normalizeStructuredPdfText(looseLines.join('\n'));

  if (!normalizedStructured) {
    return looseText;
  }

  if (!looseText) {
    return normalizedStructured;
  }

  const structuredLength = normalizedStructured.replace(/\s+/g, '').length;
  const looseLength = looseText.replace(/\s+/g, '').length;
  const shouldPreferStructured = structuredLength >= 180 || structuredLength >= looseLength * 0.45;

  const primaryText = shouldPreferStructured ? normalizedStructured : looseText;
  const secondaryLines = shouldPreferStructured
    ? looseLines.filter((line) => !normalizedStructured.includes(line))
    : [];

  return normalizeStructuredPdfText([
    primaryText,
    ...secondaryLines,
  ].filter(Boolean).join('\n'));
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
  const utf8Text = new TextDecoder('utf-8').decode(buffer);
  const binaryText = new TextDecoder('windows-1252').decode(buffer);
  const contents: string[] = uniqueValues([utf8Text, binaryText]);
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

  const positionedReadingView = buildPositionedPdfReadingView(
    contents.flatMap((content) => extractPositionedPdfTextFragments(content)),
  );
  const fragments = uniqueValues(contents.flatMap((content) => [
    ...extractPdfLiteralStrings(content),
    ...extractPdfHexStrings(content),
    ...extractPrintableRuns(content),
  ]));

  if (positionedReadingView || fragments.length > 0) {
    const cleanedMergedText = cleanPdfTechnicalNoise(mergePdfTextViews(positionedReadingView, fragments));
    if (cleanedMergedText) {
      return cleanedMergedText;
    }
  }

  return cleanPdfTechnicalNoise(normalizeStructuredPdfText(latin1BytesToString(bytes)));
}

async function decodePdfArrayBuffer(buffer: ArrayBuffer): Promise<string> {
  // Force Docling extraction via the Python backend.
  // No fallback to in-browser extraction: Docling produces significantly better
  // text and silent fallbacks have caused field-extraction quality regressions.
  if (isTestRuntime()) {
    return decodePdfBufferToText(buffer);
  }

  const apiExtraction = await tryExtractPdfViaApi(buffer);
  if (apiExtraction.status === 'success') {
    const cleanedApiText = cleanPdfTechnicalNoise(apiExtraction.text);
    if (cleanedApiText) {
      return cleanedApiText;
    }
    throw new Error('Extraction Docling vide : aucun texte exploitable retourné par le service.');
  }

  if (apiExtraction.status === 'backend-error') {
    throw new Error(`Extraction Docling en erreur : ${apiExtraction.error}`);
  }

  throw new Error(
    "Service Docling indisponible. Vérifie que le backend Python (port 8008) et Docling (DOCLING_SERVER_URL) sont démarrés.",
  );
}

function looksLikeResponseWrappedFile(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'object file' || normalized === '[object file]';
}

function looksLikeRawPdfPayload(value: string): boolean {
  const trimmed = value.trimStart();
  return /^%PDF-[\d.]+/i.test(trimmed)
    || /\b\d+\s+\d+\s+obj\b/i.test(value)
    || /\b(?:xref|trailer|startxref|endstream)\b/i.test(value)
    || /\/(?:Type|Subtype|Length|Filter|Resources|MediaBox)\b/i.test(value);
}

async function decodeFileToText(file: File): Promise<string> {
  const lowerName = file.name.toLowerCase();
  const lowerType = file.type.toLowerCase();
  const isPdf = lowerName.endsWith('.pdf') || lowerType.includes('pdf');
  const directText = typeof file.text === 'function'
    ? await file.text().catch(() => '')
    : '';

  if (!isPdf) {
    if (directText) {
      return directText;
    }
  } else if (directText && !looksLikeResponseWrappedFile(directText) && !looksLikeRawPdfPayload(directText)) {
    return normalizeStructuredPdfText(directText);
  }

  if (typeof FileReader !== 'undefined') {
    const readerResult = await new Promise<string | ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error('Impossible de lire le fichier.'));
      reader.onload = () => {
        if (typeof reader.result === 'string' || reader.result instanceof ArrayBuffer) {
          resolve(reader.result);
          return;
        }

        resolve('');
      };
      if (isPdf) {
        reader.readAsArrayBuffer(file);
      } else {
        reader.readAsText(file);
      }
    });

    if (!isPdf && typeof readerResult === 'string' && readerResult) {
      return readerResult;
    }

    if (isPdf && readerResult instanceof ArrayBuffer) {
      return decodePdfArrayBuffer(readerResult);
    }
  }

  const buffer = typeof file.arrayBuffer === 'function'
    ? await file.arrayBuffer()
    : await new Response(file).arrayBuffer().catch(() => undefined);

  if (isPdf) {
    if (buffer) {
      const decoded = await decodePdfArrayBuffer(buffer);
      if (!looksLikeResponseWrappedFile(decoded)) {
        return decoded;
      }
    }

    if (directText && !looksLikeResponseWrappedFile(directText)) {
      return cleanPdfTechnicalNoise(normalizeStructuredPdfText(directText));
    }

    return '';
  }

  if (!buffer) {
    return directText;
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

  if (!cleaned || !/\d/.test(cleaned) || !/^\d/.test(cleaned)) {
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

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseFirstAmountFromPatterns(
  text: string,
  patterns: Array<{ regex: RegExp; confidence: number }>,
): CandidateMatch<number> {
  for (const pattern of patterns) {
    const match = text.match(pattern.regex);
    const amount = match?.[1] ? parseAmount(match[1]) : undefined;

    if (amount !== undefined) {
      return {
        value: amount,
        confidence: pattern.confidence,
      };
    }
  }

  return {};
}

function extractVatRate(text: string): number | undefined {
  const match = text.match(/\btva\s*([0-9]{1,2}(?:[,.][0-9]+)?)\s*%/i);
  const rate = match?.[1] ? Number(match[1].replace(',', '.')) : undefined;

  return Number.isFinite(rate) ? rate : undefined;
}

function inferVatAmountFromHt(text: string, amountHt?: number): CandidateMatch<number> {
  const vatRate = extractVatRate(text);
  if (amountHt === undefined || vatRate === undefined) {
    return {};
  }

  return {
    value: roundMoney((amountHt * vatRate) / 100),
    confidence: 0.72,
  };
}

function inferTtcFromHtAndVat(amountHt?: number, vatAmount?: number): CandidateMatch<number> {
  if (amountHt === undefined || vatAmount === undefined) {
    return {};
  }

  return {
    value: roundMoney(amountHt + vatAmount),
    confidence: 0.68,
  };
}

function inferVatAmountFromHtAndTtc(amountHt?: number, amountTtc?: number): CandidateMatch<number> {
  if (amountHt === undefined || amountTtc === undefined || amountTtc < amountHt) {
    return {};
  }

  const vatAmount = roundMoney(amountTtc - amountHt);
  if (vatAmount <= 0 || vatAmount > amountHt) {
    return {};
  }

  return {
    value: vatAmount,
    confidence: 0.8,
  };
}

function normalizePaymentMode(value: string | undefined): ChorusPaymentMode | undefined {
  const trimmed = sanitizeToken(value ?? '');
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

  if (/(cheque|check)/.test(normalized)) {
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

  for (const candidateText of uniqueValues([text, rawText])) {
    const explicitLabelMatch = pickFirstMatch(candidateText, [
      { regex: /\b(?:currency|devise)\s*[:#-]?\s*(EUR|USD|GBP|CHF)\b/i, confidence: 0.92 },
      { regex: /\b(?:montant|total|net\s+a\s+payer|net\s+à\s+payer)[^A-Z]{0,25}(EUR|USD|GBP|CHF)\b/i, confidence: 0.82 },
    ]);

    if (explicitLabelMatch.value) {
      return {
        value: explicitLabelMatch.value.toUpperCase(),
        confidence: explicitLabelMatch.confidence,
      };
    }

    const amountWithCurrency = candidateText.match(/\b[0-9][0-9\s.,']{0,20}\s*(EUR|USD|GBP|CHF)\b/i);
    if (amountWithCurrency?.[1]) {
      return {
        value: amountWithCurrency[1].toUpperCase(),
        confidence: 0.8,
      };
    }
  }

  const rawCurrencyCode = rawText.match(/\b(EUR|USD|GBP|CHF)\b/i);
  if (rawCurrencyCode?.[1]) {
    return {
      value: rawCurrencyCode[1].toUpperCase(),
      confidence: 0.72,
    };
  }

  if (/€/.test(rawText)) {
    return { value: 'EUR', confidence: 0.7 };
  }

  return {};
}

function extractPaymentMode(text: string, rawText: string, sourceFormat: InvoiceSourceFormat): CandidateMatch<ChorusPaymentMode> {
  const xmlValue = sourceFormat === 'XML'
    ? extractXmlTagValue(rawText, ['PaymentMeansCode', 'PaymentMeans', 'PaymentMethod', 'ModePaiement', 'ModeReglement'])
    : undefined;
  const normalizedXmlMode = normalizePaymentMode(xmlValue);
  if (normalizedXmlMode) {
    return {
      value: normalizedXmlMode,
      confidence: 0.9,
    };
  }

  const regexMatch = pickFirstMatch(text, [
    {
      regex: /\b(?:reglement|règlement)\b.{0,100}?\bpayable\s+par\s+(virement(?:\s+bancaire)?|cheque(?:\s+bancaire)?|chèque(?:\s+bancaire)?|prelevement(?:\s+sepa)?|prélèvement(?:\s+sepa)?|especes|espèces|cash)\b/i,
      confidence: 0.95,
    },
    {
      regex: /\b(?:mode\s+de\s+(?:paiement|reglement|règlement)|payment\s+method)\s*[:#-]?\s*([A-Za-zÀ-ÿ /-]{3,40})/i,
      confidence: 0.9,
    },
    {
      regex: /\b(?:paiement|reglement|règlement)\s+par\s+(virement(?:\s+bancaire)?|cheque|chèque|prelevement(?:\s+sepa)?|prélèvement(?:\s+sepa)?|especes|espèces|cash)\b/i,
      confidence: 0.88,
    },
  ]);

  const normalizedMode = normalizePaymentMode(regexMatch.value);
  return normalizedMode
    ? { value: normalizedMode, confidence: regexMatch.confidence ?? 0.86 }
    : {};
}

function normalizeInvoiceNumberCandidate(value: string): string | undefined {
  const candidate = sanitizeToken(value)
    .replace(/\s+/g, '')
    .replace(/_/g, '-');

  if (!candidate || candidate.length < 4) {
    return undefined;
  }

  // A short numeric value is often the customer id in French invoices (ex: ID CLIENT N° 1903).
  if (/^\d{1,5}$/.test(candidate)) {
    return undefined;
  }

  return candidate;
}

function scoreInvoiceNumberCandidate(value: string, confidence: number): number {
  let score = confidence;

  if (/[A-Z]/i.test(value)) {
    score += 0.12;
  }
  if (/[/-]/.test(value)) {
    score += 0.16;
  }
  if (/^(?:19|20)\d{2}[-/]/.test(value)) {
    score += 0.22;
  }
  if (value.length >= 8) {
    score += 0.08;
  }

  return score;
}

function extractInvoiceNumber(text: string, rawText: string, filename: string, sourceFormat: InvoiceSourceFormat): CandidateMatch<string> {
  const xmlInvoiceNumber = sourceFormat === 'XML'
    ? extractXmlTagValue(rawText, ['InvoiceNumber', 'NumeroFacture', 'InvoiceID', 'DocumentNumber'])
    : undefined;

  if (xmlInvoiceNumber) {
    return { value: xmlInvoiceNumber, confidence: 0.94 };
  }

  const candidates: Array<{ value: string; confidence: number; score: number }> = [];
  const patterns = [
    {
      regex: /\bfacture\s*n[°ºo]?\s*:?\s*([A-Z0-9][A-Z0-9/_-]{4,})\s+(?:du|date|le)\b/gi,
      confidence: 0.97,
    },
    {
      regex: /\bfacture\s*n[°ºo]?\s*:?\s*([A-Z0-9][A-Z0-9/_-]{4,})\b/gi,
      confidence: 0.95,
    },
    {
      regex: /\bn[°ºo]?\s*:\s*([12]\d{3}[-/][A-Z0-9][A-Z0-9/_-]{4,})\b/gi,
      confidence: 0.93,
    },
    {
      regex: /\b(?:facture|invoice)\s*(?:n[°ºo]?|numero|numéro|number|reference|référence)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{2,})/gi,
      confidence: 0.94,
    },
    {
      regex: /\b(?:n[°ºo]?|numero|numéro)\s*de\s*facture\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{2,})/gi,
      confidence: 0.92,
    },
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern.regex)) {
      const normalized = match[1] ? normalizeInvoiceNumberCandidate(match[1]) : undefined;
      if (normalized) {
        candidates.push({
          value: normalized,
          confidence: pattern.confidence,
          score: scoreInvoiceNumberCandidate(normalized, pattern.confidence),
        });
      }
    }
  }

  const bestCandidate = candidates
    .sort((left, right) => right.score - left.score)[0];

  if (bestCandidate) {
    return {
      value: bestCandidate.value,
      confidence: bestCandidate.confidence,
    };
  }

  const baseName = filename.replace(/\.[^.]+$/, '');
  const filenameMatch = baseName.match(/([A-Z0-9]{2,}[-_][A-Z0-9]{2,}(?:[-_][A-Z0-9]+)*|[12]\d{3}[-_][A-Z0-9][A-Z0-9_-]{4,})/i);

  if (filenameMatch?.[1]) {
    const normalized = normalizeInvoiceNumberCandidate(filenameMatch[1]);
    if (!normalized) {
      return {};
    }

    return {
      value: normalized,
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
      regex: /\bfacture\b[^0-9]{0,10}(?:n[°ºo]?|numero|numéro)?[^A-Z0-9]{0,10}[A-Z0-9/_-]{2,}[^0-9]{0,12}(?:du|le)\s*(\d{2}[/.-]\d{2}[/.-]\d{4})/i,
      confidence: 0.96,
    },
    {
      regex: /\b(?:date\s+facture|invoice\s+date|date\s+d['’]emission|date\s+d['’]émission|issue\s+date)\s*[:#-]?\s*(\d{2}[/.-]\d{2}[/.-]\d{4}|\d{4}[/.-]\d{2}[/.-]\d{2}|\d{8})/i,
      confidence: 0.93,
    },
    {
      regex: /\b(?:date)\s*[:#-]?\s*(\d{2}[/.-]\d{2}[/.-]\d{4}|\d{4}[/.-]\d{2}[/.-]\d{2})/i,
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
      regex: /\b(?:jusqu['’]au|date\s+echeance|date\s+échéance|echeance|échéance|delai\s+de\s+reglement|délai\s+de\s+règlement)\b[^0-9]{0,45}(\d{2}[/.-]\d{2}[/.-]\d{4}|\d{4}[/.-]\d{2}[/.-]\d{2})/i,
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
      { regex: /\b(?:numero|numéro)\s+d['’]\s*engagement\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{2,})/i, confidence: 0.94 },
      { regex: /\b(?:engagement|commitment)\s*(?:n[°ºo]?|numero|numéro|number)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{2,})/i, confidence: 0.9 },
    ],
    market: [
      { regex: /\b(?:marche|marché|contract)\s*(?:n[°ºo]?|numero|numéro|number)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{2,})/i, confidence: 0.9 },
    ],
    purchaseOrder: [
      { regex: /\b(?:bon\s+de\s+commande|purchase\s+order|order)\s*(?:n[°ºo]?|numero|numéro|number)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{2,})/i, confidence: 0.9 },
    ],
    service: [
      { regex: /\b(?:code\s+service\s+destinataire|code\s+service\s+executant|code\s+service\s+exécutant)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{1,19})/i, confidence: 0.94 },
      { regex: /\b(?:code\s+service|service\s+destinataire|service\s+executant|service\s+exécutant|service\s+code)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{1,19})/i, confidence: 0.92 },
    ],
    publicCustomer: [
      { regex: /\bcode\s+destinataire\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{2,19})/i, confidence: 0.93 },
      { regex: /\bdestinataire\s*[:#-]\s*([A-Z0-9][A-Z0-9-]{2,19})/i, confidence: 0.86 },
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

  for (const candidateText of uniqueValues([text, rawText])) {
    const match = pickFirstMatch(candidateText, regexes[field]);
    if (match.value) {
      return match;
    }
  }

  return {};
}

function extractAmount(text: string, rawText: string, sourceFormat: InvoiceSourceFormat, field: 'ht' | 'ttc'): CandidateMatch<number> {
  const xmlTags: Record<typeof field, string[]> = {
    ht: ['TotalHT', 'TaxExclusiveAmount', 'LineExtensionAmount'],
    ttc: ['TotalTTC', 'TaxInclusiveAmount', 'PayableAmount'],
  };

  const regexes: Record<typeof field, Array<{ regex: RegExp; confidence: number }>> = {
    ht: [
      { regex: /\|\s*(?:total\s*ht|montant\s*ht|hors\s*taxes)\s*\|\s*([0-9][0-9\s.'’,]*(?:[,.][0-9]{2})?)\s*\|/i, confidence: 0.88 },
      { regex: /\|\s*abonnement\(s\)\s*\|\s*quantit[eé]\s*\|\s*prix\s+unit\.?\s*\|\s*([0-9][0-9\s.'’,]*(?:[,.][0-9]{2})?)\s*\|/i, confidence: 0.86 },
      { regex: /\b(?:total\s*ht|montant\s*ht|hors\s*taxes)\s*[:#-]?\s*([0-9][0-9\s.'’,]*(?:[,.][0-9]{2})?)\s*(?:€|eur|usd|gbp|chf)?/i, confidence: 0.88 },
      { regex: /\bp[eé]riode\s+factur[eé]e\b.{0,220}\bBC\s+([0-9][0-9\s.'’,]*(?:[,.][0-9]{2})?)\b/i, confidence: 0.74 },
    ],
    ttc: [
      { regex: /\|\s*(?:total\s*ttc|montant\s*ttc|net\s+a\s+payer|net\s+à\s+payer)\s*\|\s*([0-9][0-9\s.'’,]*(?:[,.][0-9]{2})?)\s*\|/i, confidence: 0.88 },
      { regex: /\b(?:total\s*ttc|montant\s*ttc|amount\s+due)\s*[:#-]?\s*([0-9][0-9\s.'’,]*(?:[,.][0-9]{2})?)\s*(?:€|eur|usd|gbp|chf)?/i, confidence: 0.88 },
      { regex: /\b(?:net\s+a\s+payer|net\s+à\s+payer)\b[^0-9]{0,35}([0-9][0-9\s.'’,]*(?:[,.][0-9]{2})?)\s*(?:€|eur|usd|gbp|chf)?/i, confidence: 0.86 },
    ],
  };

  const xmlValue = sourceFormat === 'XML'
    ? extractXmlTagValue(rawText, xmlTags[field])
    : undefined;
  const amountMatch = parseFirstAmountFromPatterns(text, regexes[field]);
  const amount = xmlValue ? parseAmount(xmlValue) : amountMatch.value;

  return amount !== undefined
    ? { value: amount, confidence: xmlValue ? 0.9 : amountMatch.confidence }
    : {};
}

function extractVatAmount(text: string, rawText: string, sourceFormat: InvoiceSourceFormat): CandidateMatch<number> {
  const xmlValue = sourceFormat === 'XML'
    ? extractXmlTagValue(rawText, ['TaxAmount', 'TotalTaxAmount'])
    : undefined;

  const amountMatch = parseFirstAmountFromPatterns(text, [
    { regex: /\b(?:montant\s+tva|total\s+tva)\s*[:#-]?\s*([0-9][0-9\s.'’,]*(?:[,.][0-9]{2})?)\s*(?:€|eur|usd|gbp|chf)?/i, confidence: 0.86 },
    { regex: /\btva\s*\d{1,2}(?:[.,]\d+)?%\s*[:#-]?\s*([0-9][0-9\s.'’,]*(?:[,.][0-9]{2})?)\s*(?:€|eur|usd|gbp|chf)?/i, confidence: 0.86 },
  ]);

  const amount = xmlValue ? parseAmount(xmlValue) : amountMatch.value;

  return amount !== undefined
    ? { value: amount, confidence: xmlValue ? 0.9 : amountMatch.confidence }
    : {};
}

function extractCustomerReference(text: string, rawText: string, sourceFormat: InvoiceSourceFormat): CandidateMatch<string> {
  const xmlValue = sourceFormat === 'XML'
    ? extractXmlTagValue(rawText, ['CustomerReference', 'BuyerReference'])
    : undefined;

  if (xmlValue) {
    return { value: xmlValue, confidence: 0.9 };
  }

  const idClientNumberNearLabel = text.match(/\bid\s+client\b(?:\s+facture)?\s+n[^0-9]{0,12}(\d{2,})(?![-/\d])/i);
  if (idClientNumberNearLabel?.[1]) {
    return { value: idClientNumberNearLabel[1], confidence: 0.97 };
  }

  const idClientDirect = text.match(/\bid\s+client\b(?:\s*n(?:[°ºo]|\s*o)?\.?)?\s*[:#-]?\s*(\d{2,})/i);
  if (idClientDirect?.[1]) {
    return { value: idClientDirect[1], confidence: 0.96 };
  }

  const labelledMatch = pickFirstMatch(text, [
    { regex: /\bid\s+client\s*n[°ºo]?\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{1,19})/i, confidence: 0.95 },
    { regex: /\bclient\s*:\s*[^[\n]{3,180}\[\s*([A-Z0-9][A-Z0-9/_-]{1,19})\s*\]/i, confidence: 0.94 },
    { regex: /\bid\s+client\b[^\n]{0,80}?\bn[°ºo]?\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{1,19})/i, confidence: 0.9 },
    { regex: /\b(?:id\s+client|reference\s+client|référence\s+client)\s*(?:n[°ºo]?|numero|numéro|number)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{1,19})/i, confidence: 0.9 },
  ]);

  if (labelledMatch.value && /\d/.test(labelledMatch.value)) {
    return labelledMatch;
  }

  const idClientNumber = text.match(/\bid\s+client\b[\s\S]{0,80}?(\d{2,})/i);
  return idClientNumber?.[1]
    ? { value: idClientNumber[1], confidence: 0.82 }
    : {};
}

function extractGigalisCustomerReference(rawText: string): CandidateMatch<string> {
  if (!/\bgigalis\b/i.test(rawText) && !/\b254\s*402\s*530\s*00011\b/.test(rawText)) {
    return {};
  }

  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const idClientIndex = lines.findIndex((line) => /ID\s+CLIENT/i.test(line));
  const searchText = idClientIndex >= 0
    ? lines.slice(idClientIndex, idClientIndex + 8).join('\n')
    : rawText.split(/ID\s+CLIENT/i)[1]?.slice(0, 240) ?? '';
  const explicitMatch = searchText.match(/ID\s+CLIENT[^0-9]{0,80}(\d{2,5})(?![-/\d])/i);
  if (explicitMatch?.[1]) {
    return { value: explicitMatch[1], confidence: 0.99 };
  }

  const bracketedClientReference = rawText.match(/\bClient\s*:\s*[^[]+\[(\d{2,})]/i)?.[1];
  return bracketedClientReference
    ? { value: bracketedClientReference, confidence: 0.95 }
    : {};
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

function cleanLabelCandidate(value: string): string {
  return compactWhitespace(sanitizeToken(value))
    .replace(/\s+(?:siret|facture|total|montant|page|num[eé]ro|n[°ºo]?)\b.*$/i, '')
    .trim();
}

function extractPublicCustomerName(text: string): CandidateMatch<string> {
  const clientMatch = text.match(/\bclient\s*:\s*([^[]+?)\s*\[[A-Z0-9/_-]+\]/i);
  const clientName = clientMatch?.[1] ? cleanLabelCandidate(clientMatch[1]) : '';
  if (clientName.length >= 4) {
    return {
      value: clientName,
      confidence: 0.88,
    };
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => compactWhitespace(line))
    .filter(Boolean);
  const serviceIndex = lines.findIndex((line) => /\b(?:comptabilite|comptabilité)\s+fournisseurs\b/i.test(line));
  const previousLine = serviceIndex > 0 ? cleanLabelCandidate(lines[serviceIndex - 1]) : '';
  if (
    previousLine.length >= 4
    && !/\b(?:tva|siret|facture|gigalis|courriel|tel)\b/i.test(previousLine)
  ) {
    return {
      value: previousLine,
      confidence: 0.9,
    };
  }

  const beforeServiceMatch = text.match(/\b([A-Z][A-ZÀ-ÖØ-Þ0-9'’ .-]{8,140}?)\s+(?:comptabilite|comptabilité)\s+fournisseurs\b/i);
  const beforeServiceName = beforeServiceMatch?.[1] ? cleanLabelCandidate(beforeServiceMatch[1]) : '';
  if (beforeServiceName.length >= 4) {
    return {
      value: beforeServiceName,
      confidence: 0.82,
    };
  }

  return {};
}

function extractServiceLabel(text: string): CandidateMatch<string> {
  const normalizedText = compactWhitespace(text);
  const explicitMatch = pickFirstMatch(normalizedText, [
    {
      regex: /\b(?:service\s+destinataire|service\s+executant|service\s+exécutant|service\s+facture)\s*[:#-]\s*([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9'’ ._/-]{2,80}?)(?=\s+(?:siret|num[eé]ro|n[°ºo]?|facture|total|montant|page)\b|$)/i,
      confidence: 0.9,
    },
    {
      regex: /\b((?:comptabilite|comptabilité)\s+fournisseurs)\b/i,
      confidence: 0.86,
    },
    {
      regex: /##\s*(?:[0-9]{3,8}\s*:)\s*([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9'’ ._/-]{6,140}?)(?=\s+(?:date|p[eé]riode|abonnement|\||powered)\b|$)/i,
      confidence: 0.78,
    },
  ]);
  const label = explicitMatch.value ? cleanLabelCandidate(explicitMatch.value) : '';

  if (label) {
    return {
      value: label,
      confidence: explicitMatch.confidence,
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

function completeDerivedTotals(fields: ExtractedInvoiceDraftData, text: string, fieldConfidences: number[]): void {
  if (fields.totalVat === undefined) {
    const inferredVatFromTotals = inferVatAmountFromHtAndTtc(fields.totalAmountHt, fields.totalAmountTtc);
    if (inferredVatFromTotals.value !== undefined) {
      fields.totalVat = inferredVatFromTotals.value;
      fieldConfidences.push(inferredVatFromTotals.confidence ?? 0.6);
    }
  }

  if (fields.totalVat === undefined) {
    const inferredVat = inferVatAmountFromHt(text, fields.totalAmountHt);
    if (inferredVat.value !== undefined) {
      fields.totalVat = inferredVat.value;
      fieldConfidences.push(inferredVat.confidence ?? 0.6);
    }
  }

  if (fields.totalAmountTtc === undefined) {
    const inferredTtc = inferTtcFromHtAndVat(fields.totalAmountHt, fields.totalVat);
    if (inferredTtc.value !== undefined) {
      fields.totalAmountTtc = inferredTtc.value;
      fieldConfidences.push(inferredTtc.confidence ?? 0.6);
    }
  }

  if (!fields.vatLines && fields.totalAmountHt !== undefined && fields.totalVat !== undefined) {
    fields.vatLines = [{
      rate: extractVatRate(text),
      baseHt: fields.totalAmountHt,
      taxAmount: fields.totalVat,
    }];
    fieldConfidences.push(0.66);
  }
}

export async function extractRawTextFromFile(file: File): Promise<string> {
  return decodeFileToText(file);
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

  fields.paymentMode = 'VIREMENT';
  fieldConfidences.push(1);

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

  completeDerivedTotals(fields, text, fieldConfidences);

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

  const explicitPublicCustomerName = extractPublicCustomerName(rawText || text);
  if (explicitPublicCustomerName.value) {
    fields.publicCustomerName = explicitPublicCustomerName.value;
    fieldConfidences.push(explicitPublicCustomerName.confidence ?? 0.6);
  }

  const templateResult = applyExtractionTemplates(rawText || text);
  if (templateResult) {
    Object.assign(fields, templateResult.fields);
    fieldConfidences.push(0.99);
    console.debug(`Extraction template "${templateResult.templateId}" applied`);
  }
  fields.paymentMode = 'VIREMENT';
  const gigalisCustomerReference = extractGigalisCustomerReference(rawText || text);
  if (gigalisCustomerReference.value) {
    fields.customerReference = gigalisCustomerReference.value;
    fieldConfidences.push(gigalisCustomerReference.confidence ?? 0.6);
  }

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
  if (publicCustomerCode.value && isValidExtractedDestinationCode(publicCustomerCode.value, references)) {
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
  if ((fields.publicServiceCode || fields.publicServiceLabel) && !fields.publicServiceId) {
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
    rawText,
    rawTextPreview: normalizeStructuredPdfText(rawText).slice(0, 900),
  };
}

/**
 * Main attachment upload payload builder for Chorus Pro API.
 *
 * Minimal working flow:
 * - POST /cpro/factures/v1/deposer/pdf
 * - then inject returned pieceJointeId into pieceJointePrincipale
 * - finalize /factures/v1/soumettre with modeDepot = DEPOT_PDF_SIGNE_API
 */

export interface UploadPdfPayload {
  pieceJointeExtension: string;
  pieceJointeFichier: string;
  pieceJointeNom: string;
  pieceJointeTypeMime: string;
}

function inferExtension(fileName: string): string {
  const match = fileName.trim().match(/\.([^.]+)$/);
  return match?.[1]?.toLowerCase() || 'pdf';
}

export function buildUploadPdfPayload(
  pdfBase64: string,
  fileName: string,
  mimeType: string = 'application/pdf',
): UploadPdfPayload {
  if (!pdfBase64 || !pdfBase64.trim()) {
    throw new Error('PDF base64 content cannot be empty');
  }

  if (!fileName || !fileName.trim()) {
    throw new Error('File name cannot be empty');
  }

  const normalizedFileName = fileName.toLowerCase().endsWith('.pdf')
    ? fileName
    : `${fileName}.pdf`;

  return {
    pieceJointeExtension: inferExtension(normalizedFileName),
    pieceJointeFichier: pdfBase64.trim(),
    pieceJointeNom: normalizedFileName,
    pieceJointeTypeMime: mimeType || 'application/pdf',
  };
}

/**
 * Validates an upload PDF payload before sending
 * 
 * @param payload - The payload to validate
 * @returns Object with valid flag and error messages if any
 */
export function validateUploadPdfPayload(
  payload: UploadPdfPayload,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!payload.pieceJointeFichier) {
    errors.push('pieceJointeFichier: base64 PDF content is required');
  } else if (payload.pieceJointeFichier.length < 100) {
    errors.push('pieceJointeFichier: appears too short to be valid base64 PDF content');
  }

  if (!payload.pieceJointeNom) {
    errors.push('pieceJointeNom: file name is required');
  } else if (!payload.pieceJointeNom.toLowerCase().endsWith('.pdf')) {
    errors.push('pieceJointeNom: must end with .pdf extension');
  }

  if (!payload.pieceJointeExtension) {
    errors.push('pieceJointeExtension: file extension is required');
  }

  if (!payload.pieceJointeTypeMime) {
    errors.push('pieceJointeTypeMime: mime type is required');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Creates a mock upload PDF payload for testing (with dummy base64)
 * 
 * @param fileName - Optional file name (defaults to 'facture-test.pdf')
 * @returns UploadPdfPayload with minimal valid base64 for testing
 */
export function createMockUploadPdfPayload(fileName: string = 'facture-test.pdf'): UploadPdfPayload {
  // Minimal valid PDF base64 header that won't cause parsing issues
  // This is NOT a real PDF but a valid base64 string starting with PDF magic bytes
  const minimalPdfBase64 = 'JVBERi0xLjQKJeLjz9CNaIHDrVjoN2V2dChkYXRhKQoxIDAgb2JqCjw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+CmVuZG9iagoyIDAgb2JqCjw8L1R5cGUvUGFnZXMvS2lkc1szIDAgUl0vQ291bnQgMT4+CmVuZG9iagozIDAgb2JqCjw8L1R5cGUvUGFnZS9QYXJlbnQgMiAwIFIvTWVkaWFCb3hbMCAwIDYxMiA3OTJdL0NvbnRlbnRzIDQgMCBSPj4KZW5kb2JqCjQgMCBvYmoKPDwvTGVuZ3RoIDQ0Pj4Kc3RyZWFtCkJUIC9GMSAxMiBUZiAxMDAgNzUwIFRkIChIZWxsbyB3b3JsZCkgVGoKRVQKZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgNQowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyMTcgMDAwMDAgbiAKdHJhaWxlcgo8PC9TaXplIDUvUm9vdCAxIDAgUj4+CnN0YXJ0eHJlZgozMTAKJSVFT0Y=';

  return buildUploadPdfPayload(minimalPdfBase64, fileName, 'application/pdf');
}

/**
 * PDF Upload Payload Builder for Chorus Pro API
 * 
 * Handles construction of upload payloads for the /deposer/pdf endpoint
 * which expects: fichierFacture (base64), formatDepot, nomFichier
 */

export interface UploadPdfPayload {
  idUtilisateurCourant?: number;
  fichierFacture: string;
  formatDepot: 'PDF_NON_SIGNE' | 'PDF_SIGNE';
  nomFichier: string;
}

/**
 * Builds an upload PDF payload for Chorus /deposer/pdf endpoint
 * 
 * @param pdfBase64 - Base64-encoded PDF content
 * @param fileName - Original PDF filename (used for context only in most cases)
 * @param isSigned - Whether the PDF is digitally signed (defaults to false)
 * @returns UploadPdfPayload ready to send to Chorus API
 */
export function buildUploadPdfPayload(
  pdfBase64: string,
  fileName: string,
  isSigned: boolean = false,
  idUtilisateurCourant?: number,
): UploadPdfPayload {
  if (!pdfBase64 || !pdfBase64.trim()) {
    throw new Error('PDF base64 content cannot be empty');
  }

  if (!fileName || !fileName.trim()) {
    throw new Error('File name cannot be empty');
  }

  // Ensure filename ends with .pdf
  const normalizedFileName = fileName.toLowerCase().endsWith('.pdf')
    ? fileName
    : `${fileName}.pdf`;

  return {
    idUtilisateurCourant,
    fichierFacture: pdfBase64.trim(),
    formatDepot: isSigned ? 'PDF_SIGNE' : 'PDF_NON_SIGNE',
    nomFichier: normalizedFileName,
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

  if (!payload.fichierFacture) {
    errors.push('fichierFacture: base64 PDF content is required');
  } else if (payload.fichierFacture.length < 100) {
    errors.push('fichierFacture: appears too short to be valid base64 PDF content');
  }

  if (payload.idUtilisateurCourant === undefined || !Number.isFinite(payload.idUtilisateurCourant)) {
    errors.push('idUtilisateurCourant: Chorus current user id is required');
  }

  if (!payload.nomFichier) {
    errors.push('nomFichier: file name is required');
  } else if (!payload.nomFichier.toLowerCase().endsWith('.pdf')) {
    errors.push('nomFichier: must end with .pdf extension');
  }

  if (!payload.formatDepot || !['PDF_NON_SIGNE', 'PDF_SIGNE'].includes(payload.formatDepot)) {
    errors.push('formatDepot: must be "PDF_NON_SIGNE" or "PDF_SIGNE"');
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

  return buildUploadPdfPayload(minimalPdfBase64, fileName, false, 331);
}

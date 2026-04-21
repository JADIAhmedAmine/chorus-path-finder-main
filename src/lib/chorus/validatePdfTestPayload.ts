/**
 * PDF Test Payload Validation Helpers
 * 
 * Validates test payloads for PDF upload and invoice submission workflows
 */

import type { UploadPdfPayload } from '@/lib/chorus/buildUploadPdfPayload';
import type { ChorusSubmissionPayload } from '@/lib/chorus/types';

export interface ValidationError {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

/**
 * Validates the main attachment upload payload for test readiness.
 */
export function validateTestUploadPdfPayload(payload: UploadPdfPayload): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  // Required field checks
  if (!payload.pieceJointeFichier) {
    errors.push({
      field: 'pieceJointeFichier',
      message: 'PDF content is required',
      severity: 'error',
    });
  } else if (payload.pieceJointeFichier.length < 200) {
    warnings.push({
      field: 'pieceJointeFichier',
      message: 'PDF content appears unusually short - may be a test/mock PDF',
      severity: 'warning',
    });
  }

  if (!payload.pieceJointeNom) {
    errors.push({
      field: 'pieceJointeNom',
      message: 'Filename is required',
      severity: 'error',
    });
  } else if (!payload.pieceJointeNom.toLowerCase().endsWith('.pdf')) {
    errors.push({
      field: 'pieceJointeNom',
      message: 'Filename must end with .pdf extension',
      severity: 'error',
    });
  }

  if (!payload.pieceJointeExtension) {
    errors.push({
      field: 'pieceJointeExtension',
      message: 'File extension is required',
      severity: 'error',
    });
  }

  if (!payload.pieceJointeTypeMime) {
    errors.push({
      field: 'pieceJointeTypeMime',
      message: 'MIME type is required',
      severity: 'error',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validates that a PDF submission payload is ready for testing
 * Specific checks for DEPOT_PDF_API mode with file ID
 */
export function validateTestPdfSubmissionPayload(payload: ChorusSubmissionPayload): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  // Mode validation
  if (payload.modeDepot !== 'DEPOT_PDF_API') {
    errors.push({
      field: 'modeDepot',
      message: `Expected DEPOT_PDF_API for PDF submission, got ${payload.modeDepot}`,
      severity: 'error',
    });
  }

  // Check that main attachment exists and has ID
  if (!payload.pieceJointePrincipale || payload.pieceJointePrincipale.length === 0) {
    errors.push({
      field: 'pieceJointePrincipale',
      message: 'Main attachment is required for DEPOT_PDF_API mode',
      severity: 'error',
    });
  } else if (!payload.pieceJointePrincipale[0]?.pieceJointePrincipaleId) {
    errors.push({
      field: 'pieceJointePrincipale[0].pieceJointePrincipaleId',
      message: 'File ID must be provided from PDF upload response',
      severity: 'error',
    });
  }

  // Core required fields
  if (!payload.dateFacture) {
    errors.push({
      field: 'dateFacture',
      message: 'Invoice date is required',
      severity: 'error',
    });
  }

  if (!payload.numeroFactureSaisi) {
    errors.push({
      field: 'numeroFactureSaisi',
      message: 'Invoice number is required',
      severity: 'error',
    });
  }

  if (!payload.montantTotal) {
    errors.push({
      field: 'montantTotal',
      message: 'Total amounts are required',
      severity: 'error',
    });
  } else {
    // Check amount balance
    const { montantHtTotal, montantTVA, montantTtcTotal } = payload.montantTotal;
    const expectedTtc = (montantHtTotal ?? 0) + (montantTVA ?? 0);
    const balance = Math.abs(expectedTtc - (montantTtcTotal ?? 0));

    if (balance > 0.1) {
      errors.push({
        field: 'montantTotal',
        message: `Amount imbalance: TTC (${montantTtcTotal}) should equal HT (${montantHtTotal}) + VAT (${montantTVA})`,
        severity: 'error',
      });
    }
  }

  // Line items check
  if (!payload.lignePoste || payload.lignePoste.length === 0) {
    warnings.push({
      field: 'lignePoste',
      message: 'No line items found - invoice should have at least one line',
      severity: 'warning',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validates that a SAISIE_API submission payload is ready for testing
 * Specific checks for data-entry mode without PDF
 */
export function validateTestSaisieApiPayload(payload: ChorusSubmissionPayload): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  // Mode validation
  if (payload.modeDepot !== 'SAISIE_API') {
    errors.push({
      field: 'modeDepot',
      message: `Expected SAISIE_API, got ${payload.modeDepot}`,
      severity: 'error',
    });
  }

  // Check that NO attachment is present
  if (payload.pieceJointePrincipale && payload.pieceJointePrincipale.length > 0) {
    errors.push({
      field: 'pieceJointePrincipale',
      message: 'SAISIE_API mode must have empty pieceJointePrincipale array',
      severity: 'error',
    });
  }

  // Basic required fields
  if (!payload.numeroFactureSaisi) {
    errors.push({
      field: 'numeroFactureSaisi',
      message: 'Invoice number is required',
      severity: 'error',
    });
  }

  if (!payload.dateFacture) {
    errors.push({
      field: 'dateFacture',
      message: 'Invoice date is required',
      severity: 'error',
    });
  }

  if (!payload.destinataire?.codeDestinataire) {
    errors.push({
      field: 'destinataire.codeDestinataire',
      message: 'Recipient code is required',
      severity: 'error',
    });
  }

  if (payload.fournisseur?.idFournisseur === undefined) {
    errors.push({
      field: 'fournisseur.idFournisseur',
      message: 'Supplier ID is required (must come from Chorus context)',
      severity: 'error',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Formats validation result for readable output
 */
export function formatValidationResult(result: ValidationResult): string {
  const lines: string[] = [];

  if (result.valid) {
    lines.push('✓ Validation PASSED');
  } else {
    lines.push('✗ Validation FAILED');
  }

  if (result.errors.length > 0) {
    lines.push('\nErrors:');
    result.errors.forEach((e) => {
      lines.push(`  • ${e.field}: ${e.message}`);
    });
  }

  if (result.warnings.length > 0) {
    lines.push('\nWarnings:');
    result.warnings.forEach((w) => {
      lines.push(`  ⚠ ${w.field}: ${w.message}`);
    });
  }

  return lines.join('\n');
}

export type ChorusConnectorMode = 'mock' | 'direct';

export interface ChorusConfig {
  enabled: boolean;
  mode: ChorusConnectorMode;
  tokenUrl: string;
  apiBaseUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  technicalLogin: string;
  technicalPassword: string;
  connectionTestPath: string;
  uploadFilePath: string;
  submitInvoicePath: string;
}

export interface ChorusConnectionResult {
  ok: boolean;
  message: string;
  tokenPreview?: string;
  response?: unknown;
}

export interface ChorusUploadedFile {
  id: string;
  filename: string;
  response?: unknown;
}

export interface ChorusSubmitInvoiceInput {
  invoiceData: Record<string, unknown>;
  mainFile: File;
  attachments: File[];
}

export interface ChorusSubmitInvoiceResult {
  ok: boolean;
  externalId?: string;
  uploadedFiles: ChorusUploadedFile[];
  response?: unknown;
}

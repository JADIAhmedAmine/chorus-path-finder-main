import type { ExtractedInvoiceDraftData } from '@/lib/chorus/types';

export interface ExtractionTemplate {
  id: string;
  matches(rawText: string): boolean;
  extract(rawText: string): Partial<ExtractedInvoiceDraftData>;
}

export interface TemplateExtractionResult {
  templateId: string;
  fields: Partial<ExtractedInvoiceDraftData>;
}

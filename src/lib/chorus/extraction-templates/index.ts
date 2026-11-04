import { gigalisTemplate } from './gigalis';
import type { ExtractionTemplate, TemplateExtractionResult } from './types';

const REGISTERED_TEMPLATES: ExtractionTemplate[] = [
  gigalisTemplate,
];

export function applyExtractionTemplates(rawText: string): TemplateExtractionResult | undefined {
  if (!rawText) {
    return undefined;
  }

  for (const template of REGISTERED_TEMPLATES) {
    if (template.matches(rawText)) {
      return {
        templateId: template.id,
        fields: template.extract(rawText),
      };
    }
  }

  return undefined;
}

export type { ExtractionTemplate, TemplateExtractionResult };

import { buildChorusSubmissionPayloadFromDraft } from '@/lib/chorus/buildSubmissionPayload';
import type {
  ChorusPayloadBuildContext,
  ChorusSubmissionPayload,
  InvoiceDraftFormData,
} from '@/lib/chorus/types';

export function buildInvoiceSubmissionPayload(
  formData: InvoiceDraftFormData,
  context: ChorusPayloadBuildContext = {},
): ChorusSubmissionPayload {
  return buildChorusSubmissionPayloadFromDraft(formData, context);
}

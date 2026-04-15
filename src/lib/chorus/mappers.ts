export interface InvoiceDraftFormData {
  supplierOrganizationId: string;
  supplierInvoiceNumber: string;
  publicCustomerId: string;
  publicServiceId: string;
  engagementNumber: string;
  marketNumber: string;
  purchaseOrderNumber: string;
}

export function buildInvoiceSubmissionPayload(formData: InvoiceDraftFormData): Record<string, unknown> {
  return {
    supplierOrganizationId: formData.supplierOrganizationId || undefined,
    supplierInvoiceNumber: formData.supplierInvoiceNumber || undefined,
    publicCustomerId: formData.publicCustomerId || undefined,
    publicServiceId: formData.publicServiceId || undefined,
    engagementNumber: formData.engagementNumber || undefined,
    marketNumber: formData.marketNumber || undefined,
    purchaseOrderNumber: formData.purchaseOrderNumber || undefined,
    submittedFrom: 'ui',
    requestedAt: new Date().toISOString(),
  };
}

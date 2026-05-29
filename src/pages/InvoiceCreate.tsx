import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { HTMLAttributes } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Upload, FileText, X, CheckCircle, Loader2, Sparkles, TriangleAlert, Eye, FolderOpen, Send } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useReferenceCatalog } from '@/hooks/use-reference-catalog';
import { ChorusApiReturnSummaryPanel } from '@/components/common/ChorusApiReturnSummaryPanel';
import { getInvoice, getInvoiceAttachments } from '@/data/mock-data';
import { canSubmitInvoices } from '@/lib/auth/session';
import { ChorusSubmitApiError, createChorusConnector } from '@/lib/chorus/client';
import { buildInvoiceSubmissionPayload } from '@/lib/chorus/mappers';
import { createEmptyInvoiceDraft, formatInvoiceAmountForInput, mergeExtractionIntoDraft, parseInvoiceAmount } from '@/lib/chorus/normalization';
import { loadChorusConfig, resolveChorusRuntimeConfig } from '@/lib/chorus/storage';
import { prepareInvoiceSubmission } from '@/lib/chorus/preparation';
import { extractInvoiceData } from '@/lib/chorus/extraction';
import { buildChorusTechnicalContext } from '@/lib/chorus/technicalContext';
import { ChorusTransversesClient } from '@/lib/chorus/transversesClient';
import { validateChorusSubmissionPayload } from '@/lib/chorus/validateSubmissionPayload';
import { celebrateSuccess } from '@/lib/celebration';
import { buildChorusDebugFile } from '@/lib/chorus/debug';
import { describeChorusSubmissionApiReturn, type ChorusApiReturnSummary } from '@/lib/chorus/submissionApiReturn';
import {
  resolveAndHydrateChorusSubmissionPayload,
  type ChorusPayloadHydrationResult,
} from '@/lib/chorus/hydrateSubmissionPayload';
import type { PublicCustomer, PublicService } from '@/types';
import type { ChorusPaymentMode, ChorusSubmissionPayload, InvoiceDraftFormData, LocalInvoiceExtractionResult } from '@/lib/chorus/types';
import type { ChorusApiDebugEntry, ChorusSubmissionReferenceSnapshot, ChorusSubmitInvoiceResult } from '@/types/chorus';

const SHOW_DEV_TOOLS = import.meta.env.VITE_SHOW_DEV_TOOLS === 'true';
const NO_PUBLIC_SERVICE_VALUE = '__no_public_service__';

type BatchSubmissionStatus = 'pending' | 'extracting' | 'ready' | 'submitting' | 'success' | 'error';

interface BatchSubmissionResult {
  id: string;
  file: File;
  displayPath: string;
  status: BatchSubmissionStatus;
  message?: string;
  invoiceNumber?: string;
  externalId?: string;
  extraction?: LocalInvoiceExtractionResult;
  draft?: InvoiceDraftFormData;
  payload?: ChorusSubmissionPayload;
  summary?: ChorusApiReturnSummary | null;
  apiCalls: ChorusApiDebugEntry[];
}

interface ComplementaryAttachmentDraft {
  id: string;
  file: File;
  designation: string;
  type: string;
  lineNumber: string;
  liaisonId: string;
}

const DEFAULT_COMPLEMENTARY_ATTACHMENT_TYPE = 'DIVERS';
const COMPLEMENTARY_ATTACHMENT_TYPES = [
  { value: 'DIVERS', label: 'Document annexe' },
  { value: 'ATTESTATION', label: 'Attestation administrative' },
  { value: 'BC', label: 'Bon de commande' },
  { value: 'BL', label: 'Bon de livraison' },
  { value: 'BORDEREAU_SUIVI', label: 'Bordereau de suivi' },
  { value: 'BORDEREAU_SUIVI_VALIDATION', label: 'Bordereau de suivi de validation' },
  { value: 'DEVIS', label: 'Devis' },
  { value: 'ECHEANCIER', label: 'Échéancier' },
  { value: 'OS', label: 'Ordre de service' },
  { value: 'PVSF', label: 'Procès-verbal de service fait' },
  { value: 'RIB', label: 'Relevé d\'identité bancaire' },
] as const;
const PAYMENT_MODE_OPTIONS: Array<{ value: ChorusPaymentMode; label: string }> = [
  { value: 'VIREMENT', label: 'Virement' },
  { value: 'CHEQUE', label: 'Chèque' },
  { value: 'PRELEVEMENT', label: 'Prélèvement' },
  { value: 'ESPECE', label: 'Espèce' },
  { value: 'AUTRE', label: 'Autre' },
  { value: 'REPORT', label: 'Report' },
];

function formatAmountForDisplay(value?: string): string {
  if (!value?.trim()) {
    return 'Non détecté';
  }

  return value;
}

function formatExtractedAmountForDisplay(value?: number): string | undefined {
  if (value === undefined || Number.isNaN(value)) {
    return undefined;
  }

  return value.toFixed(2).replace('.', ',');
}

function normalizeReferenceLookup(value?: string): string {
  return value?.trim().replace(/\s/g, '').toLowerCase() ?? '';
}

function normalizeOptionalServiceCode(value?: string): string {
  const trimmed = value?.trim() ?? '';
  return trimmed === '0' || trimmed === '00' || trimmed === '01' ? '' : trimmed;
}

function isSupportedInvoiceFile(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  return file.type === 'application/pdf'
    || file.type === 'text/xml'
    || lowerName.endsWith('.pdf')
    || lowerName.endsWith('.xml');
}

function getFileDisplayPath(file: File): string {
  const fileWithPath = file as File & { webkitRelativePath?: string };
  return fileWithPath.webkitRelativePath || file.name;
}

function buildBatchResultId(file: File, index: number): string {
  return `${file.name}-${file.size}-${file.lastModified}-${index}`;
}

function buildComplementaryAttachmentDraft(file: File, index: number): ComplementaryAttachmentDraft {
  return {
    id: `${file.name}-${file.size}-${file.lastModified}-${index}-${Date.now()}`,
    file,
    designation: file.name,
    type: DEFAULT_COMPLEMENTARY_ATTACHMENT_TYPE,
    lineNumber: '',
    liaisonId: '',
  };
}

function parseOptionalPositiveInteger(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function getBatchStatusLabel(status: BatchSubmissionStatus): string {
  if (status === 'extracting') {
    return 'Extraction';
  }

  if (status === 'submitting') {
    return 'Soumission';
  }

  if (status === 'ready') {
    return 'Prête';
  }

  if (status === 'success') {
    return 'Réussie';
  }

  if (status === 'error') {
    return 'Échec';
  }

  return 'En attente';
}

function getBatchStatusBadgeVariant(status: BatchSubmissionStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'success') {
    return 'default';
  }

  if (status === 'error') {
    return 'destructive';
  }

  if (status === 'pending') {
    return 'outline';
  }

  return 'secondary';
}

function isBatchResultSubmittable(
  result: BatchSubmissionResult,
): result is BatchSubmissionResult & { draft: InvoiceDraftFormData; extraction: LocalInvoiceExtractionResult } {
  return (result.status === 'ready' || result.status === 'error')
    && Boolean(result.draft && result.extraction && result.payload);
}

function normalizeForServiceMatch(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function findServiceInRawText(
  services: Array<{ id: string; codeServiceExecutant: string; label: string }>,
  rawText: string,
): { id: string; codeServiceExecutant: string; label: string } | undefined {
  if (services.length === 0 || !rawText) {
    return undefined;
  }
  const normalizedText = normalizeForServiceMatch(rawText);
  return services.find((service) => {
    const code = normalizeForServiceMatch(service.codeServiceExecutant);
    const label = normalizeForServiceMatch(service.label);
    return Boolean(
      (code && normalizedText.includes(code))
        || (label && normalizedText.includes(label)),
    );
  });
}

function ExtractionInfoRow({ label, value, index = 0 }: { label: string; value?: string; index?: number }) {
  return (
    <div
      className="rounded-lg border bg-muted/20 p-3 animate-fade-in-up"
      style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
    >
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium">{value || 'Non détecté'}</p>
    </div>
  );
}

function DocumentPreviewCard({
  file,
  previewUrl,
  extractedText,
  rawTextPreview,
}: {
  file: File;
  previewUrl?: string;
  extractedText: string;
  rawTextPreview: string;
}) {
  const canPreviewPdf = Boolean(previewUrl);
  const defaultTab = canPreviewPdf ? 'pdf' : 'text';

  return (
    <Dialog>
      <div className="rounded-lg border bg-muted/20 p-3 md:col-span-3">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Aperçu document</p>
        <div className="mt-2 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium">{file.name}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {rawTextPreview || 'Cliquez pour ouvrir le PDF et le texte extrait.'}
            </p>
          </div>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Eye className="mr-2 h-4 w-4" />
              Ouvrir l’aperçu
            </Button>
          </DialogTrigger>
        </div>
      </div>

      <DialogContent className="h-[88vh] max-w-6xl">
        <DialogHeader>
          <DialogTitle>Aperçu du document</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue={defaultTab} className="flex h-full flex-col">
          <TabsList className="w-fit">
            {canPreviewPdf && <TabsTrigger value="pdf">PDF original</TabsTrigger>}
            <TabsTrigger value="text">Texte extrait</TabsTrigger>
          </TabsList>

          {canPreviewPdf && (
            <TabsContent value="pdf" className="mt-4 flex-1">
              <iframe
                src={previewUrl}
                title={`Aperçu PDF ${file.name}`}
                className="h-[68vh] w-full rounded-lg border"
              />
            </TabsContent>
          )}

          <TabsContent value="text" className="mt-4 flex-1">
            <div className="h-[68vh] overflow-auto rounded-lg border bg-muted/20 p-4">
              <pre className="whitespace-pre-wrap break-words text-sm">
                {extractedText || 'Texte non extrait.'}
              </pre>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function BatchDocumentPreview({ result }: { result: BatchSubmissionResult }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    const isPdf = result.file.type === 'application/pdf' || result.file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      setPreviewUrl(null);
      return undefined;
    }

    const objectUrl = URL.createObjectURL(result.file);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [result.file]);

  return (
    <DocumentPreviewCard
      file={result.file}
      previewUrl={previewUrl ?? undefined}
      extractedText={result.extraction?.rawText ?? ''}
      rawTextPreview={result.extraction?.rawTextPreview ?? ''}
    />
  );
}

type EditableBatchDraftTextField = Extract<keyof InvoiceDraftFormData,
  | 'supplierName'
  | 'supplierSiret'
  | 'supplierInvoiceNumber'
  | 'publicCustomerName'
  | 'publicCustomerCode'
  | 'publicServiceCode'
  | 'publicServiceLabel'
  | 'invoiceDate'
  | 'dueDate'
  | 'currencyCode'
  | 'engagementNumber'
  | 'marketNumber'
  | 'purchaseOrderNumber'
  | 'totalAmountHt'
  | 'totalAmountTtc'
>;

function BatchDraftInput({
  label,
  value,
  disabled,
  type = 'text',
  inputMode,
  onChange,
}: {
  label: string;
  value?: string;
  disabled: boolean;
  type?: 'text' | 'date';
  inputMode?: HTMLAttributes<HTMLInputElement>['inputMode'];
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        type={type}
        inputMode={inputMode}
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function BatchExtractionEditor({
  result,
  disabled,
  publicCustomers,
  publicServices,
  onDraftChange,
}: {
  result: BatchSubmissionResult;
  disabled: boolean;
  publicCustomers: PublicCustomer[];
  publicServices: PublicService[];
  onDraftChange: (id: string, patch: Partial<InvoiceDraftFormData>) => void;
}) {
  const { draft, extraction } = result;
  const [totalVatInput, setTotalVatInput] = useState('');

  useEffect(() => {
    setTotalVatInput(formatInvoiceAmountForInput(draft?.totalVat));
  }, [draft?.totalVat, result.id]);

  if (!draft || !extraction) {
    return (
      <p className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
        L’aperçu des champs sera disponible après l’extraction de cette facture.
      </p>
    );
  }

  const fields = extraction.fields;
  const updateTextField = (field: EditableBatchDraftTextField) => (value: string) => {
    const nextValue = field === 'supplierSiret'
      ? value.replace(/\D/g, '')
      : field === 'publicServiceCode' || field === 'publicServiceLabel'
        ? normalizeOptionalServiceCode(value)
      : field === 'currencyCode'
        ? value.toUpperCase().slice(0, 3)
        : value;
    const patch: Partial<InvoiceDraftFormData> = { [field]: nextValue };

    if (field === 'totalAmountHt' || field === 'totalAmountTtc') {
      patch.lineItems = undefined;
      patch.vatLines = undefined;
    }
    if (field === 'publicCustomerCode') {
      patch.publicServiceId = '';
      patch.publicServiceCode = '';
      patch.publicServiceLabel = '';
    }

    onDraftChange(result.id, patch);
  };
  const commitTotalVat = () => {
    onDraftChange(result.id, {
      totalVat: parseInvoiceAmount(totalVatInput),
      vatLines: undefined,
    });
  };
  const lineItemCount = fields.lineItems?.length
    ? `${fields.lineItems.length} ligne(s) détectée(s)`
    : undefined;
  const vatLineCount = fields.vatLines?.length
    ? `${fields.vatLines.length} taux détecté(s)`
    : undefined;
  const readOnlyRows = [
    { label: 'Lignes facture', value: lineItemCount },
    { label: 'Lignes TVA', value: vatLineCount },
    { label: 'Confiance extraction', value: `${Math.round(extraction.confidence * 100)}%` },
  ];
  const typedPublicCustomerCode = normalizeReferenceLookup(draft.publicCustomerCode);
  const selectedBatchPublicCustomer = publicCustomers.find((customer) => customer.id === draft.publicCustomerId)
    ?? publicCustomers.find((customer) => (
      Boolean(typedPublicCustomerCode)
      && (
        normalizeReferenceLookup(customer.codeDestinataire) === typedPublicCustomerCode
        || normalizeReferenceLookup(customer.siret) === typedPublicCustomerCode
      )
    ));
  const batchServices = selectedBatchPublicCustomer
    ? publicServices.filter((service) => service.publicCustomerId === selectedBatchPublicCustomer.id && service.active)
    : [];
  const selectedBatchPublicService = batchServices.find((service) => service.id === draft.publicServiceId);
  const handlePublicCustomerSelect = (customerId: string) => {
    const customer = publicCustomers.find((item) => item.id === customerId);
    if (!customer) {
      return;
    }

    onDraftChange(result.id, {
      publicCustomerId: customer.id,
      publicCustomerCode: customer.codeDestinataire || customer.siret,
      publicCustomerName: customer.legalName,
      publicServiceId: '',
      publicServiceCode: '',
      publicServiceLabel: '',
    });
  };
  const handlePublicServiceSelect = (serviceId: string) => {
    if (serviceId === NO_PUBLIC_SERVICE_VALUE) {
      onDraftChange(result.id, {
        publicServiceId: '',
        publicServiceCode: '',
        publicServiceLabel: '',
      });
      return;
    }

    const service = batchServices.find((item) => item.id === serviceId);
    if (!service) {
      return;
    }

    onDraftChange(result.id, {
      publicServiceId: service.id,
      publicServiceCode: service.codeServiceExecutant,
      publicServiceLabel: service.label,
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-background p-3">
        <div className="mb-3">
          <p className="text-sm font-medium">Données facture</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Vérifiez et corrigez les champs extraits avant l’envoi de cette facture à Chorus.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <BatchDraftInput label="Fournisseur" value={draft.supplierName ?? fields.supplierName} disabled={disabled} onChange={updateTextField('supplierName')} />
          <BatchDraftInput label="SIRET fournisseur" value={draft.supplierSiret ?? fields.supplierSiret} disabled={disabled} inputMode="numeric" onChange={updateTextField('supplierSiret')} />
          <BatchDraftInput label="N° facture" value={draft.supplierInvoiceNumber} disabled={disabled} onChange={updateTextField('supplierInvoiceNumber')} />
          <div className="space-y-2">
            <Label>Client public</Label>
            <Select
              value={selectedBatchPublicCustomer?.id ?? ''}
              disabled={disabled}
              onValueChange={handlePublicCustomerSelect}
            >
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner..." />
              </SelectTrigger>
              <SelectContent>
                {publicCustomers.filter((customer) => customer.active).map((customer) => (
                  <SelectItem key={customer.id} value={customer.id}>
                    {customer.legalName} ({customer.codeDestinataire})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Ou saisir le code destinataire / SIRET"
              value={draft.publicCustomerCode ?? fields.publicCustomerSiret ?? ''}
              disabled={disabled}
              onChange={(event) => updateTextField('publicCustomerCode')(event.target.value)}
            />
            {(draft.publicCustomerName || fields.publicCustomerName) && (
              <p className="text-xs text-muted-foreground">{draft.publicCustomerName ?? fields.publicCustomerName}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Service destinataire</Label>
            <Select
              value={selectedBatchPublicService?.id ?? NO_PUBLIC_SERVICE_VALUE}
              disabled={disabled || !selectedBatchPublicCustomer}
              onValueChange={handlePublicServiceSelect}
            >
              <SelectTrigger>
                <SelectValue placeholder={selectedBatchPublicCustomer ? 'Aucun service destinataire' : 'Choisir un client d’abord'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PUBLIC_SERVICE_VALUE}>Aucun service destinataire</SelectItem>
                {batchServices.map((service) => (
                  <SelectItem key={service.id} value={service.id}>
                    {service.codeServiceExecutant} — {service.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Ou saisir le code service exécutant"
              value={normalizeOptionalServiceCode(draft.publicServiceCode ?? fields.publicServiceCode)}
              disabled={disabled}
              onChange={(event) => updateTextField('publicServiceCode')(event.target.value)}
            />
          </div>
          <BatchDraftInput label="Libellé service" value={normalizeOptionalServiceCode(draft.publicServiceLabel ?? fields.publicServiceLabel)} disabled={disabled} onChange={updateTextField('publicServiceLabel')} />
          <BatchDraftInput label="Date facture" value={draft.invoiceDate} disabled={disabled} type="date" onChange={updateTextField('invoiceDate')} />
          <BatchDraftInput label="Échéance" value={draft.dueDate ?? fields.dueDate} disabled={disabled} type="date" onChange={updateTextField('dueDate')} />
          <div className="space-y-2">
            <Label>Mode paiement</Label>
            <Select
              value={draft.paymentMode || fields.paymentMode || 'VIREMENT'}
              disabled={disabled}
              onValueChange={(value) => onDraftChange(result.id, { paymentMode: value as ChorusPaymentMode })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_MODE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <BatchDraftInput label="Devise" value={draft.currencyCode ?? fields.currencyCode ?? 'EUR'} disabled={disabled} onChange={updateTextField('currencyCode')} />
          <BatchDraftInput label="Engagement" value={draft.engagementNumber} disabled={disabled} onChange={updateTextField('engagementNumber')} />
          <BatchDraftInput label="Marché" value={draft.marketNumber} disabled={disabled} onChange={updateTextField('marketNumber')} />
          <BatchDraftInput label="Bon de commande" value={draft.purchaseOrderNumber} disabled={disabled} onChange={updateTextField('purchaseOrderNumber')} />
          <BatchDraftInput label="Montant HT" value={draft.totalAmountHt} disabled={disabled} inputMode="decimal" onChange={updateTextField('totalAmountHt')} />
          <div className="space-y-2">
            <Label>Montant TVA</Label>
            <Input
              inputMode="decimal"
              value={totalVatInput}
              disabled={disabled}
              onBlur={commitTotalVat}
              onChange={(event) => setTotalVatInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur();
                }
              }}
            />
          </div>
          <BatchDraftInput label="Montant TTC" value={draft.totalAmountTtc} disabled={disabled} inputMode="decimal" onChange={updateTextField('totalAmountTtc')} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {readOnlyRows.map((row, index) => (
          <ExtractionInfoRow key={`${result.id}-${row.label}`} index={index} label={row.label} value={row.value} />
        ))}
      </div>

      {extraction.warnings.length > 0 && (
        <Alert>
          <TriangleAlert className="h-4 w-4" />
          <AlertTitle>Points à contrôler</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">
              {extraction.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

export default function InvoiceCreate() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const [mainFile, setMainFile] = useState<File | null>(null);
  const [attachments, setAttachments] = useState<ComplementaryAttachmentDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState<InvoiceDraftFormData>(createEmptyInvoiceDraft);
  const [extracting, setExtracting] = useState(false);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [extractionResult, setExtractionResult] = useState<LocalInvoiceExtractionResult | null>(null);
  const [mainFilePreviewUrl, setMainFilePreviewUrl] = useState<string | null>(null);
  const [lastSubmissionError, setLastSubmissionError] = useState<string | null>(null);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [exportingDebugFile, setExportingDebugFile] = useState(false);
  const [loadingTransverses, setLoadingTransverses] = useState(false);
  const [transversesError, setTransversesError] = useState<string | null>(null);
  const [transversesSnapshot, setTransversesSnapshot] = useState<ChorusSubmissionReferenceSnapshot | null>(null);
  const [resolvedSubmission, setResolvedSubmission] = useState<ChorusPayloadHydrationResult | null>(null);
  const [lastSubmissionResult, setLastSubmissionResult] = useState<ChorusSubmitInvoiceResult | null>(null);
  const [lastApiCalls, setLastApiCalls] = useState<ChorusApiDebugEntry[]>([]);
  const [showOptionalMetadata, setShowOptionalMetadata] = useState(false);
  const showAdvancedTools = SHOW_DEV_TOOLS;
  const [showSubmissionApiReturn, setShowSubmissionApiReturn] = useState(false);
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [batchResults, setBatchResults] = useState<BatchSubmissionResult[]>([]);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [batchCurrentFile, setBatchCurrentFile] = useState<string | null>(null);
  const [batchAttachments, setBatchAttachments] = useState<Record<string, ComplementaryAttachmentDraft[]>>({});
  const [prefilledInvoiceId, setPrefilledInvoiceId] = useState<string | null>(null);
  const [skipNextExtraction, setSkipNextExtraction] = useState(false);
  const treatmentDetailsRef = useRef<HTMLDivElement | null>(null);
  const submissionErrorRef = useRef<HTMLDivElement | null>(null);
  const submissionResultRef = useRef<HTMLDivElement | null>(null);
  const batchFolderInputRef = useRef<HTMLInputElement | null>(null);
  const editingInvoiceId = searchParams.get('invoiceId');
  const {
    suppliers,
    publicCustomers,
    publicServices,
    metadata: referenceCatalogMetadata,
    loading: loadingReferences,
    error: referenceCatalogError,
  } = useReferenceCatalog(undefined, {
    includeSuppliers: true,
    includePublicCustomers: true,
    includePublicServices: true,
    includeAnnuaire: false,
  });

  const rawChorusConfig = loadChorusConfig();
  const chorusConfig = resolveChorusRuntimeConfig(rawChorusConfig);
  const selectedSupplier = suppliers.find((supplier) => supplier.id === formData.supplierOrganizationId);
  const typedPublicCustomerCode = normalizeReferenceLookup(formData.publicCustomerCode);
  const selectedPublicCustomer = publicCustomers.find((customer) => customer.id === formData.publicCustomerId)
    ?? publicCustomers.find((customer) => {
      if (!typedPublicCustomerCode) {
        return false;
      }

      return normalizeReferenceLookup(customer.codeDestinataire) === typedPublicCustomerCode
        || normalizeReferenceLookup(customer.siret) === typedPublicCustomerCode;
    });
  const services = selectedPublicCustomer
    ? publicServices.filter((service) => service.publicCustomerId === selectedPublicCustomer.id && service.active)
    : [];
  const selectedPublicService = services.find((service) => service.id === formData.publicServiceId);
  const detectedSupplierName = selectedSupplier?.legalName || extractionResult?.fields.supplierName;
  const detectedPublicCustomerName = selectedPublicCustomer?.legalName || extractionResult?.fields.publicCustomerName;
  const detectedSupplierSiret = formData.supplierSiret || selectedSupplier?.siret || extractionResult?.fields.supplierSiret;
  const detectedCustomerSiret = formData.publicCustomerCode || selectedPublicCustomer?.siret || extractionResult?.fields.publicCustomerSiret;
  const detectedService = selectedPublicService?.codeServiceExecutant
    ? `${selectedPublicService.codeServiceExecutant} — ${selectedPublicService.label}`
    : normalizeOptionalServiceCode(formData.publicServiceCode)
      || normalizeOptionalServiceCode(extractionResult?.fields.publicServiceCode)
      || extractionResult?.fields.publicServiceLabel;
  const submissionPreparation = prepareInvoiceSubmission({
    formData,
    supplier: selectedSupplier,
    publicCustomer: selectedPublicCustomer,
    publicService: selectedPublicService,
    availableServices: services,
    extraction: extractionResult,
  });
  const chorusTechnicalContext = useMemo(() => buildChorusTechnicalContext(chorusConfig), [chorusConfig]);
  const submissionPayload = useMemo(() => buildInvoiceSubmissionPayload(formData, {
    supplier: selectedSupplier,
    publicCustomer: selectedPublicCustomer,
    publicService: selectedPublicService,
    availableServices: services,
    extraction: extractionResult,
    chorus: chorusTechnicalContext,
    mainFileName: mainFile?.name,
  }), [
    formData,
    selectedSupplier,
    selectedPublicCustomer,
    selectedPublicService,
    services,
    extractionResult,
    chorusTechnicalContext,
    mainFile,
  ]);
  const payloadValidation = useMemo(() => validateChorusSubmissionPayload(submissionPayload), [submissionPayload]);
  const effectivePayloadValidation = resolvedSubmission?.validation ?? payloadValidation;
  const effectiveSubmissionPayload = resolvedSubmission?.payload ?? submissionPayload;
  const hasTreatmentDetails = Boolean(lastSubmissionResult || lastSubmissionError);
  const pythonUploadCalls = useMemo(
    () => lastApiCalls.filter((apiCall) => apiCall.url.includes('/deposer/pdf')),
    [lastApiCalls],
  );
  const pythonSubmitCalls = useMemo(
    () => lastApiCalls.filter((apiCall) => apiCall.url.includes('/v1/soumettre')),
    [lastApiCalls],
  );
  const submissionApiReturnSummary = useMemo(
    () => describeChorusSubmissionApiReturn(lastSubmissionResult?.response, lastApiCalls),
    [lastSubmissionResult?.response, lastApiCalls],
  );
  const batchSummary = useMemo(() => ({
    total: batchResults.length,
    ready: batchResults.filter((result) => result.status === 'ready').length,
    success: batchResults.filter((result) => result.status === 'success').length,
    error: batchResults.filter((result) => result.status === 'error').length,
    running: batchResults.filter((result) => result.status === 'extracting' || result.status === 'submitting').length,
  }), [batchResults]);
  const canSubmitBatchToChorus = batchResults.some(isBatchResultSubmittable);
  const batchIsSubmittingToChorus = batchResults.some((result) => result.status === 'submitting');
  const debugSnapshot = useMemo(() => JSON.stringify({
    chorusConfig: {
      mode: chorusConfig.mode,
      enabled: chorusConfig.enabled,
      apiBaseUrl: chorusConfig.apiBaseUrl,
      uploadFilePath: chorusConfig.uploadFilePath,
      submitInvoicePath: chorusConfig.submitInvoicePath,
      submissionCurrentUserId: chorusConfig.submissionCurrentUserId,
      submissionSupplierId: chorusConfig.submissionSupplierId,
      submissionSupplierServiceId: chorusConfig.submissionSupplierServiceId,
      submissionBankAccountCode: chorusConfig.submissionBankAccountCode,
    },
    technicalContext: chorusTechnicalContext,
    submissionPreparation: {
      readiness: submissionPreparation.readiness,
      errors: submissionPreparation.validation.errors,
      warnings: submissionPreparation.validation.warnings,
    },
    payloadValidation,
    resolvedPayloadValidation: resolvedSubmission?.validation,
    hydrationChanges: resolvedSubmission?.changes,
    hydrationUnresolved: resolvedSubmission?.unresolved,
    payloadPreview: submissionPayload,
    effectivePayloadPreview: effectiveSubmissionPayload,
  }, null, 2), [
    chorusConfig,
    chorusTechnicalContext,
    submissionPreparation,
    payloadValidation,
    submissionPayload,
    resolvedSubmission,
    effectiveSubmissionPayload,
  ]);
  const isDirectMode = chorusConfig.mode === 'direct' && chorusConfig.enabled;
  const canCurrentUserSubmitInvoices = canSubmitInvoices();
  const blockingIssues = [
    ...submissionPreparation.validation.errors.map((error) => error.message),
    ...(isDirectMode ? effectivePayloadValidation.errors.map((error) => error.message) : []),
  ];
  const reviewIssues = [
    ...submissionPreparation.validation.warnings.map((warning) => warning.message),
    ...(isDirectMode ? effectivePayloadValidation.warnings.map((warning) => warning.message) : []),
  ];
  const hasBlockingSubmissionAlerts = isDirectMode && blockingIssues.length > 0;
  const hasVisibleSubmissionAlerts = isDirectMode && (blockingIssues.length > 0 || reviewIssues.length > 0);
  const submissionBlockReason = !canCurrentUserSubmitInvoices
    ? 'Votre compte est en consultation seule et ne peut pas soumettre de factures.'
    : extracting
      ? 'Extraction du document en cours.'
      : submitting
        ? 'Soumission Chorus en cours.'
        : hasBlockingSubmissionAlerts
          ? `Soumission verrouillée : ${blockingIssues[0] ?? 'des champs obligatoires restent incomplets.'}`
          : undefined;
  const isSubmissionBlocked = !canCurrentUserSubmitInvoices || extracting || submitting || hasBlockingSubmissionAlerts;

  const updateBatchResult = useCallback((id: string, patch: Partial<BatchSubmissionResult>) => {
    setBatchResults((currentResults) => currentResults.map((result) => (
      result.id === id ? { ...result, ...patch } : result
    )));
  }, []);

  const resolveBatchSubmissionContext = useCallback((batchDraft: InvoiceDraftFormData) => {
    const batchSupplier = suppliers.find((supplier) => supplier.id === batchDraft.supplierOrganizationId);
    const typedBatchPublicCustomerCode = normalizeReferenceLookup(batchDraft.publicCustomerCode);
    const batchPublicCustomer = publicCustomers.find((customer) => customer.id === batchDraft.publicCustomerId)
      ?? publicCustomers.find((customer) => {
        if (!typedBatchPublicCustomerCode) {
          return false;
        }

        return normalizeReferenceLookup(customer.codeDestinataire) === typedBatchPublicCustomerCode
          || normalizeReferenceLookup(customer.siret) === typedBatchPublicCustomerCode;
      });
    const batchAvailableServices = batchPublicCustomer
      ? publicServices.filter((service) => service.publicCustomerId === batchPublicCustomer.id && service.active)
      : [];
    const batchPublicService = batchAvailableServices.find((service) => service.id === batchDraft.publicServiceId);

    return {
      batchSupplier,
      batchPublicCustomer,
      batchAvailableServices,
      batchPublicService,
    };
  }, [publicCustomers, publicServices, suppliers]);

  const buildBatchResultPatchFromDraft = useCallback((
    result: BatchSubmissionResult,
    nextDraft: InvoiceDraftFormData,
  ): Partial<BatchSubmissionResult> => {
    if (!result.extraction) {
      return {
        draft: nextDraft,
        invoiceNumber: nextDraft.supplierInvoiceNumber,
      };
    }

    const {
      batchSupplier,
      batchPublicCustomer,
      batchAvailableServices,
      batchPublicService,
    } = resolveBatchSubmissionContext(nextDraft);
    const batchPreparation = prepareInvoiceSubmission({
      formData: nextDraft,
      supplier: batchSupplier,
      publicCustomer: batchPublicCustomer,
      publicService: batchPublicService,
      availableServices: batchAvailableServices,
      extraction: result.extraction,
    });

    if (batchPreparation.validation.errors.length > 0) {
      return {
        status: 'error',
        draft: nextDraft,
        invoiceNumber: nextDraft.supplierInvoiceNumber,
        externalId: undefined,
        payload: undefined,
        summary: null,
        apiCalls: [],
        message: batchPreparation.validation.errors[0]?.message || 'Facture incomplète pour la soumission.',
      };
    }

    const payloadForBatchSubmission = buildInvoiceSubmissionPayload(nextDraft, {
      supplier: batchSupplier,
      publicCustomer: batchPublicCustomer,
      publicService: batchPublicService,
      availableServices: batchAvailableServices,
      extraction: result.extraction,
      chorus: chorusTechnicalContext,
      mainFileName: result.file.name,
    });

    return {
      status: 'ready',
      draft: nextDraft,
      invoiceNumber: payloadForBatchSubmission.numeroFactureSaisi,
      externalId: undefined,
      payload: payloadForBatchSubmission,
      summary: null,
      apiCalls: [],
      message: batchPreparation.validation.warnings.length > 0
        ? 'Corrections prises en compte avec des points à contrôler avant soumission.'
        : 'Corrections prises en compte. Facture prête pour Chorus.',
    };
  }, [chorusTechnicalContext, resolveBatchSubmissionContext]);

  const handleBatchDraftChange = useCallback((id: string, patch: Partial<InvoiceDraftFormData>) => {
    setBatchResults((currentResults) => currentResults.map((result) => {
      if (result.id !== id || !result.draft || result.status === 'submitting' || result.status === 'success') {
        return result;
      }

      const nextDraft = {
        ...result.draft,
        ...patch,
      };

      return {
        ...result,
        ...buildBatchResultPatchFromDraft(result, nextDraft),
      };
    }));
  }, [buildBatchResultPatchFromDraft]);

  const handleViewTreatmentDetails = useCallback(() => {
    const target = treatmentDetailsRef.current
      ?? (lastSubmissionResult
        ? submissionResultRef.current
        : lastSubmissionError
          ? submissionErrorRef.current
          : null);

    target?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }, [lastSubmissionError, lastSubmissionResult]);

  useEffect(() => {
    if (skipNextExtraction) {
      setSkipNextExtraction(false);
      setExtracting(false);
      setExtractionError(null);
      setExtractionResult(null);
      return;
    }

    if (!mainFile) {
      setExtracting(false);
      setExtractionError(null);
      setExtractionResult(null);
      setLastSubmissionError(null);
      return;
    }

    setLastSubmissionError(null);
    let cancelled = false;

    async function runExtraction() {
      setExtracting(true);
      setExtractionError(null);

      try {
        const result = await extractInvoiceData(mainFile, {
          suppliers,
          publicCustomers,
          publicServices,
        });

        if (cancelled) {
          return;
        }

        setExtractionResult(result);
        setFormData((current) => mergeExtractionIntoDraft(current, result));
      } catch (error) {
        if (cancelled) {
          return;
        }

        setExtractionResult(null);
        setExtractionError(error instanceof Error ? error.message : 'Erreur inconnue pendant l’analyse locale.');
      } finally {
        if (!cancelled) {
          setExtracting(false);
        }
      }
    }

    void runExtraction();

    return () => {
      cancelled = true;
    };
  }, [mainFile, suppliers, publicCustomers, publicServices]);

  useEffect(() => {
    const folderInput = batchFolderInputRef.current;
    if (!folderInput) {
      return;
    }

    folderInput.setAttribute('webkitdirectory', '');
    folderInput.setAttribute('directory', '');
  }, []);

  useEffect(() => {
    if (!editingInvoiceId || prefilledInvoiceId === editingInvoiceId) {
      return;
    }

    let cancelled = false;

    async function loadInvoiceForEdit() {
      try {
        const invoice = await getInvoice(editingInvoiceId);
        if (!invoice || cancelled) {
          return;
        }

        setFormData({
          supplierOrganizationId: invoice.supplierOrganizationId,
          supplierSiret: '',
          supplierName: '',
          supplierVatNumber: '',
          supplierInvoiceNumber: invoice.supplierInvoiceNumber,
          publicCustomerId: invoice.publicCustomerId,
          publicCustomerCode: '',
          publicCustomerName: '',
          publicServiceId: invoice.publicServiceId ?? '',
          publicServiceCode: '',
          publicServiceLabel: '',
          engagementNumber: invoice.engagementNumber ?? '',
          marketNumber: invoice.marketNumber ?? '',
          purchaseOrderNumber: invoice.purchaseOrderNumber ?? '',
          invoiceDate: invoice.invoiceDate,
          dueDate: invoice.dueDate ?? '',
          currencyCode: invoice.currencyCode || 'EUR',
          paymentMode: undefined,
          totalAmountHt: formatInvoiceAmountForInput(invoice.totalHt),
          totalAmountTtc: formatInvoiceAmountForInput(invoice.totalTtc),
        });

        const attachmentsForInvoice = await getInvoiceAttachments(invoice.id);
        const mainAttachment = attachmentsForInvoice.find((attachment) => attachment.attachmentRole === 'MAIN');

        if (mainAttachment?.storageKey) {
          const response = await fetch(mainAttachment.storageKey);
          if (response.ok && !cancelled) {
            const blob = await response.blob();
            const nextFile = new File(
              [blob],
              mainAttachment.filename,
              { type: mainAttachment.mimeType || blob.type || 'application/pdf' },
            );
            setSkipNextExtraction(true);
            setMainFile(nextFile);
          }
        }

        if (!cancelled) {
          setPrefilledInvoiceId(editingInvoiceId);
          toast({
            title: 'Facture préchargée',
            description: `La facture ${invoice.supplierInvoiceNumber} a été chargée pour édition/soumission.`,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setPrefilledInvoiceId(editingInvoiceId);
          toast({
            title: 'Préchargement impossible',
            description: error instanceof Error ? error.message : 'Erreur inconnue',
            variant: 'destructive',
          });
        }
      }
    }

    void loadInvoiceForEdit();

    return () => {
      cancelled = true;
    };
  }, [editingInvoiceId, prefilledInvoiceId, toast]);

  useEffect(() => {
    const isPdf = mainFile?.type === 'application/pdf' || mainFile?.name.toLowerCase().endsWith('.pdf');

    if (!mainFile || !isPdf) {
      setMainFilePreviewUrl(null);
      return;
    }

    const nextUrl = URL.createObjectURL(mainFile);
    setMainFilePreviewUrl(nextUrl);

    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [mainFile]);

  useEffect(() => {
    setResolvedSubmission(null);
    setTransversesSnapshot(null);
    setTransversesError(null);
    setLastSubmissionResult(null);
    setLastApiCalls([]);
  }, [submissionPayload]);

  const handleMainDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && (file.type === 'application/pdf' || file.type === 'text/xml' || file.name.endsWith('.xml'))) {
      setMainFile(file);
    }
  }, []);

  const handleBatchFilesSelected = useCallback((fileList: FileList | null) => {
    const selectedFiles = Array.from(fileList ?? [])
      .filter(isSupportedInvoiceFile)
      .sort((left, right) => getFileDisplayPath(left).localeCompare(getFileDisplayPath(right)));

    setBatchFiles(selectedFiles);
    setBatchResults([]);
    setBatchCurrentFile(null);
    setBatchAttachments({});

    if (fileList && selectedFiles.length === 0) {
      toast({
        title: 'Aucune facture compatible',
        description: 'Sélectionnez des fichiers PDF ou XML.',
        variant: 'destructive',
      });
    }
  }, [toast]);

  const handleBatchExtraction = async () => {
    if (batchFiles.length === 0) {
      toast({
        title: 'Lot vide',
        description: 'Ajoutez plusieurs factures ou un dossier contenant des PDF/XML avant de lancer l’extraction.',
        variant: 'destructive',
      });
      return;
    }

    const initialResults = batchFiles.map((file, index): BatchSubmissionResult => ({
      id: buildBatchResultId(file, index),
      file,
      displayPath: getFileDisplayPath(file),
      status: 'pending',
      apiCalls: [],
    }));

    setBatchResults(initialResults);
    setBatchSubmitting(true);
    setBatchCurrentFile(null);

    let readyCount = 0;
    let errorCount = 0;

    for (const batchItem of initialResults) {
      setBatchCurrentFile(batchItem.displayPath);
      updateBatchResult(batchItem.id, { status: 'extracting', message: 'Extraction des champs facture.' });

      try {
        const extraction = await extractInvoiceData(batchItem.file, {
          suppliers,
          publicCustomers,
          publicServices,
        });
        const batchDraft = mergeExtractionIntoDraft({
          ...createEmptyInvoiceDraft(),
          supplierOrganizationId: formData.supplierOrganizationId,
          supplierSiret: formData.supplierSiret,
          publicCustomerId: formData.publicCustomerId,
          publicCustomerCode: formData.publicCustomerCode,
          publicServiceId: formData.publicServiceId,
          publicServiceCode: formData.publicServiceCode,
          currencyCode: formData.currencyCode || 'EUR',
        }, extraction);
        const {
          batchSupplier,
          batchPublicCustomer,
          batchAvailableServices,
          batchPublicService,
        } = resolveBatchSubmissionContext(batchDraft);
        const batchPreparation = prepareInvoiceSubmission({
          formData: batchDraft,
          supplier: batchSupplier,
          publicCustomer: batchPublicCustomer,
          publicService: batchPublicService,
          availableServices: batchAvailableServices,
          extraction,
        });

        if (batchPreparation.validation.errors.length > 0) {
          errorCount += 1;
          updateBatchResult(batchItem.id, {
            status: 'error',
            invoiceNumber: batchDraft.supplierInvoiceNumber,
            message: batchPreparation.validation.errors[0]?.message || 'Facture incomplète pour la soumission.',
            extraction,
            draft: batchDraft,
            summary: null,
            apiCalls: [],
          });
          continue;
        }

        const payloadForBatchSubmission = buildInvoiceSubmissionPayload(batchDraft, {
          supplier: batchSupplier,
          publicCustomer: batchPublicCustomer,
          publicService: batchPublicService,
          availableServices: batchAvailableServices,
          extraction,
          chorus: chorusTechnicalContext,
          mainFileName: batchItem.file.name,
        });

        readyCount += 1;
        updateBatchResult(batchItem.id, {
          status: 'ready',
          invoiceNumber: payloadForBatchSubmission.numeroFactureSaisi,
          message: batchPreparation.validation.warnings.length > 0
            ? 'Extraction terminée avec des points à contrôler avant soumission.'
            : 'Extraction terminée. Aperçu prêt pour validation.',
          extraction,
          draft: batchDraft,
          payload: payloadForBatchSubmission,
          summary: null,
          apiCalls: [],
        });
      } catch (error) {
        errorCount += 1;
        updateBatchResult(batchItem.id, {
          status: 'error',
          message: error instanceof Error ? error.message : 'Erreur inconnue pendant l’extraction.',
          summary: null,
          apiCalls: [],
        });
      }
    }

    setBatchSubmitting(false);
    setBatchCurrentFile(null);
    toast({
      title: 'Extraction du lot terminée',
      description: `${readyCount} facture(s) prête(s) pour Chorus, ${errorCount} en échec.`,
      ...(readyCount === 0 && errorCount > 0 ? { variant: 'destructive' as const } : {}),
    });
  };

  const handleBatchSubmitToChorus = async () => {
    if (!canCurrentUserSubmitInvoices) {
      toast({
        title: 'Soumission non autorisée',
        description: 'Votre compte est en consultation seule et ne peut pas soumettre de factures.',
        variant: 'destructive',
      });
      return;
    }

    const resultsToSubmit = batchResults.filter(isBatchResultSubmittable);

    if (resultsToSubmit.length === 0) {
      toast({
        title: 'Aucune facture prête',
        description: 'Lancez d’abord l’extraction du lot et contrôlez les champs détectés.',
        variant: 'destructive',
      });
      return;
    }

    setBatchSubmitting(true);
    setBatchCurrentFile(null);

    const connector = createChorusConnector(chorusConfig);
    let submittedSuccessCount = 0;
    let submittedErrorCount = 0;

    for (const batchItem of resultsToSubmit) {
      const extraction = batchItem.extraction;
      const batchDraft = batchItem.draft;

      if (!extraction || !batchDraft) {
        continue;
      }

      setBatchCurrentFile(batchItem.displayPath);
      updateBatchResult(batchItem.id, {
        status: 'submitting',
        invoiceNumber: batchDraft.supplierInvoiceNumber,
        message: 'Envoi à Chorus en cours.',
        summary: null,
        apiCalls: [],
      });

      try {
        const {
          batchSupplier,
          batchPublicCustomer,
          batchAvailableServices,
          batchPublicService,
        } = resolveBatchSubmissionContext(batchDraft);
        const batchPreparation = prepareInvoiceSubmission({
          formData: batchDraft,
          supplier: batchSupplier,
          publicCustomer: batchPublicCustomer,
          publicService: batchPublicService,
          availableServices: batchAvailableServices,
          extraction,
        });

        if (batchPreparation.validation.errors.length > 0) {
          throw new Error(batchPreparation.validation.errors[0]?.message || 'Facture incomplète pour la soumission.');
        }

        let payloadForBatchSubmission = buildInvoiceSubmissionPayload(batchDraft, {
          supplier: batchSupplier,
          publicCustomer: batchPublicCustomer,
          publicService: batchPublicService,
          availableServices: batchAvailableServices,
          extraction,
          chorus: chorusTechnicalContext,
          mainFileName: batchItem.file.name,
        });
        let validationForBatchSubmission = validateChorusSubmissionPayload(payloadForBatchSubmission);

        if (isDirectMode) {
          try {
            const transverseClient = new ChorusTransversesClient(chorusConfig);
            const hydrationResult = await resolveAndHydrateChorusSubmissionPayload(
              transverseClient,
              payloadForBatchSubmission,
              batchPreparation.normalized,
            );
            payloadForBatchSubmission = hydrationResult.payload;
            validationForBatchSubmission = hydrationResult.validation;
          } catch {
            validationForBatchSubmission = validateChorusSubmissionPayload(payloadForBatchSubmission);
          }
        }

        if (!validationForBatchSubmission.valid) {
          throw new Error(validationForBatchSubmission.errors[0]?.message || 'Payload Chorus invalide.');
        }

        updateBatchResult(batchItem.id, {
          invoiceNumber: payloadForBatchSubmission.numeroFactureSaisi,
          payload: payloadForBatchSubmission,
        });

        const itemAttachments = batchAttachments[batchItem.id] ?? [];
        const result = await connector.submitInvoice({
          invoiceData: payloadForBatchSubmission,
          mainFile: batchItem.file,
          attachments: itemAttachments.map((attachment) => ({
            file: attachment.file,
            designation: attachment.designation.trim() || attachment.file.name,
            type: attachment.type.trim() || DEFAULT_COMPLEMENTARY_ATTACHMENT_TYPE,
            lineNumber: parseOptionalPositiveInteger(attachment.lineNumber),
            liaisonId: parseOptionalPositiveInteger(attachment.liaisonId),
          })),
        });
        const summary = describeChorusSubmissionApiReturn(result.response, result.apiCalls);
        submittedSuccessCount += 1;

        updateBatchResult(batchItem.id, {
          status: 'success',
          message: result.externalId ? `Référence retournée: ${result.externalId}` : 'Soumission acceptée.',
          invoiceNumber: payloadForBatchSubmission.numeroFactureSaisi,
          externalId: result.externalId,
          payload: payloadForBatchSubmission,
          summary,
          apiCalls: result.apiCalls,
        });
      } catch (error) {
        submittedErrorCount += 1;
        const apiCalls = error instanceof ChorusSubmitApiError ? error.apiCalls : [];
        const summary = describeChorusSubmissionApiReturn(undefined, apiCalls);
        updateBatchResult(batchItem.id, {
          status: 'error',
          message: error instanceof Error ? error.message : 'Erreur inconnue pendant la soumission.',
          summary,
          apiCalls,
        });
      }
    }

    setBatchSubmitting(false);
    setBatchCurrentFile(null);
    if (submittedSuccessCount > 0) {
      celebrateSuccess();
    }
    toast({
      title: 'Soumission Chorus par lot terminée',
      description: `${submittedSuccessCount} facture(s) envoyée(s), ${submittedErrorCount} en échec.`,
      ...(submittedSuccessCount === 0 ? { variant: 'destructive' as const } : {}),
    });
  };

  const handleSubmit = async (options?: { forceDebug?: boolean }) => {
    const forceDebug = options?.forceDebug === true;
    if (!canCurrentUserSubmitInvoices) {
      toast({
        title: 'Soumission non autorisée',
        description: 'Votre compte est en consultation seule et ne peut pas soumettre de factures.',
        variant: 'destructive',
      });
      return;
    }

    if (!mainFile) {
      toast({ title: 'Erreur', description: 'Veuillez déposer une facture principale.', variant: 'destructive' });
      return;
    }

    if (isDirectMode && hasBlockingSubmissionAlerts && !forceDebug) {
      toast({
        title: 'Soumission verrouillée',
        description: blockingIssues[0] ?? 'Corrigez les champs obligatoires avant l’envoi.',
        variant: 'destructive',
      });
      return;
    }

    let resolvedService: typeof selectedPublicService | undefined;
    if (services.length === 0) {
      resolvedService = undefined;
    } else {
      const matched = findServiceInRawText(services, extractionResult?.rawText ?? '');
      resolvedService = matched
        ? services.find((s) => s.id === matched.id)
        : undefined;
    }

    const verifiedFormData: InvoiceDraftFormData = {
      ...formData,
      publicServiceId: resolvedService?.id ?? '',
      publicServiceCode: resolvedService?.codeServiceExecutant ?? '',
      publicServiceLabel: resolvedService?.label ?? '',
    };

    setFormData(verifiedFormData);

    let payloadForSubmission = buildInvoiceSubmissionPayload(verifiedFormData, {
      supplier: selectedSupplier,
      publicCustomer: selectedPublicCustomer,
      publicService: resolvedService,
      availableServices: services,
      extraction: extractionResult,
      chorus: chorusTechnicalContext,
      mainFileName: mainFile?.name,
    });
    let validationForSubmission = validateChorusSubmissionPayload(payloadForSubmission);

    if (forceDebug) {
      console.groupCollapsed('[Chorus debug] Force submit from UI');
      console.log({
        chorusTechnicalContext,
        submissionPreparation,
        payloadValidation: validationForSubmission,
        submissionPayload: payloadForSubmission,
      });
      console.groupEnd();
    }

    setLastSubmissionError(null);
    setLastSubmissionResult(null);
    setLastApiCalls([]);
    setSubmitting(true);
    try {
      if (isDirectMode) {
        try {
          const transverseClient = new ChorusTransversesClient(chorusConfig);
          const hydrationResult = await resolveAndHydrateChorusSubmissionPayload(
            transverseClient,
            submissionPayload,
            submissionPreparation.normalized,
          );

          setResolvedSubmission(hydrationResult);
          setTransversesSnapshot(hydrationResult.snapshot);
          setTransversesError(null);
          payloadForSubmission = hydrationResult.payload;
          validationForSubmission = hydrationResult.validation;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Erreur inconnue lors de l’enrichissement Transverses.';
          setTransversesError(message);
          if (forceDebug) {
            console.warn('[Chorus debug] Hydratation Transverses échouée, fallback sur le payload brut.', message);
          }
        }
      }

      if (isDirectMode && !validationForSubmission.valid && !forceDebug) {
        toast({
          title: 'Contexte Chorus incomplet',
          description: validationForSubmission.errors[0]?.message || 'Complétez le contexte technique Chorus dans les paramètres avant l’envoi.',
          variant: 'destructive',
        });
        return;
      }

      const connector = createChorusConnector(chorusConfig);

      const result = await connector.submitInvoice({
        invoiceData: payloadForSubmission,
        mainFile,
        attachments: attachments.map((attachment) => ({
          file: attachment.file,
          designation: attachment.designation.trim() || attachment.file.name,
          type: attachment.type.trim() || DEFAULT_COMPLEMENTARY_ATTACHMENT_TYPE,
          lineNumber: parseOptionalPositiveInteger(attachment.lineNumber),
          liaisonId: parseOptionalPositiveInteger(attachment.liaisonId),
        })),
        debugBypassValidation: forceDebug,
      });
      setLastSubmissionResult(result);
      setLastApiCalls(result.apiCalls);
      celebrateSuccess();

      toast({
        title: chorusConfig.mode === 'mock' ? 'Facture mockée' : 'Facture envoyée à Chorus',
        description: result.externalId
          ? `Référence retournée: ${result.externalId}. Le résultat est affiché dans le bloc dédié.`
          : 'La facture a été transmise. Le résultat est affiché dans le bloc dédié.',
      });

      setMainFile(null);
      setMainFilePreviewUrl(null);
      setAttachments([]);
      setFormData(createEmptyInvoiceDraft());
      setExtractionResult(null);
      setExtractionError(null);
      setResolvedSubmission(null);
      setTransversesSnapshot(null);
      setTransversesError(null);
      setPrefilledInvoiceId(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue';
      if (error instanceof ChorusSubmitApiError) {
        setLastApiCalls(error.apiCalls);
      }
      setLastSubmissionError(message);
      toast({
        title: 'Échec de soumission',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleExportDebugFile = async () => {
    setExportingDebugFile(true);

    try {
      const debugFile = await buildChorusDebugFile({
        config: rawChorusConfig,
        payload: effectiveSubmissionPayload,
        validation: effectivePayloadValidation,
        mainFile,
        connectionTestMethod: rawChorusConfig.connectionTestMethod,
      });

      const blob = new Blob([debugFile], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'debug_chorus.txt';
      link.click();
      URL.revokeObjectURL(url);

      toast({
        title: 'debug_chorus exporté',
        description: 'Le fichier contient les commandes POST utiles pour reproduire les appels du code.',
      });
    } catch (error) {
      toast({
        title: 'Échec export debug',
        description: error instanceof Error ? error.message : 'Erreur inconnue',
        variant: 'destructive',
      });
    } finally {
      setExportingDebugFile(false);
    }
  };

  const handleCheckTransverses = async () => {
    setLoadingTransverses(true);
    setTransversesError(null);

    try {
      const client = new ChorusTransversesClient(chorusConfig);
      const hydrationResult = await resolveAndHydrateChorusSubmissionPayload(
        client,
        submissionPayload,
        submissionPreparation.normalized,
      );

      setResolvedSubmission(hydrationResult);
      setTransversesSnapshot(hydrationResult.snapshot);
      toast({
        title: 'Référentiels Chorus récupérés',
        description: hydrationResult.changes.length > 0
          ? `${hydrationResult.changes.length} champ(s) du payload ont été enrichis automatiquement.`
          : 'Les valeurs Transverses ont été contrôlées pour cette soumission.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue';
      setTransversesError(message);
      setTransversesSnapshot(null);
      setResolvedSubmission(null);
      toast({
        title: 'Échec vérification Transverses',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setLoadingTransverses(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Nouvelle facture</h1>
          <p className="text-sm text-muted-foreground">Déposez une facture, vérifiez l’essentiel, puis soumettez-la à Chorus.</p>
        </div>
        {SHOW_DEV_TOOLS && (
          <div className="flex items-center gap-2">
            <Badge variant={chorusConfig.mode === 'direct' && chorusConfig.enabled ? 'default' : 'secondary'}>
              {chorusConfig.mode === 'direct' && chorusConfig.enabled ? 'Chorus direct' : 'Mode mock'}
            </Badge>
          </div>
        )}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Document principal</CardTitle></CardHeader>
        <CardContent>
          {mainFile ? (
            <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/30">
              <div className="flex items-center gap-3">
                <FileText className="h-8 w-8 text-accent" />
                <div>
                  <div className="font-medium">{mainFile.name}</div>
                  <div className="text-xs text-muted-foreground">{(mainFile.size / 1024).toFixed(0)} Ko</div>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setMainFile(null)}><X className="h-4 w-4" /></Button>
            </div>
          ) : (
            <div
              className="border-2 border-dashed rounded-lg p-12 text-center cursor-pointer hover:border-accent/50 transition-colors"
              onDragOver={e => e.preventDefault()}
              onDrop={handleMainDrop}
              onClick={() => document.getElementById('main-upload')?.click()}
            >
              <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="font-medium">Glissez-déposez votre facture ici</p>
              <p className="text-sm text-muted-foreground mt-1">PDF, XML ou Factur-X · 50 Mo max</p>
              <input id="main-upload" type="file" className="hidden" accept=".pdf,.xml" onChange={e => { if (e.target.files?.[0]) setMainFile(e.target.files[0]); }} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
          <CardHeader>
            <CardTitle className="text-base">Pièces jointes complémentaires</CardTitle>
            <p className="text-sm text-muted-foreground">
              Chaque fichier est téléversé avant la soumission pour récupérer son identifiant Chorus, puis l’ajouter à `pieceJointeComplementaire`.
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {attachments.length === 0 && (
                <p className="text-sm text-muted-foreground">Aucune pièce complémentaire ajoutée.</p>
              )}
              {attachments.map((attachment) => (
                <div key={attachment.id} className="space-y-3 rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{attachment.file.name}</p>
                        <p className="text-xs text-muted-foreground">{(attachment.file.size / 1024).toFixed(0)} Ko</p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setAttachments((prev) => prev.filter((item) => item.id !== attachment.id))}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                    <div className="space-y-2 md:col-span-2">
                      <Label>Désignation Chorus</Label>
                      <Input
                        value={attachment.designation}
                        onChange={(event) => setAttachments((prev) => prev.map((item) => (
                          item.id === attachment.id ? { ...item, designation: event.target.value } : item
                        )))}
                        placeholder={attachment.file.name}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Type</Label>
                      <Select
                        value={attachment.type}
                        onValueChange={(value) => setAttachments((prev) => prev.map((item) => (
                          item.id === attachment.id ? { ...item, type: value } : item
                        )))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {COMPLEMENTARY_ATTACHMENT_TYPES.map((type) => (
                            <SelectItem key={type.value} value={type.value}>
                              {type.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>N° ligne</Label>
                      <Input
                        inputMode="numeric"
                        value={attachment.lineNumber}
                        onChange={(event) => setAttachments((prev) => prev.map((item) => (
                          item.id === attachment.id ? { ...item, lineNumber: event.target.value } : item
                        )))}
                        placeholder="Optionnel"
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label>ID liaison</Label>
                      <Input
                        inputMode="numeric"
                        value={attachment.liaisonId}
                        onChange={(event) => setAttachments((prev) => prev.map((item) => (
                          item.id === attachment.id ? { ...item, liaisonId: event.target.value } : item
                        )))}
                        placeholder="Optionnel"
                      />
                    </div>
                  </div>
                </div>
              ))}
              <Button variant="outline" onClick={() => document.getElementById('att-upload')?.click()}>
                <Upload className="mr-2 h-4 w-4" /> Ajouter un fichier
              </Button>
              <input id="att-upload" type="file" className="hidden" multiple onChange={e => {
                if (e.target.files) {
                  const nextAttachments = Array.from(e.target.files).map((file, index) => buildComplementaryAttachmentDraft(file, index));
                  setAttachments(prev => [...prev, ...nextAttachments]);
                  e.target.value = '';
                }
              }} />
            </div>
          </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Extraction du document</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {!mainFile && (
            <p className="text-sm text-muted-foreground">
              Déposez un PDF ou un XML pour tenter une extraction locale des champs métier avant soumission.
              Les PDF scannés restent à contrôler tant qu’aucun OCR n’est branché.
            </p>
          )}

          {mainFile && extracting && (
            <div className="flex items-center gap-3 rounded-lg border bg-muted/20 p-4 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Analyse locale du document et tentative de préremplissage du formulaire…</span>
            </div>
          )}

          {mainFile && extractionError && (
            <Alert variant="destructive">
              <TriangleAlert className="h-4 w-4" />
              <AlertTitle>Extraction impossible</AlertTitle>
              <AlertDescription>{extractionError}</AlertDescription>
            </Alert>
          )}

          {mainFile && !extracting && extractionResult && (
            <>
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-accent" />
                  <span className="text-sm font-medium">
                    Analyse locale {extractionResult.sourceFormat} terminée
                  </span>
                </div>
                <Badge variant={extractionResult.requiresReview ? 'secondary' : 'default'}>
                  {extractionResult.requiresReview ? 'À contrôler' : 'Prérempli'}
                </Badge>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <ExtractionInfoRow index={0} label="Fournisseur" value={detectedSupplierName} />
                <ExtractionInfoRow index={1} label="N° facture" value={formData.supplierInvoiceNumber} />
                <ExtractionInfoRow index={2} label="Client public" value={detectedPublicCustomerName} />
                <ExtractionInfoRow index={3} label="Service destinataire" value={detectedService} />
                <ExtractionInfoRow index={4} label="Date facture" value={formData.invoiceDate} />
                <ExtractionInfoRow index={5} label="Échéance" value={extractionResult.fields.dueDate} />
                <ExtractionInfoRow index={6} label="Mode paiement" value={extractionResult.fields.paymentMode} />
                <ExtractionInfoRow index={7} label="Devise" value={formData.currencyCode || extractionResult.fields.currencyCode} />
                <ExtractionInfoRow index={8} label="SIRET fournisseur" value={detectedSupplierSiret} />
                <ExtractionInfoRow index={9} label="SIRET destinataire" value={detectedCustomerSiret} />
                <ExtractionInfoRow index={10} label="Montant HT" value={formatAmountForDisplay(formData.totalAmountHt)} />
                <ExtractionInfoRow index={11} label="Montant TVA" value={formatExtractedAmountForDisplay(extractionResult.fields.totalVat)} />
                <ExtractionInfoRow index={12} label="Montant TTC" value={formatAmountForDisplay(formData.totalAmountTtc)} />
              </div>

              {extractionResult.warnings.length > 0 && (
                <Alert>
                  <TriangleAlert className="h-4 w-4" />
                  <AlertTitle>Points à contrôler</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc space-y-1 pl-4">
                      {extractionResult.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}

          {mainFile && !extracting && (
            <DocumentPreviewCard
              file={mainFile}
              previewUrl={mainFilePreviewUrl ?? undefined}
              extractedText={extractionResult?.rawText ?? ''}
              rawTextPreview={extractionResult?.rawTextPreview ?? ''}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Données facture</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-4">
            {SHOW_DEV_TOOLS && showAdvancedTools && loadingReferences && (
              <div className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
                Chargement des référentiels fournisseur et des éventuelles listes API configurées…
              </div>
            )}

            {SHOW_DEV_TOOLS && showAdvancedTools && !loadingReferences && !referenceCatalogError && (rawChorusConfig.referenceAnnuaireJsonUrl || rawChorusConfig.referenceAnnuaireXmlUrl) && referenceCatalogMetadata.publicCustomersSource === 'empty' && referenceCatalogMetadata.publicServicesSource === 'empty' && (
              <div className="rounded-lg border bg-warning/5 p-3 text-sm text-muted-foreground">
                L&apos;annuaire Chorus massif n&apos;est pas chargé automatiquement sur cet écran pour éviter les plantages pendant l&apos;upload. Il reste consultable dans `Référentiels`.
              </div>
            )}

            {SHOW_DEV_TOOLS && showAdvancedTools && !loadingReferences && !referenceCatalogError && (publicCustomers.length > 0 || publicServices.length > 0 || suppliers.length > 0) && (
              <div className="rounded-lg border bg-muted/10 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">Référentiels actifs :</span>
                  <Badge variant={referenceCatalogMetadata.suppliersSource === 'api' ? 'default' : 'secondary'}>
                    Fournisseurs : {referenceCatalogMetadata.suppliersSource === 'api' ? 'API backend' : 'Aucun'}
                  </Badge>
                  <Badge variant={referenceCatalogMetadata.publicCustomersSource === 'annuaire' ? 'default' : 'secondary'}>
                    Clients publics : {referenceCatalogMetadata.publicCustomersSource === 'annuaire' ? `Annuaire ${referenceCatalogMetadata.annuaireSourceFormat === 'json' ? 'JSON' : 'XML'}` : referenceCatalogMetadata.publicCustomersSource === 'api' ? 'API backend' : 'Aucun'}
                  </Badge>
                  <Badge variant={referenceCatalogMetadata.publicServicesSource === 'annuaire' ? 'default' : 'secondary'}>
                    Services : {referenceCatalogMetadata.publicServicesSource === 'annuaire' ? `Annuaire ${referenceCatalogMetadata.annuaireSourceFormat === 'json' ? 'JSON' : 'XML'}` : referenceCatalogMetadata.publicServicesSource === 'api' ? 'API backend' : 'Aucun'}
                  </Badge>
                </div>
                {(referenceCatalogMetadata.annuaireJsonUrl || referenceCatalogMetadata.annuaireXmlUrl) && (referenceCatalogMetadata.publicCustomersSource === 'annuaire' || referenceCatalogMetadata.publicServicesSource === 'annuaire') && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Annuaire Chorus {referenceCatalogMetadata.annuaireSourceFormat === 'json' ? 'JSON' : 'XML'} chargé depuis {referenceCatalogMetadata.annuaireJsonUrl || referenceCatalogMetadata.annuaireXmlUrl} avec {referenceCatalogMetadata.annuaireStructureCount} structures et {referenceCatalogMetadata.annuaireServiceCount} services.
                  </p>
                )}
              </div>
            )}

            {referenceCatalogError && (
              <Alert variant="destructive">
                <TriangleAlert className="h-4 w-4" />
                <AlertTitle>Référentiels indisponibles</AlertTitle>
                <AlertDescription>{referenceCatalogError}</AlertDescription>
              </Alert>
            )}

          <p className="text-sm text-muted-foreground">
            Renseigne l’essentiel. Le reste reste optionnel et le montant TVA peut être recalculé si HT et TTC sont cohérents.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Fournisseur</Label>
              <Select value={formData.supplierOrganizationId} onValueChange={v => setFormData(p => ({ ...p, supplierOrganizationId: v }))}>
                <SelectTrigger><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
                <SelectContent>
                  {suppliers.filter(s => s.active).map(s => <SelectItem key={s.id} value={s.id}>{s.legalName} ({s.siret})</SelectItem>)}
                </SelectContent>
              </Select>
              <Input
                placeholder="Ou saisir le SIRET fournisseur"
                value={formData.supplierSiret ?? ''}
                onChange={e => setFormData(p => ({ ...p, supplierSiret: e.target.value.replace(/\D/g, '') }))}
              />
              {detectedSupplierSiret && <p className="text-xs text-muted-foreground">SIRET détecté: {detectedSupplierSiret}</p>}
            </div>
            <div className="space-y-2">
              <Label>N° Facture</Label>
              <Input placeholder="FAC-2024-..." value={formData.supplierInvoiceNumber} onChange={e => setFormData(p => ({ ...p, supplierInvoiceNumber: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Client public</Label>
              <Select
                value={formData.publicCustomerId}
                onValueChange={(value) => setFormData((current) => ({
                  ...current,
                  publicCustomerId: value,
                  publicServiceId: '',
                  publicServiceCode: '',
                  publicServiceLabel: '',
                }))}
              >
                <SelectTrigger><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
                <SelectContent>
                  {publicCustomers.filter((customer) => customer.active).map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>
                      {customer.legalName} ({customer.codeDestinataire})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="Ou saisir le code destinataire / SIRET"
                value={formData.publicCustomerCode ?? ''}
                onChange={e => setFormData(p => ({ ...p, publicCustomerCode: e.target.value.trim() }))}
              />
              {detectedCustomerSiret && <p className="text-xs text-muted-foreground">SIRET destinataire: {detectedCustomerSiret}</p>}
            </div>
            <div className="space-y-2">
              <Label>Service destinataire</Label>
              <Select value={formData.publicServiceId} onValueChange={(value) => setFormData((current) => ({ ...current, publicServiceId: value }))} disabled={!selectedPublicCustomer}>
                <SelectTrigger>
                  <SelectValue placeholder={selectedPublicCustomer ? 'Sélectionner...' : 'Choisir un client d\'abord'} />
                </SelectTrigger>
                <SelectContent>
                  {services.map(s => <SelectItem key={s.id} value={s.id}>{s.codeServiceExecutant} — {s.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input
                placeholder="Ou saisir le code service exécutant"
                value={formData.publicServiceCode ?? ''}
                onChange={e => setFormData(p => ({ ...p, publicServiceCode: e.target.value.trim() }))}
              />
              {detectedService && <p className="text-xs text-muted-foreground">Service détecté: {detectedService}</p>}
            </div>
            <div className="space-y-2">
              <Label>Date facture</Label>
              <Input type="date" value={formData.invoiceDate} onChange={e => setFormData(p => ({ ...p, invoiceDate: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Montant TTC</Label>
              <Input
                inputMode="decimal"
                placeholder="14400,00"
                value={formData.totalAmountTtc}
                onChange={e => setFormData(p => ({ ...p, totalAmountTtc: e.target.value }))}
              />
            </div>

            <div className="col-span-full rounded-lg border bg-muted/10 p-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-medium">Champs optionnels</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    À compléter seulement si la facture ou Chorus les exige.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowOptionalMetadata((current) => !current)}
                >
                  {showOptionalMetadata ? 'Masquer les options' : 'Afficher les options'}
                </Button>
              </div>

              {showOptionalMetadata && (
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Devise</Label>
                    <Input
                      placeholder="EUR"
                      maxLength={3}
                      value={formData.currencyCode}
                      onChange={e => setFormData(p => ({ ...p, currencyCode: e.target.value.toUpperCase() }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Montant HT</Label>
                    <Input
                      inputMode="decimal"
                      placeholder="12000,00"
                      value={formData.totalAmountHt}
                      onChange={e => setFormData(p => ({ ...p, totalAmountHt: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>N° Engagement</Label>
                    <Input placeholder="ENG-..." value={formData.engagementNumber} onChange={e => setFormData(p => ({ ...p, engagementNumber: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>N° Marché</Label>
                    <Input placeholder="MA-..." value={formData.marketNumber} onChange={e => setFormData(p => ({ ...p, marketNumber: e.target.value }))} />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>N° Bon de commande</Label>
                    <Input placeholder="BC-..." value={formData.purchaseOrderNumber} onChange={e => setFormData(p => ({ ...p, purchaseOrderNumber: e.target.value }))} />
                  </div>
                </div>
              )}
            </div>
          </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Préparation de la soumission Chorus</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className={`rounded-lg border p-4 transition-all ${
            submissionPreparation.readiness === 'ready'
              ? 'border-emerald-200 bg-emerald-50/60 animate-success-pulse'
              : submissionPreparation.readiness === 'review'
                ? 'border-amber-200 bg-amber-50/60'
                : 'border-red-200 bg-red-50/60'
          }`}
          key={submissionPreparation.readiness}
          >
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-medium">
                  {submissionPreparation.readiness === 'ready'
                    ? 'Prêt à envoyer'
                    : submissionPreparation.readiness === 'review'
                      ? 'Revue requise avant envoi'
                      : 'Envoi bloqué'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {submissionPreparation.readiness === 'ready'
                    ? 'Le minimum nécessaire est présent.'
                    : submissionPreparation.readiness === 'review'
                      ? 'Des alertes restent présentes et doivent être levées avant la soumission.'
                      : 'Des informations obligatoires sont encore manquantes.'}
                </p>
              </div>
              <Badge
                variant={
                  submissionPreparation.readiness === 'blocked'
                    ? 'destructive'
                    : submissionPreparation.readiness === 'review'
                      ? 'secondary'
                      : 'default'
                }
              >
                {submissionPreparation.readiness === 'ready'
                  ? 'Prêt'
                  : submissionPreparation.readiness === 'review'
                    ? 'Revue'
                    : 'Bloqué'}
              </Badge>
            </div>
          </div>

          {(blockingIssues.length > 0 || reviewIssues.length > 0 || submissionPreparation.recommendations.length > 0) && (
            <div className="rounded-lg border bg-muted/10 p-4 space-y-4">
              <p className="text-sm font-medium">Corriger avant envoi</p>

              {blockingIssues.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-destructive">Blocages</p>
                  <ul className="list-disc space-y-1 pl-4 text-sm">
                    {blockingIssues.map((message) => (
                      <li key={`blocking-${message}`}>{message}</li>
                    ))}
                  </ul>
                </div>
              )}

              {reviewIssues.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Points à lever</p>
                  <ul className="list-disc space-y-1 pl-4 text-sm">
                    {reviewIssues.map((message) => (
                      <li key={`review-${message}`}>{message}</li>
                    ))}
                  </ul>
                </div>
              )}

              {submissionPreparation.recommendations.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Étapes conseillées</p>
                  <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                    {submissionPreparation.recommendations.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {SHOW_DEV_TOOLS && showAdvancedTools && isDirectMode && (
            <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-medium">Contrôle référentiel Chorus Transverses</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Vérifie avant soumission les cadres, devises, taux TVA, modes de règlement, structures fournisseur,
                    coordonnées bancaires, destinataire et service exécutant si renseigné.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => void handleCheckTransverses()} disabled={loadingTransverses}>
                  {loadingTransverses ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Vérifier via API Transverses
                </Button>
              </div>

              {transversesError && (
                <Alert variant="destructive">
                  <TriangleAlert className="h-4 w-4" />
                  <AlertTitle>Contrôle Transverses en erreur</AlertTitle>
                  <AlertDescription>{transversesError}</AlertDescription>
                </Alert>
              )}

              {transversesSnapshot && (
                <div className="space-y-4 rounded-lg border bg-background p-4">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <ExtractionInfoRow label="Cadre valide" value={transversesSnapshot.checks.cadreFacturationValid ? 'Oui' : 'Non'} />
                    <ExtractionInfoRow label="Devise valide" value={transversesSnapshot.checks.deviseValid ? 'Oui' : 'Non'} />
                    <ExtractionInfoRow label="Mode paiement valide" value={transversesSnapshot.checks.modePaiementValid ? 'Oui' : 'Non'} />
                    <ExtractionInfoRow label="Mode dépôt valide" value={transversesSnapshot.checks.modeDepotValid ? 'Oui' : 'Non'} />
                    <ExtractionInfoRow label="Structure fournisseur valide" value={transversesSnapshot.checks.fournisseurStructureValid ? 'Oui' : 'Non'} />
                    <ExtractionInfoRow label="Coordonnées bancaires valides" value={transversesSnapshot.checks.coordonneeBancaireValide ? 'Oui' : 'Non'} />
                    <ExtractionInfoRow label="Destinataire trouvé" value={transversesSnapshot.checks.destinataireTrouve ? 'Oui' : 'Non'} />
                    <ExtractionInfoRow label="Service exécutant trouvé" value={transversesSnapshot.checks.serviceExecutantTrouve ? 'Oui' : 'Non'} />
                    <ExtractionInfoRow label="Taux TVA valides" value={transversesSnapshot.checks.tauxTvaValides ? 'Oui' : 'Non'} />
                  </div>

                  {resolvedSubmission && resolvedSubmission.changes.length > 0 && (
                    <Alert>
                      <TriangleAlert className="h-4 w-4" />
                      <AlertTitle>Champs enrichis automatiquement</AlertTitle>
                      <AlertDescription>
                        <ul className="list-disc space-y-1 pl-4">
                          {resolvedSubmission.changes.map((change) => (
                            <li key={`${change.path}-${String(change.nextValue)}`}>
                              <span className="font-medium">{change.path}</span>
                              {' '}→ {String(change.nextValue)}. {change.reason}
                            </li>
                          ))}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  )}

                  {resolvedSubmission && resolvedSubmission.unresolved.length > 0 && (
                    <Alert>
                      <TriangleAlert className="h-4 w-4" />
                      <AlertTitle>Champs restant hors PDF</AlertTitle>
                      <AlertDescription>
                        <ul className="list-disc space-y-1 pl-4">
                          {resolvedSubmission.unresolved.map((issue) => (
                            <li key={`${issue.path}-${issue.message}`}>
                              <span className="font-medium">{issue.path}</span>
                              {' '}— {issue.message}
                            </li>
                          ))}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  )}

                  {transversesSnapshot.checks.warnings.length > 0 && (
                    <Alert>
                      <TriangleAlert className="h-4 w-4" />
                      <AlertTitle>Écarts référentiels</AlertTitle>
                      <AlertDescription>
                        <ul className="list-disc space-y-1 pl-4">
                          {transversesSnapshot.checks.warnings.map((warning) => (
                            <li key={warning}>{warning}</li>
                          ))}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  )}

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                    <ExtractionInfoRow label="Cadres récupérés" value={String(transversesSnapshot.cadresFacturation.length)} />
                    <ExtractionInfoRow label="Devises récupérées" value={String(transversesSnapshot.devises.length)} />
                    <ExtractionInfoRow label="Destinataires trouvés" value={String(transversesSnapshot.destinataires.length)} />
                    <ExtractionInfoRow label="Services trouvés" value={String(transversesSnapshot.servicesExecutants.length)} />
                  </div>
                </div>
              )}
            </div>
          )}

          {SHOW_DEV_TOOLS && showAdvancedTools && isDirectMode && (
            <div className="rounded-lg border bg-muted/20 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Debug Chorus</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Affiche le contexte technique, la validation et le payload construit avant l’envoi.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setShowDebugPanel((value) => !value)}>
                  {showDebugPanel ? 'Masquer le debug' : 'Afficher le debug'}
                </Button>
              </div>

              {showDebugPanel && (
                <div className="mt-4 space-y-3 rounded-lg border bg-background p-4">
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleSubmit({ forceDebug: true })}
                      disabled={!canCurrentUserSubmitInvoices || extracting || submitting || !mainFile}
                    >
                      {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TriangleAlert className="mr-2 h-4 w-4" />}
                      Forcer l’envoi debug
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void handleExportDebugFile()} disabled={exportingDebugFile}>
                      {exportingDebugFile ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Exporter debug_chorus
                    </Button>
                  </div>
                  <pre className="whitespace-pre-wrap break-words text-xs">{debugSnapshot}</pre>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="text-base">Soumission par lot</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Ajoutez plusieurs factures ou un dossier complet, lancez le lot pour extraire les champs, puis envoyez les factures prêtes à Chorus.
              </p>
            </div>
            <Badge variant={batchSubmitting ? 'secondary' : 'outline'}>
              {batchSubmitting ? 'Lot en cours' : `${batchFiles.length} fichier(s)`}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => document.getElementById('batch-files-upload')?.click()}
              disabled={batchSubmitting}
            >
              <Upload className="mr-2 h-4 w-4" />
              Ajouter des factures
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => document.getElementById('batch-folder-upload')?.click()}
              disabled={batchSubmitting}
            >
              <FolderOpen className="mr-2 h-4 w-4" />
              Ajouter un dossier
            </Button>
            <Button
              type="button"
              onClick={() => void handleBatchExtraction()}
              disabled={batchSubmitting || batchFiles.length === 0}
            >
              {batchSubmitting && !batchIsSubmittingToChorus ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              Lancer le lot
            </Button>
            <Button
              type="button"
              onClick={() => void handleBatchSubmitToChorus()}
              disabled={batchSubmitting || !canCurrentUserSubmitInvoices || !canSubmitBatchToChorus}
            >
              {batchIsSubmittingToChorus ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Envoyer à Chorus par lot
            </Button>
            {batchFiles.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setBatchFiles([]);
                  setBatchResults([]);
                  setBatchCurrentFile(null);
                  setBatchAttachments({});
                }}
                disabled={batchSubmitting}
              >
                Vider
              </Button>
            )}
            <input
              id="batch-files-upload"
              type="file"
              multiple
              className="hidden"
              accept=".pdf,.xml,application/pdf,text/xml"
              onChange={(event) => handleBatchFilesSelected(event.target.files)}
            />
            <input
              id="batch-folder-upload"
              ref={batchFolderInputRef}
              type="file"
              multiple
              className="hidden"
              accept=".pdf,.xml,application/pdf,text/xml"
              onChange={(event) => handleBatchFilesSelected(event.target.files)}
            />
          </div>

          {batchCurrentFile && (
            <Alert>
              <Loader2 className="h-4 w-4 animate-spin" />
              <AlertTitle>{batchIsSubmittingToChorus ? 'Soumission Chorus du lot' : 'Extraction du lot'}</AlertTitle>
              <AlertDescription>{batchCurrentFile}</AlertDescription>
            </Alert>
          )}

          {batchFiles.length > 0 && batchResults.length === 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium">
                Fichiers prêts pour le lot ({batchFiles.length})
              </p>
              <p className="text-xs text-muted-foreground">
                Pour chaque facture, vous pouvez ajouter des pièces jointes complémentaires (bon de commande, PV, devis…). Elles seront téléversées avant la soumission Chorus.
              </p>
              <div className="space-y-2">
                {batchFiles.map((file, index) => {
                  const itemId = buildBatchResultId(file, index);
                  const itemAttachments = batchAttachments[itemId] ?? [];
                  const inputId = `batch-attachment-upload-${itemId}`;
                  return (
                    <details key={itemId} className="group rounded-lg border bg-muted/10">
                      <summary className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm">
                        <span className="flex min-w-0 items-center gap-2">
                          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="truncate font-medium">{getFileDisplayPath(file)}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                          <span>{(file.size / 1024).toFixed(0)} Ko</span>
                          <Badge variant={itemAttachments.length > 0 ? 'default' : 'outline'}>
                            {itemAttachments.length} pièce(s) jointe(s)
                          </Badge>
                        </span>
                      </summary>
                      <div className="space-y-3 border-t bg-background/40 p-3">
                        {itemAttachments.length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            Aucune pièce jointe complémentaire pour cette facture.
                          </p>
                        ) : (
                          itemAttachments.map((attachment) => (
                            <div key={attachment.id} className="space-y-3 rounded-lg border bg-background p-3">
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex min-w-0 items-center gap-3">
                                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-medium">{attachment.file.name}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {(attachment.file.size / 1024).toFixed(0)} Ko
                                    </p>
                                  </div>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={batchSubmitting}
                                  onClick={() => setBatchAttachments((prev) => ({
                                    ...prev,
                                    [itemId]: (prev[itemId] ?? []).filter((item) => item.id !== attachment.id),
                                  }))}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                                <div className="space-y-2 md:col-span-2">
                                  <Label>Désignation Chorus</Label>
                                  <Input
                                    value={attachment.designation}
                                    placeholder={attachment.file.name}
                                    disabled={batchSubmitting}
                                    onChange={(event) => setBatchAttachments((prev) => ({
                                      ...prev,
                                      [itemId]: (prev[itemId] ?? []).map((item) => (
                                        item.id === attachment.id ? { ...item, designation: event.target.value } : item
                                      )),
                                    }))}
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label>Type</Label>
                                  <Select
                                    value={attachment.type}
                                    disabled={batchSubmitting}
                                    onValueChange={(value) => setBatchAttachments((prev) => ({
                                      ...prev,
                                      [itemId]: (prev[itemId] ?? []).map((item) => (
                                        item.id === attachment.id ? { ...item, type: value } : item
                                      )),
                                    }))}
                                  >
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {COMPLEMENTARY_ATTACHMENT_TYPES.map((type) => (
                                        <SelectItem key={type.value} value={type.value}>
                                          {type.label}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="space-y-2">
                                  <Label>N° ligne</Label>
                                  <Input
                                    inputMode="numeric"
                                    value={attachment.lineNumber}
                                    placeholder="Optionnel"
                                    disabled={batchSubmitting}
                                    onChange={(event) => setBatchAttachments((prev) => ({
                                      ...prev,
                                      [itemId]: (prev[itemId] ?? []).map((item) => (
                                        item.id === attachment.id ? { ...item, lineNumber: event.target.value } : item
                                      )),
                                    }))}
                                  />
                                </div>
                                <div className="space-y-2 md:col-span-2">
                                  <Label>ID liaison</Label>
                                  <Input
                                    inputMode="numeric"
                                    value={attachment.liaisonId}
                                    placeholder="Optionnel"
                                    disabled={batchSubmitting}
                                    onChange={(event) => setBatchAttachments((prev) => ({
                                      ...prev,
                                      [itemId]: (prev[itemId] ?? []).map((item) => (
                                        item.id === attachment.id ? { ...item, liaisonId: event.target.value } : item
                                      )),
                                    }))}
                                  />
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={batchSubmitting}
                          onClick={() => document.getElementById(inputId)?.click()}
                        >
                          <Upload className="mr-2 h-4 w-4" /> Ajouter une pièce jointe
                        </Button>
                        <input
                          id={inputId}
                          type="file"
                          multiple
                          className="hidden"
                          onChange={(event) => {
                            if (event.target.files) {
                              const newDrafts = Array.from(event.target.files).map(
                                (uploadedFile, attachmentIndex) => buildComplementaryAttachmentDraft(uploadedFile, attachmentIndex),
                              );
                              setBatchAttachments((prev) => ({
                                ...prev,
                                [itemId]: [...(prev[itemId] ?? []), ...newDrafts],
                              }));
                              event.target.value = '';
                            }
                          }}
                        />
                      </div>
                    </details>
                  );
                })}
              </div>
            </div>
          )}

          {batchResults.length > 0 && (
            <div className="rounded-lg border bg-muted/20 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-medium">Résultat du lot</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {batchSummary.ready} prête(s), {batchSummary.success} envoyée(s), {batchSummary.error} en échec, {batchSummary.running} en cours sur {batchSummary.total}.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{batchSummary.ready} prête(s)</Badge>
                  <Badge variant="default">{batchSummary.success} envoyée(s)</Badge>
                  <Badge variant={batchSummary.error > 0 ? 'destructive' : 'outline'}>{batchSummary.error} KO</Badge>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {batchResults.map((result) => (
                  <details
                    key={`${result.id}-${result.status}`}
                    className="group rounded-lg border bg-background"
                    defaultOpen={result.status === 'ready' || result.status === 'error' || result.status === 'success'}
                  >
                    <summary className="flex cursor-pointer flex-col gap-3 px-3 py-3 text-sm md:flex-row md:items-center md:justify-between">
                      <span className="flex min-w-0 items-center gap-2">
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate font-medium">{result.displayPath}</span>
                      </span>
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge variant={getBatchStatusBadgeVariant(result.status)}>
                          {getBatchStatusLabel(result.status)}
                        </Badge>
                        {result.invoiceNumber && <Badge variant="outline">Facture {result.invoiceNumber}</Badge>}
                        {result.externalId && <Badge variant="default">Réf. {result.externalId}</Badge>}
                        {result.summary?.httpStatus !== undefined && (
                          <Badge variant="outline">HTTP {result.summary.httpStatus}</Badge>
                        )}
                        {result.summary?.codeRetour !== undefined && (
                          <Badge variant={result.status === 'error' ? 'destructive' : 'outline'}>
                            codeRetour {result.summary.codeRetour}
                          </Badge>
                        )}
                        {result.summary?.statutFacture && (
                          <Badge variant="secondary">{result.summary.statutFacture}</Badge>
                        )}
                      </span>
                    </summary>
                    <div className="space-y-3 border-t bg-muted/10 p-3">
                      <BatchDocumentPreview result={result} />
                      <BatchExtractionEditor
                        result={result}
                        disabled={batchSubmitting || result.status === 'success'}
                        publicCustomers={publicCustomers}
                        publicServices={publicServices}
                        onDraftChange={handleBatchDraftChange}
                      />
                      <p className="text-xs text-muted-foreground">
                        {result.message || result.summary?.libelle || '-'}
                      </p>
                    </div>
                  </details>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card ref={treatmentDetailsRef}>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="text-base">Résultat de la soumission Chorus</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Le statut métier Chorus apparaît ici après chaque soumission.
              </p>
            </div>
            {SHOW_DEV_TOOLS && hasTreatmentDetails && (
              <div className="flex items-center gap-2">
                <Switch
                  id="show-submission-api-return"
                  checked={showSubmissionApiReturn}
                  onCheckedChange={setShowSubmissionApiReturn}
                />
                <Label htmlFor="show-submission-api-return" className="text-sm">
                  Afficher retour API
                </Label>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!hasTreatmentDetails && (
            <div className="rounded-lg border bg-muted/20 p-4">
              <p className="text-sm font-medium">Aucune soumission lancée</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Le résultat de la prochaine soumission sera affiché dans cet espace.
              </p>
            </div>
          )}

          {lastSubmissionError && (
            <Alert variant="destructive">
              <TriangleAlert className="h-4 w-4" />
              <AlertTitle>Soumission échouée</AlertTitle>
              <AlertDescription>{lastSubmissionError}</AlertDescription>
            </Alert>
          )}

          {lastSubmissionResult && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <ExtractionInfoRow label="Traitement" value={lastSubmissionResult.ok ? 'Réussi' : 'Échoué'} />
              <ExtractionInfoRow label="Référence Chorus" value={lastSubmissionResult.externalId} />
              <ExtractionInfoRow label="Pièces jointes uploadées" value={String(lastSubmissionResult.uploadedFiles.length)} />
            </div>
          )}

          {submissionApiReturnSummary && (
            <ChorusApiReturnSummaryPanel summary={submissionApiReturnSummary} />
          )}

          {SHOW_DEV_TOOLS && showSubmissionApiReturn && lastSubmissionResult && (
            <div className="rounded-lg border bg-muted/20 p-4">
              <p className="text-sm font-medium">Réponse finale /v1/soumettre</p>
              <pre className="mt-3 whitespace-pre-wrap break-words text-xs">
                {JSON.stringify(lastSubmissionResult.response ?? null, null, 2)}
              </pre>
            </div>
          )}

          {SHOW_DEV_TOOLS && showSubmissionApiReturn && lastApiCalls.length > 0 && (
            <div className="space-y-3">
              {lastApiCalls.map((apiCall, index) => (
                <div key={`${apiCall.label}-${apiCall.url}-dedicated-${index}`} className="rounded-lg border bg-muted/20 p-4">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <p className="text-sm font-medium">{apiCall.label}</p>
                    <span className="text-xs text-muted-foreground">{apiCall.method} · HTTP {apiCall.responseStatus ?? 'n/a'}</span>
                  </div>
                  <pre className="mt-3 whitespace-pre-wrap break-words text-xs">
                    {JSON.stringify(apiCall.responseBody ?? null, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {SHOW_DEV_TOOLS && showAdvancedTools && hasTreatmentDetails && (
        <div className="space-y-4">
          {lastSubmissionError && (
            <div ref={submissionErrorRef}>
              <Alert variant="destructive">
                <TriangleAlert className="h-4 w-4" />
                <AlertTitle>Dernière erreur Chorus</AlertTitle>
                <AlertDescription>
                  <p>{lastSubmissionError}</p>
                  {lastSubmissionError.includes('Soumission Chorus échouée (500)') && (
                    <p className="mt-2 text-xs">
                      Le jeton OAuth2 et le bridge Python répondent. Le blocage restant est désormais côté soumission métier Chorus.
                    </p>
                  )}
                </AlertDescription>
              </Alert>
              {lastApiCalls.length > 0 && (
                <div className="mt-3 flex justify-end">
                  <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2">
                    <Switch
                      id="show-submission-error-api-return"
                      checked={showSubmissionApiReturn}
                      onCheckedChange={setShowSubmissionApiReturn}
                    />
                    <Label htmlFor="show-submission-error-api-return" className="text-sm">
                      Afficher retour API
                    </Label>
                  </div>
                </div>
              )}
            </div>
          )}

          {SHOW_DEV_TOOLS && showSubmissionApiReturn && !lastSubmissionResult && lastApiCalls.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Retour API après soumission</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {submissionApiReturnSummary && (
                  <ChorusApiReturnSummaryPanel summary={submissionApiReturnSummary} />
                )}
                {lastApiCalls.map((apiCall, index) => (
                  <div
                    key={`${apiCall.label}-${apiCall.url}-error-return-${index}`}
                    className="rounded-lg border bg-muted/20 p-4"
                  >
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <p className="text-sm font-medium">{apiCall.label}</p>
                      <span className="text-xs text-muted-foreground">
                        {apiCall.method} · HTTP {apiCall.responseStatus ?? 'n/a'}
                      </span>
                    </div>
                    <p className="mt-2 break-all text-xs text-muted-foreground">{apiCall.url}</p>
                    <pre className="mt-3 whitespace-pre-wrap break-words text-xs">
                      {JSON.stringify(apiCall.responseBody ?? null, null, 2)}
                    </pre>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {lastSubmissionResult && (
            <div ref={submissionResultRef}>
              <Card>
                <CardHeader>
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <CardTitle className="text-base">Résultat du traitement Chorus</CardTitle>
                    <div className="flex items-center gap-2">
                      <Switch
                        id="show-submission-api-return-advanced"
                        checked={showSubmissionApiReturn}
                        onCheckedChange={setShowSubmissionApiReturn}
                      />
                      <Label htmlFor="show-submission-api-return-advanced" className="text-sm">
                        Afficher retour API
                      </Label>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <ExtractionInfoRow label="Traitement" value={lastSubmissionResult.ok ? 'Réussi' : 'Échoué'} />
                    <ExtractionInfoRow label="Référence Chorus" value={lastSubmissionResult.externalId} />
                    <ExtractionInfoRow label="Pièces jointes uploadées" value={String(lastSubmissionResult.uploadedFiles.length)} />
                  </div>

                  {SHOW_DEV_TOOLS && showSubmissionApiReturn && submissionApiReturnSummary && (
                    <ChorusApiReturnSummaryPanel summary={submissionApiReturnSummary} />
                  )}

                  {SHOW_DEV_TOOLS && showSubmissionApiReturn && lastSubmissionResult.uploadedFiles.length > 0 && (
                    <div className="rounded-lg border bg-muted/20 p-4">
                      <p className="text-sm font-medium">Retour upload des pièces jointes</p>
                      <div className="mt-3 space-y-3">
                        {lastSubmissionResult.uploadedFiles.map((uploadedFile) => (
                          <div
                            key={`${uploadedFile.id}-${uploadedFile.filename}`}
                            className="rounded-lg border bg-background p-3"
                          >
                            <p className="text-sm font-medium">{uploadedFile.filename}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Identifiant extrait : {uploadedFile.id}
                            </p>
                            <pre className="mt-3 whitespace-pre-wrap break-words text-xs">
                              {JSON.stringify(uploadedFile.response ?? null, null, 2)}
                            </pre>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {SHOW_DEV_TOOLS && showSubmissionApiReturn && (
                    <div className="rounded-lg border bg-muted/20 p-4">
                      <p className="text-sm font-medium">Réponse finale /v1/soumettre</p>
                      <pre className="mt-3 whitespace-pre-wrap break-words text-xs">
                        {JSON.stringify(lastSubmissionResult.response ?? null, null, 2)}
                      </pre>
                    </div>
                  )}

                  {SHOW_DEV_TOOLS && showAdvancedTools && (
                    <div className="rounded-lg border bg-muted/20 p-4">
                      <p className="text-sm font-medium">Payload final soumis par le bridge Python</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Ce JSON correspond au payload réellement envoyé après l’upload du PDF. C’est ici que `pieceJointePrincipale` doit apparaître.
                      </p>
                      <pre className="mt-3 whitespace-pre-wrap break-words text-xs">
                        {JSON.stringify(lastSubmissionResult.submittedPayload ?? null, null, 2)}
                      </pre>
                    </div>
                  )}

                </CardContent>
              </Card>
            </div>
          )}

          {SHOW_DEV_TOOLS && showAdvancedTools && lastApiCalls.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Journal des appels API Chorus</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Dernière tentative de soumission</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Corps de requête et réponses utiles pour débugger l’upload et la soumission. Les secrets et le base64 complet sont masqués.
                    </p>
                  </div>
                  <Badge variant="outline">{lastApiCalls.length} appel(s)</Badge>
                </div>

                <div className="space-y-3">
                  {lastApiCalls.map((apiCall, index) => (
                    <div
                      key={`${apiCall.label}-${apiCall.url}-${index}`}
                      className="rounded-lg border bg-background p-3"
                    >
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <p className="text-sm font-medium">{apiCall.label}</p>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">{apiCall.method}</Badge>
                          <Badge variant={apiCall.responseStatus && apiCall.responseStatus >= 400 ? 'destructive' : 'outline'}>
                            {apiCall.responseStatus ?? 'n/a'}
                          </Badge>
                        </div>
                      </div>
                      <p className="mt-2 break-all text-xs text-muted-foreground">{apiCall.url}</p>

                      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Body envoyé</p>
                          <pre className="mt-2 whitespace-pre-wrap break-words rounded-md border bg-muted/20 p-3 text-xs">
                            {JSON.stringify(apiCall.requestBody ?? null, null, 2)}
                          </pre>
                        </div>
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Réponse API</p>
                          <pre className="mt-2 whitespace-pre-wrap break-words rounded-md border bg-muted/20 p-3 text-xs">
                            {JSON.stringify(apiCall.responseBody ?? null, null, 2)}
                          </pre>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {SHOW_DEV_TOOLS && showAdvancedTools && (pythonUploadCalls.length > 0 || pythonSubmitCalls.length > 0) && (
            <Card>
              <CardHeader><CardTitle className="text-base">Bodies JSON construits par Python</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Cette vue isole les corps JSON réellement construits par le bridge Python pour l’upload PDF et pour la soumission finale.
                </p>

                {pythonUploadCalls.length > 0 && (
                  <div className="rounded-lg border bg-muted/20 p-4">
                    <p className="text-sm font-medium">Upload pièce jointe Python</p>
                    <div className="mt-3 space-y-3">
                      {pythonUploadCalls.map((apiCall, index) => (
                        <div
                          key={`${apiCall.label}-${apiCall.url}-python-upload-${index}`}
                          className="rounded-lg border bg-background p-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-medium">{apiCall.label}</p>
                            <Badge variant={apiCall.responseStatus && apiCall.responseStatus >= 400 ? 'destructive' : 'outline'}>
                              {apiCall.responseStatus ?? 'n/a'}
                            </Badge>
                          </div>
                          <pre className="mt-3 whitespace-pre-wrap break-words text-xs">
                            {JSON.stringify(apiCall.requestBody ?? null, null, 2)}
                          </pre>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {pythonSubmitCalls.length > 0 && (
                  <div className="rounded-lg border bg-muted/20 p-4">
                    <p className="text-sm font-medium">Soumission finale Python</p>
                    <div className="mt-3 space-y-3">
                      {pythonSubmitCalls.map((apiCall, index) => (
                        <div
                          key={`${apiCall.label}-${apiCall.url}-python-submit-${index}`}
                          className="rounded-lg border bg-background p-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-medium">{apiCall.label}</p>
                            <Badge variant={apiCall.responseStatus && apiCall.responseStatus >= 400 ? 'destructive' : 'outline'}>
                              {apiCall.responseStatus ?? 'n/a'}
                            </Badge>
                          </div>
                          <pre className="mt-3 whitespace-pre-wrap break-words text-xs">
                            {JSON.stringify(apiCall.requestBody ?? null, null, 2)}
                          </pre>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
      </div>
      )}

      <div className="space-y-2">
        {submissionBlockReason && (
          <p className="text-right text-xs text-muted-foreground">
            {submissionBlockReason}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => navigate('/invoices')}>Annuler</Button>
          {hasTreatmentDetails && (
            <Button variant="outline" onClick={handleViewTreatmentDetails}>
              Voir les détails du traitement
            </Button>
          )}
          {hasVisibleSubmissionAlerts && !submitting && !extracting ? (
            <Button disabled variant="secondary">
              Corriger avant envoi
            </Button>
          ) : (
            <Button onClick={() => void handleSubmit()} disabled={isSubmissionBlocked}>
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
              {chorusConfig.mode === 'direct' && chorusConfig.enabled ? 'Envoyer à Chorus' : 'Déposer la facture'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
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
import { Upload, FileText, X, CheckCircle, Loader2, Sparkles, TriangleAlert, Eye, FolderOpen } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useReferenceCatalog } from '@/hooks/use-reference-catalog';
import { ChorusApiReturnSummaryPanel } from '@/components/common/ChorusApiReturnSummaryPanel';
import { getInvoice, getInvoiceAttachments } from '@/data/mock-data';
import { ChorusSubmitApiError, createChorusConnector } from '@/lib/chorus/client';
import { buildInvoiceSubmissionPayload } from '@/lib/chorus/mappers';
import { createEmptyInvoiceDraft, formatInvoiceAmountForInput, mergeExtractionIntoDraft } from '@/lib/chorus/normalization';
import { loadChorusConfig, resolveChorusRuntimeConfig } from '@/lib/chorus/storage';
import { prepareInvoiceSubmission } from '@/lib/chorus/preparation';
import { extractInvoiceData } from '@/lib/chorus/extraction';
import { buildChorusTechnicalContext } from '@/lib/chorus/technicalContext';
import { ChorusTransversesClient } from '@/lib/chorus/transversesClient';
import { validateChorusSubmissionPayload } from '@/lib/chorus/validateSubmissionPayload';
import { buildChorusDebugFile } from '@/lib/chorus/debug';
import { describeChorusSubmissionApiReturn, type ChorusApiReturnSummary } from '@/lib/chorus/submissionApiReturn';
import {
  resolveAndHydrateChorusSubmissionPayload,
  type ChorusPayloadHydrationResult,
} from '@/lib/chorus/hydrateSubmissionPayload';
import type { InvoiceDraftFormData, LocalInvoiceExtractionResult } from '@/lib/chorus/types';
import type { ChorusApiDebugEntry, ChorusSubmissionReferenceSnapshot, ChorusSubmitInvoiceResult } from '@/types/chorus';

type BatchSubmissionStatus = 'pending' | 'extracting' | 'submitting' | 'success' | 'error';

interface BatchSubmissionResult {
  id: string;
  file: File;
  displayPath: string;
  status: BatchSubmissionStatus;
  message?: string;
  invoiceNumber?: string;
  externalId?: string;
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
  { value: 'DIVERS', label: 'DIVERS - Pièce jointe complémentaire' },
  { value: 'FACTURE_PDF', label: 'FACTURE_PDF - Facture PDF' },
  { value: 'FACTURE_XML', label: 'FACTURE_XML - Facture XML' },
] as const;

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

function ExtractionInfoRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
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
  const [showOptionalExtractionInfo, setShowOptionalExtractionInfo] = useState(false);
  const [showOptionalMetadata, setShowOptionalMetadata] = useState(false);
  const [showAdvancedTools, setShowAdvancedTools] = useState(false);
  const [showSubmissionApiReturn, setShowSubmissionApiReturn] = useState(false);
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [batchResults, setBatchResults] = useState<BatchSubmissionResult[]>([]);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [batchCurrentFile, setBatchCurrentFile] = useState<string | null>(null);
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
  const selectedPublicService = publicServices.find((service) => service.id === formData.publicServiceId);
  const detectedSupplierName = selectedSupplier?.legalName || extractionResult?.fields.supplierName;
  const detectedPublicCustomerName = selectedPublicCustomer?.legalName || extractionResult?.fields.publicCustomerName;
  const detectedSupplierSiret = formData.supplierSiret || selectedSupplier?.siret || extractionResult?.fields.supplierSiret;
  const detectedCustomerSiret = formData.publicCustomerCode || selectedPublicCustomer?.siret || extractionResult?.fields.publicCustomerSiret;
  const detectedService = selectedPublicService?.codeServiceExecutant
    ? `${selectedPublicService.codeServiceExecutant} — ${selectedPublicService.label}`
    : formData.publicServiceCode || extractionResult?.fields.publicServiceCode || extractionResult?.fields.publicServiceLabel;
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
    success: batchResults.filter((result) => result.status === 'success').length,
    error: batchResults.filter((result) => result.status === 'error').length,
    running: batchResults.filter((result) => result.status === 'extracting' || result.status === 'submitting').length,
  }), [batchResults]);
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
  const submissionBlockReason = extracting
    ? 'Extraction du document en cours.'
    : submitting
      ? 'Soumission Chorus en cours.'
      : hasBlockingSubmissionAlerts
        ? `Soumission verrouillée : ${blockingIssues[0] ?? 'des champs obligatoires restent incomplets.'}`
        : undefined;
  const isSubmissionBlocked = extracting || submitting || hasBlockingSubmissionAlerts;

  const updateBatchResult = useCallback((id: string, patch: Partial<BatchSubmissionResult>) => {
    setBatchResults((currentResults) => currentResults.map((result) => (
      result.id === id ? { ...result, ...patch } : result
    )));
  }, []);

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

    if (fileList && selectedFiles.length === 0) {
      toast({
        title: 'Aucune facture compatible',
        description: 'Sélectionnez des fichiers PDF ou XML.',
        variant: 'destructive',
      });
    }
  }, [toast]);

  const handleBatchSubmit = async () => {
    if (batchFiles.length === 0) {
      toast({
        title: 'Lot vide',
        description: 'Ajoutez plusieurs factures ou un dossier contenant des PDF/XML avant de lancer le lot.',
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

    const connector = createChorusConnector(chorusConfig);

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
        const batchPublicService = publicServices.find((service) => service.id === batchDraft.publicServiceId);
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
          status: 'submitting',
          invoiceNumber: payloadForBatchSubmission.numeroFactureSaisi,
          message: 'Envoi à Chorus en cours.',
        });

        const result = await connector.submitInvoice({
          invoiceData: payloadForBatchSubmission,
          mainFile: batchItem.file,
          attachments: [],
        });
        const summary = describeChorusSubmissionApiReturn(result.response, result.apiCalls);

        updateBatchResult(batchItem.id, {
          status: 'success',
          message: result.externalId ? `Référence retournée: ${result.externalId}` : 'Soumission acceptée.',
          invoiceNumber: payloadForBatchSubmission.numeroFactureSaisi,
          externalId: result.externalId,
          summary,
          apiCalls: result.apiCalls,
        });
      } catch (error) {
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
    toast({
      title: 'Soumission par lot terminée',
      description: 'Le résultat est disponible dans le tableau dédié.',
    });
  };

  const handleSubmit = async (options?: { forceDebug?: boolean }) => {
    const forceDebug = options?.forceDebug === true;
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

    let payloadForSubmission = submissionPayload;
    let validationForSubmission = payloadValidation;

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

      toast({
        title: chorusConfig.mode === 'mock' ? 'Facture mockée' : 'Facture envoyée à Chorus',
        description: result.externalId
          ? `Référence retournée: ${result.externalId}. Le résultat est affiché dans le bloc dédié.`
          : 'La facture a été transmise. Le résultat est affiché dans le bloc dédié.',
      });
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
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowAdvancedTools((current) => !current)}
          >
            {showAdvancedTools ? 'Masquer l’avancé' : 'Afficher l’avancé'}
          </Button>
          <Badge variant={chorusConfig.mode === 'direct' && chorusConfig.enabled ? 'default' : 'secondary'}>
            {chorusConfig.mode === 'direct' && chorusConfig.enabled ? 'Chorus direct' : 'Mode mock'}
          </Badge>
        </div>
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

      {showAdvancedTools && (
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
      )}

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
                <ExtractionInfoRow label="Fournisseur" value={detectedSupplierName} />
                <ExtractionInfoRow label="N° facture" value={formData.supplierInvoiceNumber} />
                <ExtractionInfoRow label="Client public" value={detectedPublicCustomerName} />
                <ExtractionInfoRow label="Service destinataire" value={detectedService} />
                <ExtractionInfoRow label="Date facture" value={formData.invoiceDate} />
                <ExtractionInfoRow label="Montant TTC" value={formatAmountForDisplay(formData.totalAmountTtc)} />
              </div>

              <div className="rounded-lg border bg-muted/10 p-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-medium">Détails d’extraction</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Contrôle détaillé du document et des champs secondaires.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowOptionalExtractionInfo((current) => !current)}
                  >
                    {showOptionalExtractionInfo ? 'Masquer les détails' : 'Afficher les détails'}
                  </Button>
                </div>

                {showOptionalExtractionInfo && (
                  <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                    <ExtractionInfoRow label="Échéance" value={extractionResult.fields.dueDate} />
                    <ExtractionInfoRow label="Mode paiement" value={extractionResult.fields.paymentMode} />
                    <ExtractionInfoRow label="Devise" value={formData.currencyCode || extractionResult.fields.currencyCode} />
                    <ExtractionInfoRow label="SIRET fournisseur" value={detectedSupplierSiret} />
                    <ExtractionInfoRow label="SIRET destinataire" value={detectedCustomerSiret} />
                    <ExtractionInfoRow label="Montant HT" value={formatAmountForDisplay(formData.totalAmountHt)} />
                    <ExtractionInfoRow label="Montant TVA" value={formatExtractedAmountForDisplay(extractionResult.fields.totalVat)} />
                    <DocumentPreviewCard
                      file={mainFile}
                      previewUrl={mainFilePreviewUrl ?? undefined}
                      extractedText={extractionResult.rawText}
                      rawTextPreview={extractionResult.rawTextPreview}
                    />
                  </div>
                )}
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Données facture</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-4">
            {showAdvancedTools && loadingReferences && (
              <div className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
                Chargement des référentiels fournisseur et des éventuelles listes API configurées…
              </div>
            )}

            {showAdvancedTools && !loadingReferences && !referenceCatalogError && (rawChorusConfig.referenceAnnuaireJsonUrl || rawChorusConfig.referenceAnnuaireXmlUrl) && referenceCatalogMetadata.publicCustomersSource === 'empty' && referenceCatalogMetadata.publicServicesSource === 'empty' && (
              <div className="rounded-lg border bg-warning/5 p-3 text-sm text-muted-foreground">
                L&apos;annuaire Chorus massif n&apos;est pas chargé automatiquement sur cet écran pour éviter les plantages pendant l&apos;upload. Il reste consultable dans `Référentiels`.
              </div>
            )}

            {showAdvancedTools && !loadingReferences && !referenceCatalogError && (publicCustomers.length > 0 || publicServices.length > 0 || suppliers.length > 0) && (
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
          <div className={`rounded-lg border p-4 ${
            submissionPreparation.readiness === 'ready'
              ? 'border-emerald-200 bg-emerald-50/60'
              : submissionPreparation.readiness === 'review'
                ? 'border-amber-200 bg-amber-50/60'
                : 'border-red-200 bg-red-50/60'
          }`}>
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

          {showAdvancedTools && isDirectMode && (
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

          {showAdvancedTools && isDirectMode && (
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
                      disabled={extracting || submitting || !mainFile}
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
                Ajoutez plusieurs factures ou un dossier complet, puis suivez le résultat facture par facture.
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
              onClick={() => void handleBatchSubmit()}
              disabled={batchSubmitting || batchFiles.length === 0}
            >
              {batchSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
              Lancer le lot
            </Button>
            {batchFiles.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setBatchFiles([]);
                  setBatchResults([]);
                  setBatchCurrentFile(null);
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
              <AlertTitle>Traitement du lot</AlertTitle>
              <AlertDescription>{batchCurrentFile}</AlertDescription>
            </Alert>
          )}

          {batchFiles.length > 0 && batchResults.length === 0 && (
            <div className="rounded-lg border bg-muted/20 p-4">
              <p className="text-sm font-medium">Fichiers prêts pour le lot</p>
              <div className="mt-3 max-h-48 space-y-2 overflow-auto">
                {batchFiles.map((file, index) => (
                  <div key={buildBatchResultId(file, index)} className="flex items-center justify-between gap-3 rounded-md border bg-background p-2">
                    <span className="min-w-0 truncate text-sm">{getFileDisplayPath(file)}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} Ko</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {batchResults.length > 0 && (
            <div className="rounded-lg border bg-muted/20 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-medium">Résultat du lot</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {batchSummary.success} réussie(s), {batchSummary.error} en échec, {batchSummary.running} en cours sur {batchSummary.total}.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="default">{batchSummary.success} OK</Badge>
                  <Badge variant={batchSummary.error > 0 ? 'destructive' : 'outline'}>{batchSummary.error} KO</Badge>
                </div>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="p-2 text-left font-medium">Facture</th>
                      <th className="p-2 text-left font-medium">Statut</th>
                      <th className="p-2 text-left font-medium">N° facture</th>
                      <th className="p-2 text-left font-medium">Référence</th>
                      <th className="p-2 text-left font-medium">Retour</th>
                      <th className="p-2 text-left font-medium">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchResults.map((result) => (
                      <tr key={result.id} className="border-b align-top">
                        <td className="max-w-[220px] p-2">
                          <p className="truncate font-medium">{result.displayPath}</p>
                        </td>
                        <td className="p-2">
                          <Badge variant={getBatchStatusBadgeVariant(result.status)}>
                            {getBatchStatusLabel(result.status)}
                          </Badge>
                        </td>
                        <td className="p-2">{result.invoiceNumber || '-'}</td>
                        <td className="p-2">{result.externalId || '-'}</td>
                        <td className="p-2">
                          <div className="flex flex-wrap gap-1">
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
                          </div>
                        </td>
                        <td className="max-w-[280px] p-2 text-xs text-muted-foreground">
                          {result.message || result.summary?.libelle || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
            {hasTreatmentDetails && (
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

          {showSubmissionApiReturn && lastSubmissionResult && (
            <div className="rounded-lg border bg-muted/20 p-4">
              <p className="text-sm font-medium">Réponse finale /v1/soumettre</p>
              <pre className="mt-3 whitespace-pre-wrap break-words text-xs">
                {JSON.stringify(lastSubmissionResult.response ?? null, null, 2)}
              </pre>
            </div>
          )}

          {showSubmissionApiReturn && lastApiCalls.length > 0 && (
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

      {showAdvancedTools && hasTreatmentDetails && (
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

          {showSubmissionApiReturn && !lastSubmissionResult && lastApiCalls.length > 0 && (
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

                  {showSubmissionApiReturn && submissionApiReturnSummary && (
                    <ChorusApiReturnSummaryPanel summary={submissionApiReturnSummary} />
                  )}

                  {showSubmissionApiReturn && lastSubmissionResult.uploadedFiles.length > 0 && (
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

                  {showSubmissionApiReturn && (
                    <div className="rounded-lg border bg-muted/20 p-4">
                      <p className="text-sm font-medium">Réponse finale /v1/soumettre</p>
                      <pre className="mt-3 whitespace-pre-wrap break-words text-xs">
                        {JSON.stringify(lastSubmissionResult.response ?? null, null, 2)}
                      </pre>
                    </div>
                  )}

                  {showAdvancedTools && (
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

          {showAdvancedTools && lastApiCalls.length > 0 && (
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

          {showAdvancedTools && (pythonUploadCalls.length > 0 || pythonSubmitCalls.length > 0) && (
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

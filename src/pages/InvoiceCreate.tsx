import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Upload, FileText, X, CheckCircle, Loader2, Sparkles, TriangleAlert, Eye } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useReferenceCatalog } from '@/hooks/use-reference-catalog';
import { ChorusSubmitApiError, createChorusConnector } from '@/lib/chorus/client';
import { buildInvoiceSubmissionPayload } from '@/lib/chorus/mappers';
import { createEmptyInvoiceDraft, mergeExtractionIntoDraft } from '@/lib/chorus/normalization';
import { loadChorusConfig, resolveChorusRuntimeConfig } from '@/lib/chorus/storage';
import { prepareInvoiceSubmission } from '@/lib/chorus/preparation';
import { extractInvoiceData } from '@/lib/chorus/extraction';
import { buildChorusTechnicalContext } from '@/lib/chorus/technicalContext';
import { ChorusTransversesClient } from '@/lib/chorus/transversesClient';
import { validateChorusSubmissionPayload } from '@/lib/chorus/validateSubmissionPayload';
import { buildChorusDebugFile } from '@/lib/chorus/debug';
import {
  resolveAndHydrateChorusSubmissionPayload,
  type ChorusPayloadHydrationResult,
} from '@/lib/chorus/hydrateSubmissionPayload';
import type { InvoiceDraftFormData, LocalInvoiceExtractionResult } from '@/lib/chorus/types';
import type { ChorusApiDebugEntry, ChorusSubmissionReferenceSnapshot, ChorusSubmitInvoiceResult } from '@/types/chorus';

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
  const { toast } = useToast();
  const [mainFile, setMainFile] = useState<File | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
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
  const submissionErrorRef = useRef<HTMLDivElement | null>(null);
  const submissionResultRef = useRef<HTMLDivElement | null>(null);
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
  const services = formData.publicCustomerId ? publicServices.filter((service) => service.publicCustomerId === formData.publicCustomerId && service.active) : [];
  const selectedSupplier = suppliers.find((supplier) => supplier.id === formData.supplierOrganizationId);
  const selectedPublicCustomer = publicCustomers.find((customer) => customer.id === formData.publicCustomerId);
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
    extraction: extractionResult,
    chorus: chorusTechnicalContext,
    mainFileName: mainFile?.name,
  }), [
    formData,
    selectedSupplier,
    selectedPublicCustomer,
    selectedPublicService,
    extractionResult,
    chorusTechnicalContext,
    mainFile,
  ]);
  const payloadValidation = useMemo(() => validateChorusSubmissionPayload(submissionPayload), [submissionPayload]);
  const effectivePayloadValidation = resolvedSubmission?.validation ?? payloadValidation;
  const effectiveSubmissionPayload = resolvedSubmission?.payload ?? submissionPayload;
  const hasTreatmentDetails = Boolean(lastSubmissionResult || lastSubmissionError);
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
  const isSubmissionBlocked = extracting || submitting || (isDirectMode && !submissionPreparation.validation.valid);

  const handleViewTreatmentDetails = useCallback(() => {
    const target = lastSubmissionResult
      ? submissionResultRef.current
      : lastSubmissionError
        ? submissionErrorRef.current
        : null;

    target?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }, [lastSubmissionError, lastSubmissionResult]);

  useEffect(() => {
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

  const handleSubmit = async (options?: { forceDebug?: boolean }) => {
    const forceDebug = options?.forceDebug === true;
    if (!mainFile) {
      toast({ title: 'Erreur', description: 'Veuillez déposer une facture principale.', variant: 'destructive' });
      return;
    }

    if (isDirectMode && !submissionPreparation.validation.valid && !forceDebug) {
      toast({
        title: 'Soumission bloquée',
        description: submissionPreparation.validation.errors[0]?.message || 'Complétez les métadonnées obligatoires avant l’envoi.',
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
        attachments,
        debugBypassValidation: forceDebug,
      });
      setLastSubmissionResult(result);
      setLastApiCalls(result.apiCalls);

      toast({
        title: chorusConfig.mode === 'mock' ? 'Facture mockée' : 'Facture envoyée à Chorus',
        description: result.externalId
          ? `Référence retournée: ${result.externalId}. Les détails de traitement sont affichés ci-dessous.`
          : 'La facture a été transmise. Les détails de traitement sont affichés ci-dessous.',
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
          <p className="text-sm text-muted-foreground">Déposez une facture et ses pièces jointes complémentaires</p>
        </div>
        <Badge variant={chorusConfig.mode === 'direct' && chorusConfig.enabled ? 'default' : 'secondary'}>
          {chorusConfig.mode === 'direct' && chorusConfig.enabled ? 'Chorus direct' : 'Mode mock'}
        </Badge>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Facture principale</CardTitle></CardHeader>
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
        <CardHeader><CardTitle className="text-base">Pièces jointes complémentaires</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-3">
            {attachments.map((file, i) => (
              <div key={i} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  <span className="text-sm">{file.name}</span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}><X className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button variant="outline" onClick={() => document.getElementById('att-upload')?.click()}>
              <Upload className="mr-2 h-4 w-4" /> Ajouter un fichier
            </Button>
            <input id="att-upload" type="file" className="hidden" multiple onChange={e => {
              if (e.target.files) setAttachments(prev => [...prev, ...Array.from(e.target.files)]);
            }} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Préremplissage automatique</CardTitle></CardHeader>
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
                <div className="flex items-center gap-2">
                  <Badge variant={extractionResult.requiresReview ? 'secondary' : 'default'}>
                    {extractionResult.requiresReview ? 'Contrôle recommandé' : 'Préremplissage fiable'}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    Confiance {Math.round(extractionResult.confidence * 100)}%
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <ExtractionInfoRow label="Fournisseur" value={detectedSupplierName} />
                <ExtractionInfoRow label="N° facture" value={formData.supplierInvoiceNumber} />
                <ExtractionInfoRow label="Date facture" value={formData.invoiceDate} />
                <ExtractionInfoRow label="Échéance" value={extractionResult.fields.dueDate} />
                <ExtractionInfoRow label="Client public" value={detectedPublicCustomerName} />
                <ExtractionInfoRow label="Devise" value={formData.currencyCode || extractionResult.fields.currencyCode} />
                <ExtractionInfoRow label="SIRET fournisseur" value={detectedSupplierSiret} />
                <ExtractionInfoRow label="SIRET destinataire" value={detectedCustomerSiret} />
                <ExtractionInfoRow label="Service détecté" value={detectedService} />
                <ExtractionInfoRow label="Montant HT" value={formatAmountForDisplay(formData.totalAmountHt)} />
                <ExtractionInfoRow label="Montant TVA" value={formatExtractedAmountForDisplay(extractionResult.fields.totalVat)} />
                <ExtractionInfoRow label="Montant TTC" value={formatAmountForDisplay(formData.totalAmountTtc)} />
                <DocumentPreviewCard
                  file={mainFile}
                  previewUrl={mainFilePreviewUrl ?? undefined}
                  extractedText={extractionResult.rawText}
                  rawTextPreview={extractionResult.rawTextPreview}
                />
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
        <CardHeader><CardTitle className="text-base">Métadonnées initiales (optionnel)</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-4">
            {loadingReferences && (
              <div className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
                Chargement des référentiels fournisseur et des éventuelles listes API configurées…
              </div>
            )}

            {!loadingReferences && !referenceCatalogError && (rawChorusConfig.referenceAnnuaireJsonUrl || rawChorusConfig.referenceAnnuaireXmlUrl) && referenceCatalogMetadata.publicCustomersSource === 'empty' && referenceCatalogMetadata.publicServicesSource === 'empty' && (
              <div className="rounded-lg border bg-warning/5 p-3 text-sm text-muted-foreground">
                L&apos;annuaire Chorus massif n&apos;est pas chargé automatiquement sur cet écran pour éviter les plantages pendant l&apos;upload. Il reste consultable dans `Référentiels`.
              </div>
            )}

            {!loadingReferences && !referenceCatalogError && (publicCustomers.length > 0 || publicServices.length > 0 || suppliers.length > 0) && (
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

          <div className="rounded-lg border bg-muted/10 p-3 text-sm">
            <p className="font-medium">Champs nécessaires pour un envoi minimal</p>
            <p className="mt-1 text-muted-foreground">
              Fournisseur, numéro de facture, destinataire, service, date de facture et montant TTC.
              Les autres informations restent optionnelles et peuvent être ajoutées seulement si le dossier l’exige.
            </p>
          </div>

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
              <Select value={formData.publicServiceId} onValueChange={(value) => setFormData((current) => ({ ...current, publicServiceId: value }))} disabled={!formData.publicCustomerId}>
                <SelectTrigger>
                  <SelectValue placeholder={formData.publicCustomerId ? 'Sélectionner...' : 'Choisir un client d\'abord'} />
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
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-medium">
                {submissionPreparation.readiness === 'ready'
                  ? 'Le dossier est prêt pour la soumission API.'
                  : submissionPreparation.readiness === 'review'
                    ? 'Le dossier est quasi prêt, avec contrôle humain recommandé.'
                    : 'Des informations bloquantes manquent encore avant l’envoi Chorus.'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Flux prévu: extraction locale, contrôle métier, dépôt PDF, puis soumission API sans repasser par l’interprétation du portail.
              </p>
            </div>
            <div className="flex items-center gap-2">
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
              <Badge variant="outline">{submissionPreparation.suggestedStatus}</Badge>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <ExtractionInfoRow label="Erreurs bloquantes" value={String(submissionPreparation.validation.errors.length)} />
            <ExtractionInfoRow label="Avertissements" value={String(submissionPreparation.validation.warnings.length)} />
            <ExtractionInfoRow label="Devise normalisée" value={submissionPreparation.normalized.currencyCode} />
            <ExtractionInfoRow
              label="Montant TTC normalisé"
              value={submissionPreparation.normalized.totalAmountTtc !== undefined ? String(submissionPreparation.normalized.totalAmountTtc) : undefined}
            />
          </div>

          {submissionPreparation.validation.errors.length > 0 && (
            <Alert variant="destructive">
              <TriangleAlert className="h-4 w-4" />
              <AlertTitle>Blocages à corriger</AlertTitle>
              <AlertDescription>
                <ul className="list-disc space-y-1 pl-4">
                  {submissionPreparation.validation.errors.map((error) => (
                    <li key={`${error.code}-${error.field}`}>{error.message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {submissionPreparation.validation.warnings.length > 0 && (
            <Alert>
              <TriangleAlert className="h-4 w-4" />
              <AlertTitle>Contrôles recommandés</AlertTitle>
              <AlertDescription>
                <ul className="list-disc space-y-1 pl-4">
                  {submissionPreparation.validation.warnings.map((warning) => (
                    <li key={`${warning.code}-${warning.field}`}>{warning.message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {isDirectMode && effectivePayloadValidation.errors.length > 0 && (
            <Alert variant="destructive">
              <TriangleAlert className="h-4 w-4" />
              <AlertTitle>{resolvedSubmission ? 'Contexte Chorus encore manquant après enrichissement' : 'Contexte technique Chorus manquant'}</AlertTitle>
              <AlertDescription>
                <ul className="list-disc space-y-1 pl-4">
                  {effectivePayloadValidation.errors.map((error) => (
                    <li key={`${error.code}-${error.path}`}>{error.message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {isDirectMode && effectivePayloadValidation.warnings.length > 0 && (
            <Alert>
              <TriangleAlert className="h-4 w-4" />
              <AlertTitle>{resolvedSubmission ? 'Vérifications payload Chorus après enrichissement' : 'Vérifications payload Chorus'}</AlertTitle>
              <AlertDescription>
                <ul className="list-disc space-y-1 pl-4">
                  {effectivePayloadValidation.warnings.map((warning) => (
                    <li key={`${warning.code}-${warning.path}`}>{warning.message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {isDirectMode && (
            <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-medium">Contrôle référentiel Chorus Transverses</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Vérifie avant soumission les cadres, devises, taux TVA, modes de règlement, structures fournisseur,
                    coordonnées bancaires, destinataire et service exécutant.
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

          {submissionPreparation.recommendations.length > 0 && (
            <div className="rounded-lg border bg-muted/20 p-4">
              <p className="text-sm font-medium">Actions suggérées</p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                {submissionPreparation.recommendations.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {lastSubmissionError && (
            <div ref={submissionErrorRef}>
            <Alert variant="destructive">
              <TriangleAlert className="h-4 w-4" />
              <AlertTitle>Dernière erreur Chorus</AlertTitle>
              <AlertDescription>
                <p>{lastSubmissionError}</p>
                {lastSubmissionError.includes('Soumission Chorus échouée (500)') && (
                  <p className="mt-2 text-xs">
                    Le jeton OAuth2 et l’appel API passent désormais. Le blocage restant est côté soumission métier Chorus,
                    très probablement sur la forme du JSON envoyé à <code>/v1/soumettre</code>.
                  </p>
                )}
              </AlertDescription>
            </Alert>
            </div>
          )}

          {isDirectMode && (
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
                  <div className="flex justify-end">
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

      {lastSubmissionResult && (
        <div ref={submissionResultRef}>
        <Card>
          <CardHeader><CardTitle className="text-base">Résultat du traitement Chorus</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <ExtractionInfoRow label="Traitement" value={lastSubmissionResult.ok ? 'Réussi' : 'Échoué'} />
              <ExtractionInfoRow label="Référence Chorus" value={lastSubmissionResult.externalId} />
              <ExtractionInfoRow label="Pièces jointes uploadées" value={String(lastSubmissionResult.uploadedFiles.length)} />
            </div>

            {lastSubmissionResult.uploadedFiles.length > 0 && (
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

            <div className="rounded-lg border bg-muted/20 p-4">
              <p className="text-sm font-medium">Réponse finale /v1/soumettre</p>
              <pre className="mt-3 whitespace-pre-wrap break-words text-xs">
                {JSON.stringify(lastSubmissionResult.response ?? null, null, 2)}
              </pre>
            </div>

          </CardContent>
        </Card>
        </div>
      )}

      {lastApiCalls.length > 0 && (
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

      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={() => navigate('/invoices')}>Annuler</Button>
        {isDirectMode && (
          <Button variant="outline" onClick={handleViewTreatmentDetails} disabled={!hasTreatmentDetails}>
            Voir les détails du traitement
          </Button>
        )}
        <Button onClick={() => void handleSubmit()} disabled={isSubmissionBlocked}>
          {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
          {chorusConfig.mode === 'direct' && chorusConfig.enabled ? 'Envoyer à Chorus' : 'Déposer la facture'}
        </Button>
        {isDirectMode && (
          <Button variant="destructive" onClick={() => void handleSubmit({ forceDebug: true })} disabled={extracting || submitting || !mainFile}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TriangleAlert className="mr-2 h-4 w-4" />}
            Forcer l’envoi debug
          </Button>
        )}
      </div>
    </div>
  );
}

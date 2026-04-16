import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { publicCustomers, publicServices, suppliers } from '@/data/mock-data';
import { Upload, FileText, X, CheckCircle, Loader2, Sparkles, TriangleAlert } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { createChorusConnector } from '@/lib/chorus/client';
import { buildInvoiceSubmissionPayload } from '@/lib/chorus/mappers';
import { loadChorusConfig } from '@/lib/chorus/storage';
import { extractInvoiceData, type LocalInvoiceExtractionResult } from '@/lib/chorus/extraction';
import { prepareInvoiceSubmission } from '@/lib/chorus/preparation';

function formatAmountForInput(value?: number): string {
  if (value === undefined || Number.isNaN(value)) {
    return '';
  }

  return value.toFixed(2).replace('.', ',');
}

function formatAmountForDisplay(value?: string): string {
  if (!value?.trim()) {
    return 'Non détecté';
  }

  return value;
}

function ExtractionInfoRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium">{value || 'Non détecté'}</p>
    </div>
  );
}

export default function InvoiceCreate() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [mainFile, setMainFile] = useState<File | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    supplierOrganizationId: '',
    supplierInvoiceNumber: '',
    publicServiceId: '',
    engagementNumber: '',
    marketNumber: '',
    purchaseOrderNumber: '',
    invoiceDate: '',
    currencyCode: '',
    totalAmountHt: '',
    totalAmountTtc: '',
  });
  const [extracting, setExtracting] = useState(false);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [extractionResult, setExtractionResult] = useState<LocalInvoiceExtractionResult | null>(null);

  const chorusConfig = loadChorusConfig();
  const services = selectedCustomer ? publicServices.filter(s => s.publicCustomerId === selectedCustomer && s.active) : [];
  const selectedSupplier = suppliers.find((supplier) => supplier.id === formData.supplierOrganizationId);
  const selectedPublicCustomer = publicCustomers.find((customer) => customer.id === selectedCustomer);
  const selectedPublicService = publicServices.find((service) => service.id === formData.publicServiceId);
  const detectedSupplierSiret = selectedSupplier?.siret || extractionResult?.fields.supplierSiret;
  const detectedCustomerSiret = selectedPublicCustomer?.siret || extractionResult?.fields.publicCustomerSiret;
  const detectedServiceCode = selectedPublicService?.codeServiceExecutant || extractionResult?.fields.publicServiceCode;
  const submissionPreparation = prepareInvoiceSubmission({
    formData: {
      ...formData,
      publicCustomerId: selectedCustomer,
    },
    supplier: selectedSupplier,
    publicCustomer: selectedPublicCustomer,
    publicService: selectedPublicService,
    availableServices: services,
    extraction: extractionResult,
  });
  const isDirectMode = chorusConfig.mode === 'direct' && chorusConfig.enabled;
  const isSubmissionBlocked = extracting || submitting || (isDirectMode && !submissionPreparation.validation.valid);

  useEffect(() => {
    if (!mainFile) {
      setExtracting(false);
      setExtractionError(null);
      setExtractionResult(null);
      return;
    }

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

        if (result.fields.publicCustomerId) {
          setSelectedCustomer(result.fields.publicCustomerId);
        }

        setFormData((current) => ({
          ...current,
          supplierOrganizationId: result.fields.supplierOrganizationId ?? current.supplierOrganizationId,
          supplierInvoiceNumber: result.fields.supplierInvoiceNumber ?? current.supplierInvoiceNumber,
          publicServiceId: result.fields.publicServiceId ?? current.publicServiceId,
          engagementNumber: result.fields.engagementNumber ?? current.engagementNumber,
          marketNumber: result.fields.marketNumber ?? current.marketNumber,
          purchaseOrderNumber: result.fields.purchaseOrderNumber ?? current.purchaseOrderNumber,
          invoiceDate: result.fields.invoiceDate ?? current.invoiceDate,
          currencyCode: result.fields.currencyCode ?? current.currencyCode,
          totalAmountHt: result.fields.totalAmountHt !== undefined
            ? formatAmountForInput(result.fields.totalAmountHt)
            : current.totalAmountHt,
          totalAmountTtc: result.fields.totalAmountTtc !== undefined
            ? formatAmountForInput(result.fields.totalAmountTtc)
            : current.totalAmountTtc,
        }));
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
  }, [mainFile]);

  const handleMainDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && (file.type === 'application/pdf' || file.type === 'text/xml' || file.name.endsWith('.xml'))) {
      setMainFile(file);
    }
  }, []);

  const handleSubmit = async () => {
    if (!mainFile) {
      toast({ title: 'Erreur', description: 'Veuillez déposer une facture principale.', variant: 'destructive' });
      return;
    }

    if (isDirectMode && !submissionPreparation.validation.valid) {
      toast({
        title: 'Soumission bloquée',
        description: submissionPreparation.validation.errors[0]?.message || 'Complétez les métadonnées obligatoires avant l’envoi.',
        variant: 'destructive',
      });
      return;
    }

    setSubmitting(true);
    try {
      const connector = createChorusConnector(chorusConfig);
      const payload = buildInvoiceSubmissionPayload({
        ...formData,
        publicCustomerId: selectedCustomer,
      }, {
        supplier: selectedSupplier,
        publicCustomer: selectedPublicCustomer,
        publicService: selectedPublicService,
        extraction: extractionResult,
      });

      const result = await connector.submitInvoice({
        invoiceData: payload,
        mainFile,
        attachments,
      });

      toast({
        title: chorusConfig.mode === 'mock' ? 'Facture mockée' : 'Facture envoyée à Chorus',
        description: result.externalId
          ? `Référence retournée: ${result.externalId}`
          : 'La facture a été transmise.',
      });
      navigate('/invoices');
    } catch (error) {
      toast({
        title: 'Échec de soumission',
        description: error instanceof Error ? error.message : 'Erreur inconnue',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
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
                <ExtractionInfoRow label="N° facture" value={formData.supplierInvoiceNumber} />
                <ExtractionInfoRow label="Date facture" value={formData.invoiceDate} />
                <ExtractionInfoRow label="Devise" value={formData.currencyCode || extractionResult.fields.currencyCode} />
                <ExtractionInfoRow label="SIRET fournisseur" value={detectedSupplierSiret} />
                <ExtractionInfoRow label="SIRET destinataire" value={detectedCustomerSiret} />
                <ExtractionInfoRow label="Code service" value={detectedServiceCode} />
                <ExtractionInfoRow label="Montant HT" value={formatAmountForDisplay(formData.totalAmountHt)} />
                <ExtractionInfoRow label="Montant TTC" value={formatAmountForDisplay(formData.totalAmountTtc)} />
                <ExtractionInfoRow label="Aperçu texte" value={extractionResult.rawTextPreview || 'Texte trop pauvre pour aperçu'} />
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Fournisseur</Label>
              <Select value={formData.supplierOrganizationId} onValueChange={v => setFormData(p => ({ ...p, supplierOrganizationId: v }))}>
                <SelectTrigger><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
                <SelectContent>
                  {suppliers.filter(s => s.active).map(s => <SelectItem key={s.id} value={s.id}>{s.legalName} ({s.siret})</SelectItem>)}
                </SelectContent>
              </Select>
              {detectedSupplierSiret && <p className="text-xs text-muted-foreground">SIRET détecté: {detectedSupplierSiret}</p>}
            </div>
            <div className="space-y-2">
              <Label>N° Facture</Label>
              <Input placeholder="FAC-2024-..." value={formData.supplierInvoiceNumber} onChange={e => setFormData(p => ({ ...p, supplierInvoiceNumber: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Client public</Label>
              <Select value={selectedCustomer} onValueChange={v => { setSelectedCustomer(v); setFormData(p => ({ ...p, publicServiceId: '' })); }}>
                <SelectTrigger><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
                <SelectContent>
                  {publicCustomers.filter(c => c.active).map(c => <SelectItem key={c.id} value={c.id}>{c.legalName} ({c.codeDestinataire})</SelectItem>)}
                </SelectContent>
              </Select>
              {detectedCustomerSiret && <p className="text-xs text-muted-foreground">SIRET destinataire: {detectedCustomerSiret}</p>}
            </div>
            <div className="space-y-2">
              <Label>Service destinataire</Label>
              <Select value={formData.publicServiceId} onValueChange={v => setFormData(p => ({ ...p, publicServiceId: v }))} disabled={!selectedCustomer}>
                <SelectTrigger><SelectValue placeholder={selectedCustomer ? 'Sélectionner...' : 'Choisir un client d\'abord'} /></SelectTrigger>
                <SelectContent>
                  {services.map(s => <SelectItem key={s.id} value={s.id}>{s.codeServiceExecutant} — {s.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {detectedServiceCode && <p className="text-xs text-muted-foreground">Code service: {detectedServiceCode}</p>}
            </div>
            <div className="space-y-2">
              <Label>Date facture</Label>
              <Input type="date" value={formData.invoiceDate} onChange={e => setFormData(p => ({ ...p, invoiceDate: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Devise</Label>
              <Input
                placeholder="EUR"
                maxLength={3}
                value={formData.currencyCode}
                onChange={e => setFormData(p => ({ ...p, currencyCode: e.target.value.toUpperCase() }))}
              />
            </div>

            <Separator className="col-span-full" />

            <div className="space-y-2">
              <Label>N° Engagement</Label>
              <Input placeholder="ENG-..." value={formData.engagementNumber} onChange={e => setFormData(p => ({ ...p, engagementNumber: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>N° Marché</Label>
              <Input placeholder="MA-..." value={formData.marketNumber} onChange={e => setFormData(p => ({ ...p, marketNumber: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>N° Bon de commande</Label>
              <Input placeholder="BC-..." value={formData.purchaseOrderNumber} onChange={e => setFormData(p => ({ ...p, purchaseOrderNumber: e.target.value }))} />
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
              <Label>Montant TTC</Label>
              <Input
                inputMode="decimal"
                placeholder="14400,00"
                value={formData.totalAmountTtc}
                onChange={e => setFormData(p => ({ ...p, totalAmountTtc: e.target.value }))}
              />
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
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={() => navigate('/invoices')}>Annuler</Button>
        <Button onClick={handleSubmit} disabled={isSubmissionBlocked}>
          {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
          {chorusConfig.mode === 'direct' && chorusConfig.enabled ? 'Envoyer à Chorus' : 'Déposer la facture'}
        </Button>
      </div>
    </div>
  );
}

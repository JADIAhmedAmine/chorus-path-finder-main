import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  UploadCloud, FileUp, Loader2, CheckCircle2, XCircle, AlertTriangle, ShieldAlert,
  ChevronDown, RefreshCw, Info, Lightbulb, Wand2, FileText, Paperclip, ClipboardCheck,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader } from '@/components/common/PageHeader';
import { ProcessExplanationCard } from '@/components/flux/ProcessExplanationCard';
import { PAGE_EXPLANATIONS } from '@/lib/flux/content';
import { ApiErrorCard } from '@/components/common/ApiErrorCard';
import { useToast } from '@/hooks/use-toast';
import { loadChorusConfig } from '@/lib/chorus/storage';
import { cn } from '@/lib/utils';
import {
  businessValidateChorusFlux,
  depositChorusFlux,
  detectChorusFlux,
  fetchChorusFluxFormats,
  fetchChorusFluxGuide,
  fetchChorusFluxSyntaxes,
  type ChorusFluxDepositResult,
  type ChorusFluxGuideEntry,
} from '@/lib/chorus/fluxDeposit';
import {
  buildFluxRecommendation,
  detectedTypeLabel,
  evaluateFluxCompatibility,
  type FluxBusinessValidation,
  type FluxDetected,
  type FluxMetadata,
  type FluxRecommendationStatus,
  type FluxSeverity,
} from '@/lib/chorus/fluxDetection';
import { validateG2BRecipient, type G2BRecipientValidation } from '@/lib/g2b/g2bAnnuaireApi';

const ACCEPTED_EXTENSIONS = ['.xml', '.pdf'];
const ACCEPT_ATTR = '.xml,.pdf,application/xml,text/xml,application/pdf';

function hasAllowedExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} o`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} Ko`;
  return `${(size / (1024 * 1024)).toFixed(2)} Mo`;
}

function formatAmount(value: number | null, currency: string | null): string {
  if (value === null) return '—';
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: currency || 'EUR' }).format(value);
  } catch {
    return value.toFixed(2);
  }
}

const STATUS_VISUALS: Record<string, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  ACCEPTED: { label: 'Accepté', className: 'bg-success/15 text-success ring-1 ring-success/30', icon: CheckCircle2 },
  REJECTED: { label: 'Rejeté', className: 'bg-warning/15 text-warning ring-1 ring-warning/30', icon: XCircle },
  BLOCKED_LOCAL_VALIDATION: { label: 'Bloqué (validation locale)', className: 'bg-warning/15 text-warning ring-1 ring-warning/30', icon: ShieldAlert },
  BLOCKED_BUSINESS_VALIDATION: { label: 'Bloqué (données métier)', className: 'bg-destructive/15 text-destructive ring-1 ring-destructive/30', icon: ShieldAlert },
  ERROR: { label: 'Erreur', className: 'bg-destructive/15 text-destructive ring-1 ring-destructive/30', icon: AlertTriangle },
};

const BIZ_VISUALS: Record<FluxSeverity, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  OK: { label: 'Données métier OK', className: 'bg-success/15 text-success ring-1 ring-success/30', icon: CheckCircle2 },
  WARNING: { label: 'À vérifier', className: 'bg-warning/15 text-warning ring-1 ring-warning/30', icon: AlertTriangle },
  BLOCKING: { label: 'Dépôt bloqué', className: 'bg-destructive/15 text-destructive ring-1 ring-destructive/30', icon: ShieldAlert },
};

const SEVERITY_VISUALS: Record<FluxSeverity, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  OK: { label: 'Compatible', className: 'bg-success/15 text-success ring-1 ring-success/30', icon: CheckCircle2 },
  WARNING: { label: 'À vérifier', className: 'bg-warning/15 text-warning ring-1 ring-warning/30', icon: AlertTriangle },
  BLOCKING: { label: 'Incompatible', className: 'bg-destructive/15 text-destructive ring-1 ring-destructive/30', icon: ShieldAlert },
};

const RECO_VISUALS: Record<FluxRecommendationStatus, { className: string; icon: typeof CheckCircle2 }> = {
  recommended: { className: 'bg-success/15 text-success ring-1 ring-success/30', icon: CheckCircle2 },
  warning: { className: 'bg-warning/15 text-warning ring-1 ring-warning/30', icon: AlertTriangle },
  blocked: { className: 'bg-destructive/15 text-destructive ring-1 ring-destructive/30', icon: ShieldAlert },
};

export default function FluxDepositPage() {
  const { toast } = useToast();
  const location = useLocation();
  const config = useMemo(() => loadChorusConfig(), []);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Syntaxe à présélectionner une fois les syntaxes du format chargées
  // (utilisé par « Appliquer » dans le panneau Recommandations et par le
  // préréglage transmis depuis « PDF facture → flux »).
  const pendingSyntaxeRef = useRef<string | null>(null);
  const presetAppliedRef = useRef(false);
  // Garde anti-état périmé : ignore les réponses asynchrones d'un fichier précédent.
  const fileSeqRef = useRef(0);

  const [file, setFile] = useState<File | null>(null);
  const [formats, setFormats] = useState<string[]>([]);
  const [formatFlux, setFormatFlux] = useState<string>('');
  const [syntaxes, setSyntaxes] = useState<string[]>([]);
  const [syntaxeFlux, setSyntaxeFlux] = useState<string>('');
  const [avecSignature, setAvecSignature] = useState(false);
  const [idUtilisateurCourant, setIdUtilisateurCourant] = useState('0');
  const [acknowledgeRisk, setAcknowledgeRisk] = useState(false);

  const [detected, setDetected] = useState<FluxDetected | null>(null);
  const [metadata, setMetadata] = useState<FluxMetadata | null>(null);
  const [businessValidation, setBusinessValidation] = useState<FluxBusinessValidation | null>(null);
  const [businessValidating, setBusinessValidating] = useState(false);
  const [businessOpen, setBusinessOpen] = useState(true);
  const [recipient, setRecipient] = useState<G2BRecipientValidation | null>(null);
  const [recipientLoading, setRecipientLoading] = useState(false);
  const [guide, setGuide] = useState<ChorusFluxGuideEntry[]>([]);
  const [metadataOpen, setMetadataOpen] = useState(true);

  const [loadingFormats, setLoadingFormats] = useState(false);
  const [loadingSyntaxes, setLoadingSyntaxes] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formatsError, setFormatsError] = useState<string | null>(null);
  const [syntaxesError, setSyntaxesError] = useState<string | null>(null);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ChorusFluxDepositResult | null>(null);
  const [rawOpen, setRawOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  const loadFormats = useCallback(async () => {
    setLoadingFormats(true);
    setFormatsError(null);
    try {
      const response = await fetchChorusFluxFormats(config);
      setFormats(response.formats);
    } catch (caught) {
      setFormatsError(caught instanceof Error ? caught.message : 'Erreur lors du chargement des formats.');
      setFormats([]);
    } finally {
      setLoadingFormats(false);
    }
  }, [config]);

  // 1) Au chargement : récupérer formats + guide.
  useEffect(() => {
    void loadFormats();
    fetchChorusFluxGuide(config).then(setGuide).catch(() => setGuide([]));
  }, [config, loadFormats]);

  // 1bis) Préréglage transmis depuis « PDF facture → flux » (Factur-X) : on
  // présélectionne le format/syntaxe recommandés une fois les formats chargés.
  useEffect(() => {
    if (presetAppliedRef.current || formats.length === 0) return;
    const state = location.state as { presetFormatFlux?: string; presetSyntaxeFlux?: string } | null;
    const presetFormat = state?.presetFormatFlux;
    if (presetFormat && formats.includes(presetFormat)) {
      presetAppliedRef.current = true;
      pendingSyntaxeRef.current = state?.presetSyntaxeFlux ?? null;
      setFormatFlux(presetFormat);
    }
  }, [formats, location.state]);

  // 2) Format choisi -> récupérer dynamiquement les syntaxes.
  useEffect(() => {
    if (!formatFlux) {
      setSyntaxes([]);
      setSyntaxeFlux('');
      setSyntaxesError(null);
      return;
    }
    let cancelled = false;
    setLoadingSyntaxes(true);
    setSyntaxesError(null);
    setSyntaxes([]);
    setSyntaxeFlux('');
    fetchChorusFluxSyntaxes(config, formatFlux)
      .then((response) => {
        if (cancelled) return;
        setSyntaxes(response.syntaxes);
        const pending = pendingSyntaxeRef.current;
        if (pending && response.syntaxes.includes(pending)) {
          setSyntaxeFlux(pending);
        } else if (response.syntaxes.length === 1) {
          setSyntaxeFlux(response.syntaxes[0]);
        }
        pendingSyntaxeRef.current = null;
      })
      .catch((caught: unknown) => {
        if (!cancelled) setSyntaxesError(caught instanceof Error ? caught.message : 'Erreur lors du chargement des syntaxes.');
      })
      .finally(() => {
        if (!cancelled) setLoadingSyntaxes(false);
      });
    return () => {
      cancelled = true;
    };
  }, [config, formatFlux]);

  // 3bis) Pré-contrôle métier (identifiants/adresses) — sans appeler Chorus.
  const runBusinessValidation = useCallback(async (selected: File): Promise<FluxBusinessValidation | null> => {
    const seq = fileSeqRef.current;
    setBusinessValidating(true);
    setRecipient(null);
    try {
      const response = await businessValidateChorusFlux(config, selected);
      if (fileSeqRef.current !== seq) return null;
      setBusinessValidation(response.businessValidation);
      return response.businessValidation;
    } catch {
      if (fileSeqRef.current === seq) setBusinessValidation(null);
      return null;
    } finally {
      if (fileSeqRef.current === seq) setBusinessValidating(false);
    }
  }, [config]);

  // 3) Fichier choisi -> détecter le type réel + lancer le pré-contrôle métier.
  const runDetection = useCallback(async (selected: File) => {
    const seq = fileSeqRef.current;
    setDetecting(true);
    setDetectError(null);
    setDetected(null);
    setMetadata(null);
    try {
      const response = await detectChorusFlux(config, selected);
      if (fileSeqRef.current !== seq) return;
      setDetected(response.detected);
      setMetadata(response.metadata);
    } catch (caught) {
      if (fileSeqRef.current === seq) setDetectError(caught instanceof Error ? caught.message : 'Erreur lors de la détection du fichier.');
    } finally {
      if (fileSeqRef.current === seq) setDetecting(false);
    }
    if (fileSeqRef.current === seq) void runBusinessValidation(selected);
  }, [config, runBusinessValidation]);

  const handleFileChange = (selected: File | null) => {
    fileSeqRef.current += 1;  // invalide les réponses asynchrones du fichier précédent
    setResult(null);
    setError(null);
    setAcknowledgeRisk(false);
    setFile(selected);
    setDetected(null);
    setMetadata(null);
    setBusinessValidation(null);
    setRecipient(null);
    setDetectError(null);
    if (selected && hasAllowedExtension(selected.name)) {
      void runDetection(selected);
    }
  };

  // Validation du destinataire via l'Annuaire G2B (à la demande, sans dépôt).
  const handleValidateRecipient = async () => {
    const siret = businessValidation?.extracted.customerIdentifier ?? null;
    if (!siret) return;
    setRecipientLoading(true);
    try {
      setRecipient(await validateG2BRecipient(config, siret));
    } catch (caught) {
      setRecipient(null);
      toast({ variant: 'destructive', title: 'Annuaire G2B', description: caught instanceof Error ? caught.message : 'Validation du destinataire impossible.' });
    } finally {
      setRecipientLoading(false);
    }
  };

  // 4) Compatibilité (miroir client, le backend reste autoritaire au dépôt).
  const compatibility = useMemo(() => {
    if (!detected) return null;
    return evaluateFluxCompatibility(detected.detectedFileType, formatFlux || null, syntaxeFlux || null, syntaxes);
  }, [detected, formatFlux, syntaxeFlux, syntaxes]);

  useEffect(() => {
    setAcknowledgeRisk(false);
  }, [compatibility?.severity, syntaxeFlux]);

  // 5) Recommandation « grand public » : se met à jour au fichier, au format
  //    et à la syntaxe. Les valeurs proposées restent indicatives, Chorus
  //    demeurant la source de vérité des formats/syntaxes sélectionnables.
  const recommendation = useMemo(() => {
    if (!detected) return null;
    return buildFluxRecommendation({
      detectedFileType: detected.detectedFileType,
      selectedFormatFlux: formatFlux || null,
      selectedSyntaxeFlux: syntaxeFlux || null,
      availableFormats: formats,
      availableSyntaxes: syntaxes,
      businessValidation,
    });
  }, [detected, formatFlux, syntaxeFlux, formats, syntaxes, businessValidation]);

  // Le format conseillé existe-t-il bien dans la liste renvoyée par Chorus ?
  const recoFormatAvailable = Boolean(
    recommendation?.recommendedFormatFlux && formats.includes(recommendation.recommendedFormatFlux),
  );
  const recoFormatUnavailable = Boolean(
    recommendation?.recommendedFormatFlux && formats.length > 0 && !recoFormatAvailable,
  );
  // « Appliquer » : on ne peut pré-remplir que si le format conseillé est dispo.
  const canApplyRecommendation =
    recoFormatAvailable
    && (recommendation?.recommendedFormatFlux !== formatFlux
      || (recommendation?.recommendedSyntaxeFlux ?? '') !== syntaxeFlux);

  const applyRecommendation = () => {
    if (!recommendation?.recommendedFormatFlux || !recoFormatAvailable) return;
    pendingSyntaxeRef.current = recommendation.recommendedSyntaxeFlux;
    if (recommendation.recommendedFormatFlux === formatFlux) {
      // Format déjà sélectionné : applique directement la syntaxe si dispo.
      if (recommendation.recommendedSyntaxeFlux && syntaxes.includes(recommendation.recommendedSyntaxeFlux)) {
        setSyntaxeFlux(recommendation.recommendedSyntaxeFlux);
      }
      pendingSyntaxeRef.current = null;
    } else {
      // Le changement de format recharge les syntaxes ; la syntaxe en attente
      // sera appliquée par l'effet de chargement si elle est disponible.
      setFormatFlux(recommendation.recommendedFormatFlux);
    }
  };

  const fileError = file && !hasAllowedExtension(file.name) ? 'Seuls les fichiers .xml et .pdf sont acceptés.' : null;
  const severity = compatibility?.severity ?? null;
  const isBlocking = severity === 'BLOCKING';
  const isWarning = severity === 'WARNING';
  // Données métier bloquantes (identifiant/adresse manquants…) : jamais forçables.
  const businessBlocking = businessValidation?.severity === 'BLOCKING';
  const canSubmit =
    Boolean(file) && !fileError && Boolean(formatFlux) && Boolean(syntaxeFlux)
    && !submitting && !detecting && !businessValidating && !isBlocking && !businessBlocking
    && (!isWarning || acknowledgeRisk);

  const handleSubmit = async () => {
    if (!file || !hasAllowedExtension(file.name) || !formatFlux || !syntaxeFlux) {
      setError('Sélectionnez un fichier valide, un format et une syntaxe de flux.');
      return;
    }
    // Pré-contrôle métier obligatoire avant dépôt : on rafraîchit puis on bloque
    // si la validation métier est bloquante (le backend re-vérifie de toute façon).
    const business = await runBusinessValidation(file);
    if (business?.severity === 'BLOCKING') {
      setError('Le flux est techniquement compatible mais les données métier sont incomplètes ou non reconnues. Corrigez les identifiants et adresses avant dépôt.');
      return;
    }
    setSubmitting(true);
    setError(null);
    setResult(null);
    const parsedUserId = Number.parseInt(idUtilisateurCourant, 10);
    try {
      const deposit = await depositChorusFlux(config, {
        file,
        formatFlux,
        syntaxeFlux,
        avecSignature,
        idUtilisateurCourant: Number.isFinite(parsedUserId) ? parsedUserId : 0,
        forceDeposit: isWarning && acknowledgeRisk,
      });
      setResult(deposit);
      if (deposit.statusLocal === 'ACCEPTED') {
        toast({ title: 'Flux déposé', description: deposit.numeroFluxDepot ? `Numéro de flux : ${deposit.numeroFluxDepot}` : 'Flux accepté par Chorus Pro.' });
      } else {
        toast({
          variant: 'destructive',
          title:
            deposit.statusLocal === 'BLOCKED_BUSINESS_VALIDATION' ? 'Dépôt bloqué (données métier)'
            : deposit.statusLocal === 'BLOCKED_LOCAL_VALIDATION' ? 'Dépôt bloqué'
            : deposit.statusLocal === 'REJECTED' ? 'Flux rejeté' : 'Erreur de dépôt',
          description: deposit.explanation?.message ?? deposit.message ?? deposit.error ?? deposit.libelle ?? `codeRetour ${deposit.codeRetour ?? '?'}`,
        });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Erreur inconnue lors du dépôt de flux.');
    } finally {
      setSubmitting(false);
    }
  };

  const availableFormatSet = useMemo(() => new Set(formats), [formats]);

  return (
    <div className="space-y-7 animate-fade-in">
      <PageHeader
        eyebrow={<><UploadCloud className="h-3 w-3" /> Chorus Pro · flux</>}
        title="Dépôt de flux"
        description="Déposez une facture structurée (XML UBL/CII ou PDF/A3 Factur-X). L'application détecte le type réel du fichier et empêche les incohérences avant l'appel à Chorus Pro."
      />

      <ProcessExplanationCard {...PAGE_EXPLANATIONS.depot} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="card-elevated">
          <CardHeader><CardTitle className="text-base">Fichier de flux</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="flux-file">Fichier (.xml ou .pdf)</Label>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  'flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center transition-colors',
                  'border-border hover:border-primary/50 hover:bg-muted/40',
                  fileError && 'border-destructive/60',
                )}
              >
                <FileUp className="h-6 w-6 text-muted-foreground" />
                {file ? <span className="text-sm font-medium text-foreground">{file.name}</span> : <span className="text-sm text-muted-foreground">Cliquez pour sélectionner un fichier</span>}
                {file && <span className="text-xs text-muted-foreground">{formatBytes(file.size)}</span>}
              </button>
              <input ref={fileInputRef} id="flux-file" type="file" accept={ACCEPT_ATTR} className="hidden" onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)} />
              {fileError && <p className="text-xs text-destructive">{fileError}</p>}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="flux-format">Format du flux</Label>
                <button type="button" onClick={() => void loadFormats()} disabled={loadingFormats} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">
                  <RefreshCw className={cn('h-3 w-3', loadingFormats && 'animate-spin')} /> Recharger
                </button>
              </div>
              <Select value={formatFlux} onValueChange={setFormatFlux} disabled={loadingFormats || formats.length === 0}>
                <SelectTrigger id="flux-format"><SelectValue placeholder={loadingFormats ? 'Chargement des formats…' : 'Sélectionnez un format'} /></SelectTrigger>
                <SelectContent>{formats.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
              </Select>
              {loadingFormats && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Récupération des formats…</p>}
              {formatsError && <p className="text-xs text-destructive">{formatsError}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="flux-syntaxe">Syntaxe du flux</Label>
              <Select value={syntaxeFlux} onValueChange={setSyntaxeFlux} disabled={!formatFlux || loadingSyntaxes || syntaxes.length === 0}>
                <SelectTrigger id="flux-syntaxe">
                  <SelectValue placeholder={!formatFlux ? 'Sélectionnez d’abord un format' : loadingSyntaxes ? 'Chargement des syntaxes…' : 'Sélectionnez une syntaxe'} />
                </SelectTrigger>
                <SelectContent>{syntaxes.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
              </Select>
              {loadingSyntaxes && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Récupération des syntaxes…</p>}
              {syntaxesError && <p className="text-xs text-destructive">{syntaxesError}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="flux-user-id">idUtilisateurCourant</Label>
              <Input id="flux-user-id" type="number" min={0} value={idUtilisateurCourant} onChange={(e) => setIdUtilisateurCourant(e.target.value)} className="max-w-[200px]" />
            </div>

            <div className="flex items-center gap-2.5">
              <Checkbox id="flux-signature" checked={avecSignature} onCheckedChange={(c) => setAvecSignature(c === true)} />
              <Label htmlFor="flux-signature" className="cursor-pointer font-normal">Avec signature (avecSignature)</Label>
            </div>

            {isWarning && compatibility?.warning && (
              <div className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/5 p-3">
                <Checkbox id="flux-ack" checked={acknowledgeRisk} onCheckedChange={(c) => setAcknowledgeRisk(c === true)} className="mt-0.5" />
                <Label htmlFor="flux-ack" className="cursor-pointer text-xs font-normal leading-5 text-muted-foreground">
                  Je comprends le risque : la compatibilité n'a pas pu être confirmée et Chorus pourrait rejeter ce flux. Forcer le dépôt.
                </Label>
              </div>
            )}

            <Button onClick={handleSubmit} disabled={!canSubmit} className="w-full sm:w-auto">
              {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Dépôt en cours…</> : <><UploadCloud className="mr-2 h-4 w-4" /> Déposer le flux</>}
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-6">
          {/* Détection du fichier */}
          <Card className="card-elevated">
            <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
              <CardTitle className="text-base">Détection du fichier</CardTitle>
              {severity && (() => {
                const visual = SEVERITY_VISUALS[severity];
                const Icon = visual.icon;
                return <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', visual.className)}><Icon className="h-3.5 w-3.5" /> {visual.label}</span>;
              })()}
            </CardHeader>
            <CardContent className="space-y-3">
              {detecting && <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Analyse du fichier…</p>}
              {detectError && <p className="text-sm text-destructive">{detectError}</p>}
              {!file && !detecting && <p className="text-sm text-muted-foreground">Sélectionnez un fichier pour détecter automatiquement son type (UBL, CII, Factur-X, pivot Chorus…).</p>}
              {detected && (
                <>
                  <dl className="grid grid-cols-[150px_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                    <dt className="text-muted-foreground">Type détecté</dt>
                    <dd className="font-medium break-words">{detectedTypeLabel(detected.detectedFileType)}</dd>
                    {detected.rootElement && (<><dt className="text-muted-foreground">Racine XML</dt><dd className="font-medium break-words">{detected.rootElement}</dd></>)}
                    {detected.namespace && (<><dt className="text-muted-foreground">Namespace</dt><dd className="break-words font-mono text-[11px]">{detected.namespace}</dd></>)}
                    {detected.isPdf && (<><dt className="text-muted-foreground">XML embarqué</dt><dd className="font-medium break-words">{detected.embeddedXmlFilename ?? '— (aucun)'}{detected.embeddedXmlRoot ? ` · ${detected.embeddedXmlRoot}` : ''}</dd></>)}
                    <dt className="text-muted-foreground">Syntaxe choisie</dt>
                    <dd className="font-medium break-words">{syntaxeFlux || '—'}</dd>
                  </dl>
                  {compatibility?.warning && (
                    <div className={cn('rounded-lg p-3 text-xs leading-5', isBlocking ? 'bg-destructive/5 text-destructive' : 'bg-warning/10 text-warning')}>
                      {compatibility.warning}
                    </div>
                  )}
                  {compatibility && compatibility.recommendedSyntaxes.length > 0 && severity !== 'OK' && (
                    <p className="text-xs text-muted-foreground">
                      Syntaxes recommandées : {compatibility.recommendedSyntaxes.map((s) => <code key={s} className="mx-0.5 rounded bg-muted px-1 py-0.5 text-[10.5px]">{s}</code>)}
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Recommandations (aide au choix formatFlux / syntaxeFlux) */}
          {recommendation && (() => {
            const visual = RECO_VISUALS[recommendation.status];
            const Icon = visual.icon;
            const badgeLabel =
              recommendation.status === 'recommended' ? 'Dépôt recommandé'
              : recommendation.status === 'blocked' ? 'Dépôt bloqué'
              : detected?.detectedFileType === 'PDF_GENERIC' ? 'Conversion requise'
              : detected?.detectedFileType === 'CPP_FACTURE_MIXTE' ? 'Syntaxe à vérifier'
              : 'À vérifier';
            const hasReco = Boolean(recommendation.recommendedFormatFlux || recommendation.recommendedSyntaxeFlux);
            return (
              <Card className="card-elevated">
                <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                  <CardTitle className="flex items-center gap-2 text-base"><Lightbulb className="h-4 w-4 text-muted-foreground" /> Recommandations</CardTitle>
                  <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', visual.className)}>
                    <Icon className="h-3.5 w-3.5" /> {badgeLabel}
                  </span>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div>
                    <p className="font-medium">{recommendation.title}</p>
                    <p className="text-muted-foreground">{recommendation.shortExplanation}</p>
                  </div>

                  {hasReco ? (
                    <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-4 gap-y-2">
                      <dt className="text-muted-foreground">Format du flux</dt>
                      <dd>{recommendation.recommendedFormatFlux ? <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{recommendation.recommendedFormatFlux}</code> : '—'}</dd>
                      <dt className="text-muted-foreground">Syntaxe du flux</dt>
                      <dd>{recommendation.recommendedSyntaxeFlux ? <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{recommendation.recommendedSyntaxeFlux}</code> : '—'}</dd>
                    </dl>
                  ) : (
                    <p className="text-muted-foreground">Aucun dépôt recommandé.</p>
                  )}

                  {recoFormatUnavailable && (
                    <p className="text-xs text-warning">Cette syntaxe n'est pas disponible pour ce compte ou cet environnement.</p>
                  )}

                  <div className="rounded-lg bg-muted/40 p-3 text-xs leading-5">
                    <p className="font-medium text-foreground">Pourquoi ?</p>
                    <p className="text-muted-foreground">{recommendation.why}</p>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-medium text-foreground">{recommendation.actionLabel}</p>
                    {canApplyRecommendation && (
                      <Button type="button" size="sm" variant="outline" onClick={applyRecommendation}>
                        <Wand2 className="mr-1.5 h-3.5 w-3.5" /> Appliquer
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })()}

          {/* Pré-contrôle métier (identifiants / adresses) */}
          {detected && (
            <Card className="card-elevated">
              <CardHeader className="space-y-0 py-3">
                <button type="button" onClick={() => setBusinessOpen((o) => !o)} className="flex w-full items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-base"><ClipboardCheck className="h-4 w-4 text-muted-foreground" /> Pré-contrôle métier</CardTitle>
                  <div className="flex items-center gap-2">
                    {businessValidation && (() => {
                      const visual = BIZ_VISUALS[businessValidation.severity];
                      const Icon = visual.icon;
                      return <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', visual.className)}><Icon className="h-3.5 w-3.5" /> {visual.label}</span>;
                    })()}
                    <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', businessOpen && 'rotate-180')} />
                  </div>
                </button>
              </CardHeader>
              {businessOpen && (
                <CardContent className="space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">Contrôle des identifiants et adresses avant l'appel à Chorus (sans dépôt).</p>
                    <Button type="button" size="sm" variant="outline" disabled={!file || businessValidating} onClick={() => file && void runBusinessValidation(file)}>
                      {businessValidating ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Contrôle…</> : 'Lancer le pré-contrôle métier'}
                    </Button>
                  </div>

                  {businessValidation && (
                    <>
                      {businessValidation.severity === 'BLOCKING' && (
                        <p className="font-medium text-destructive">Données métier incomplètes</p>
                      )}
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fournisseur extrait du XML</p>
                      <dl className="grid grid-cols-[150px_minmax(0,1fr)] gap-x-4 gap-y-1.5">
                        <dt className="text-muted-foreground">N° facture</dt><dd className="break-words font-medium">{businessValidation.extracted.invoiceNumber ?? '—'}</dd>
                        <dt className="text-muted-foreground">{businessValidation.extracted.supplierIdentifierType === 'SIRET' ? 'SIRET fournisseur' : 'Id. fournisseur'}</dt>
                        <dd className="break-words font-medium">
                          {businessValidation.extracted.supplierBusinessIdentifier ?? '—'}
                          {businessValidation.extracted.supplierIdentifierType === 'NON_SIRET' && <span className="ml-1.5 text-xs text-warning">(format non-SIRET)</span>}
                        </dd>
                        <dt className="text-muted-foreground">Fournisseur</dt><dd className="break-words font-medium">{businessValidation.extracted.supplierName ?? '—'}</dd>
                        <dt className="text-muted-foreground">Adresse fournisseur</dt>
                        <dd className={cn('break-words font-medium', !businessValidation.checks.supplier_address_present && 'text-destructive')}>
                          {businessValidation.extracted.supplierAddress ?? 'Manquante'}
                        </dd>
                        <dt className="text-muted-foreground">Id. débiteur</dt><dd className="break-words font-medium">{businessValidation.extracted.customerIdentifier ?? '—'}</dd>
                        <dt className="text-muted-foreground">Débiteur/client</dt><dd className="break-words font-medium">{businessValidation.extracted.customerName ?? '—'}</dd>
                        <dt className="text-muted-foreground">Adresse débiteur</dt>
                        <dd className={cn('break-words font-medium', !businessValidation.checks.customer_address_present && 'text-destructive')}>
                          {businessValidation.extracted.customerAddress ?? 'Manquante'}
                        </dd>
                        <dt className="text-muted-foreground">Devise / Totaux</dt>
                        <dd className="font-medium">{businessValidation.extracted.currency ?? '—'} · HT {businessValidation.extracted.totalHt ?? '—'} · TVA {businessValidation.extracted.totalTva ?? '—'} · TTC {businessValidation.extracted.totalTtc ?? '—'}</dd>
                      </dl>

                      {businessValidation.extracted.taxPercentages.length > 0 && (
                        <p className="text-xs text-muted-foreground">Taux de TVA détectés : {businessValidation.extracted.taxPercentages.join(' %, ')} %</p>
                      )}

                      <div className="rounded-lg bg-muted/40 p-3 text-xs leading-5">
                        <p className="font-medium text-foreground">Configuration locale</p>
                        <p className="text-muted-foreground">SIRET autorisés : {businessValidation.extracted.supplierSiretsConfigured.length > 0 ? businessValidation.extracted.supplierSiretsConfigured.join(', ') : '— (non configuré)'}</p>
                        <p className="text-muted-foreground">IDs internes Chorus : {businessValidation.extracted.supplierInternalIdsConfigured.length > 0 ? businessValidation.extracted.supplierInternalIdsConfigured.join(', ') : '—'}</p>
                      </div>

                      {businessValidation.extracted.supplierIdentifierType === 'SIRET' && businessValidation.checks.supplier_identifier_known && (
                        <p className="rounded-lg bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
                          Le SIRET fournisseur est bien présent dans le XML. Si Chorus le rejette malgré tout, c'est un problème d'habilitation côté Chorus (compte technique rattaché à la structure, application « Demandes de paiement » activée dans cet environnement).
                        </p>
                      )}

                      {/* Destinataire (Annuaire G2B) — vérification à la demande. */}
                      {businessValidation.extracted.customerIdentifier && /^\d{14}$/.test(businessValidation.extracted.customerIdentifier.replace(/\s/g, '')) && (
                        <div className="space-y-2">
                          <Button type="button" size="sm" variant="outline" disabled={recipientLoading} onClick={() => void handleValidateRecipient()}>
                            {recipientLoading ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Vérification…</> : <><ClipboardCheck className="mr-1.5 h-3.5 w-3.5" /> Valider le destinataire (Annuaire G2B)</>}
                          </Button>
                          {recipient && (
                            <div className={cn('rounded-lg border p-2.5 text-xs leading-5',
                              recipient.validation.severity === 'OK' ? 'border-success/40 bg-success/5'
                              : recipient.validation.severity === 'BLOCKING' ? 'border-destructive/40 bg-destructive/5' : 'border-warning/40 bg-warning/5')}>
                              <p className="font-medium text-foreground">
                                {recipient.recipient.denomination ?? recipient.recipient.siret}
                                {recipient.recipient.active === true && <span className="ml-1.5 text-success">· actif</span>}
                                {recipient.recipient.active === false && <span className="ml-1.5 text-destructive">· inactif</span>}
                              </p>
                              {recipient.recipient.address && (recipient.recipient.address.city || recipient.recipient.address.postalCode) && (
                                <p className="text-muted-foreground">{[recipient.recipient.address.line1, [recipient.recipient.address.postalCode, recipient.recipient.address.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</p>
                              )}
                              {recipient.recipient.rules.serviceCodeRequired && <p className="text-muted-foreground">Code service requis pour ce destinataire.</p>}
                              {recipient.recipient.rules.engagementRequired && <p className="text-muted-foreground">Numéro d'engagement requis pour ce destinataire.</p>}
                              {recipient.validation.recommendations.map((rec, i) => <p key={i} className="text-muted-foreground">• {rec}</p>)}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Sources à corriger : chemin XML + valeur actuelle + correction. */}
                      {(businessValidation.errors.length > 0 || businessValidation.warnings.length > 0) && (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sources à corriger</p>
                          {[...businessValidation.errors.map((e) => ({ ...e, kind: 'error' as const })), ...businessValidation.warnings.map((w) => ({ ...w, kind: 'warning' as const }))].map((issue, i) => {
                            const Icon = issue.kind === 'error' ? XCircle : AlertTriangle;
                            const tone = issue.kind === 'error' ? 'text-destructive' : 'text-warning';
                            return (
                              <div key={`bi${i}`} className="rounded-lg border border-border/60 p-2.5 text-xs leading-5">
                                <p className={cn('flex items-start gap-2 font-medium', tone)}><Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{issue.message}</span></p>
                                {issue.xmlPath && <p className="mt-1 text-muted-foreground">Chemin : <code className="rounded bg-muted px-1 py-0.5 text-[10.5px]">{issue.xmlPath.replace(/\./g, ' › ')}</code></p>}
                                <p className="text-muted-foreground">Valeur actuelle : {issue.currentValue ?? 'absente'}</p>
                                {issue.suggestedFix && <p className="text-muted-foreground">Correction : {issue.suggestedFix}</p>}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              )}
            </Card>
          )}

          {/* Métadonnées extraites (vue d'inspection détaillée) */}
          {metadata && (
            <Card className="card-elevated">
              <CardHeader className="space-y-0 py-3">
                <button type="button" onClick={() => setMetadataOpen((o) => !o)} className="flex w-full items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-base"><FileText className="h-4 w-4 text-muted-foreground" /> Métadonnées</CardTitle>
                  <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', metadataOpen && 'rotate-180')} />
                </button>
              </CardHeader>
              {metadataOpen && (
                <CardContent className="space-y-4 text-sm">
                  {/* Document */}
                  <section className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Document</p>
                    <dl className="grid grid-cols-[130px_minmax(0,1fr)] gap-x-4 gap-y-1.5">
                      <dt className="text-muted-foreground">Fichier</dt>
                      <dd className="break-words font-medium">
                        {metadata.document.filename ?? '—'}
                        {metadata.document.sizeBytes !== null && <span className="text-muted-foreground"> · {formatBytes(metadata.document.sizeBytes)}</span>}
                        {metadata.document.extension && <span className="text-muted-foreground"> · {metadata.document.extension}</span>}
                      </dd>
                      {metadata.document.kind === 'pdf' && (
                        <>
                          <dt className="text-muted-foreground">PDF</dt>
                          <dd className="font-medium">
                            {[
                              metadata.document.pdfVersion && `v${metadata.document.pdfVersion}`,
                              metadata.document.pageCount !== null && `${metadata.document.pageCount} page(s)`,
                              metadata.document.pdfA,
                            ].filter(Boolean).join(' · ') || '—'}
                          </dd>
                        </>
                      )}
                      {metadata.document.title && (<><dt className="text-muted-foreground">Titre</dt><dd className="break-words font-medium">{metadata.document.title}</dd></>)}
                      {metadata.document.producer && (<><dt className="text-muted-foreground">Producteur</dt><dd className="break-words font-medium">{metadata.document.producer}</dd></>)}
                      {metadata.document.creator && (<><dt className="text-muted-foreground">Créateur</dt><dd className="break-words font-medium">{metadata.document.creator}</dd></>)}
                      {(metadata.document.created || metadata.document.modified) && (
                        <>
                          <dt className="text-muted-foreground">Dates</dt>
                          <dd className="font-medium">
                            {[
                              metadata.document.created && `créé ${metadata.document.created}`,
                              metadata.document.modified && `modifié ${metadata.document.modified}`,
                            ].filter(Boolean).join(' · ')}
                          </dd>
                        </>
                      )}
                      {metadata.document.kind === 'xml' && metadata.document.encoding && (
                        <><dt className="text-muted-foreground">Encodage</dt><dd className="font-medium">{metadata.document.encoding}</dd></>
                      )}
                    </dl>
                    {metadata.document.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {metadata.document.attachments.map((a) => (
                          <span key={a.name} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                            <Paperclip className="h-3 w-3" /> {a.name}{a.sizeBytes !== null ? ` (${formatBytes(a.sizeBytes)})` : ''}
                          </span>
                        ))}
                      </div>
                    )}
                  </section>

                  {/* XML structuré / embarqué */}
                  {metadata.xml && (
                    <section className="space-y-2 border-t pt-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        XML {metadata.xml.source === 'embedded' ? 'embarqué' : 'structuré'}
                      </p>
                      <dl className="grid grid-cols-[130px_minmax(0,1fr)] gap-x-4 gap-y-1.5">
                        {metadata.xml.filename && (<><dt className="text-muted-foreground">Fichier</dt><dd className="break-words font-medium">{metadata.xml.filename}</dd></>)}
                        <dt className="text-muted-foreground">Racine</dt><dd className="break-words font-medium">{metadata.xml.rootElement ?? '—'}</dd>
                        {metadata.xml.namespace && (<><dt className="text-muted-foreground">Namespace</dt><dd className="break-words font-mono text-[11px]">{metadata.xml.namespace}</dd></>)}
                        {metadata.xml.encoding && (<><dt className="text-muted-foreground">Encodage</dt><dd className="font-medium">{metadata.xml.encoding}</dd></>)}
                      </dl>
                    </section>
                  )}

                  {/* Facture (en-tête) */}
                  {metadata.invoice ? (
                    <section className="space-y-2 border-t pt-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Facture (en-tête extrait)</p>
                      <dl className="grid grid-cols-[130px_minmax(0,1fr)] gap-x-4 gap-y-1.5">
                        <dt className="text-muted-foreground">N° facture</dt><dd className="break-words font-medium">{metadata.invoice.invoiceNumber ?? '—'}</dd>
                        <dt className="text-muted-foreground">Date</dt><dd className="font-medium">{metadata.invoice.issueDate ?? '—'}{metadata.invoice.dueDate ? ` · échéance ${metadata.invoice.dueDate}` : ''}</dd>
                        <dt className="text-muted-foreground">Fournisseur</dt><dd className="break-words font-medium">{metadata.invoice.sellerName ?? '—'}{metadata.invoice.sellerId ? ` · ${metadata.invoice.sellerId}` : ''}</dd>
                        <dt className="text-muted-foreground">Client</dt><dd className="break-words font-medium">{metadata.invoice.buyerName ?? '—'}{metadata.invoice.buyerId ? ` · ${metadata.invoice.buyerId}` : ''}</dd>
                        <dt className="text-muted-foreground">Total HT</dt><dd className="font-medium">{formatAmount(metadata.invoice.totalHt, metadata.invoice.currency)}</dd>
                        <dt className="text-muted-foreground">TVA</dt><dd className="font-medium">{formatAmount(metadata.invoice.totalTva, metadata.invoice.currency)}</dd>
                        <dt className="text-muted-foreground">Total TTC</dt><dd className="font-medium">{formatAmount(metadata.invoice.totalTtc, metadata.invoice.currency)}</dd>
                      </dl>
                      <p className="text-[11px] text-muted-foreground">Extraction best-effort à titre indicatif. Vérifiez les valeurs avant tout dépôt.</p>
                    </section>
                  ) : (
                    <p className="border-t pt-3 text-xs text-muted-foreground">Aucune donnée de facture n'a pu être extraite de ce fichier.</p>
                  )}
                </CardContent>
              )}
            </Card>
          )}

          {error && <ApiErrorCard severity="error" title="Dépôt impossible" technicalDetails={error} />}

          {result && (
            <Card className="card-elevated">
              <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                <CardTitle className="text-base">Résultat du dépôt</CardTitle>
                {(() => {
                  const visual = STATUS_VISUALS[result.statusLocal] ?? STATUS_VISUALS.ERROR;
                  const Icon = visual.icon;
                  return <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', visual.className)}><Icon className="h-3.5 w-3.5" /> {visual.label}</span>;
                })()}
              </CardHeader>
              <CardContent className="space-y-3">
                {(result.explanation || result.message) && (
                  <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs leading-5 text-warning">
                    <p>{result.explanation?.message ?? result.message}</p>
                    {result.explanation?.source && <p className="mt-1 opacity-80">Source : <code className="rounded bg-warning/10 px-1 py-0.5 text-[10.5px]">{result.explanation.source}</code></p>}
                    {result.explanation?.fix && <p className="opacity-80">Correction : {result.explanation.fix}</p>}
                  </div>
                )}
                {result.statusLocal === 'BLOCKED_BUSINESS_VALIDATION' && result.businessValidation && result.businessValidation.errors.length > 0 && (
                  <ul className="space-y-1.5">
                    {result.businessValidation.errors.map((issue, i) => (
                      <li key={`re${i}`} className="flex items-start gap-2 text-xs text-destructive"><XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{issue.message}</span></li>
                    ))}
                  </ul>
                )}
                <dl className="grid grid-cols-[160px_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">HTTP</dt><dd className="font-medium">{result.httpStatus ?? '—'}</dd>
                  <dt className="text-muted-foreground">codeRetour</dt><dd className="font-medium">{result.codeRetour ?? '—'}</dd>
                  <dt className="text-muted-foreground">libellé</dt><dd className="font-medium break-words">{result.libelle ?? '—'}</dd>
                  <dt className="text-muted-foreground">dateDepot</dt><dd className="font-medium">{result.dateDepot ?? '—'}</dd>
                  <dt className="text-muted-foreground">numeroFluxDepot</dt><dd className="font-medium break-words">{result.numeroFluxDepot ?? '—'}</dd>
                  <dt className="text-muted-foreground">formatFlux</dt><dd className="font-medium break-words">{result.formatFlux ?? '—'}</dd>
                  <dt className="text-muted-foreground">syntaxeFlux</dt><dd className="font-medium break-words">{result.syntaxeFlux ?? '—'}</dd>
                  <dt className="text-muted-foreground">Type détecté</dt><dd className="font-medium break-words">{result.detected ? detectedTypeLabel(result.detected.detectedFileType) : '—'}</dd>
                  <dt className="text-muted-foreground">Enregistré en base</dt><dd className="font-medium">{result.persisted ? 'Oui' : 'Non'}</dd>
                </dl>
                <div className="pt-1">
                  <button type="button" onClick={() => setRawOpen((o) => !o)} className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
                    <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', rawOpen && 'rotate-180')} /> Réponse brute (debug)
                  </button>
                  {rawOpen && <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-foreground">{JSON.stringify(result.raw, null, 2)}</pre>}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Guide des formats */}
      <Card className="card-elevated">
        <CardHeader>
          <button type="button" onClick={() => setGuideOpen((o) => !o)} className="flex w-full items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base"><Info className="h-4 w-4 text-muted-foreground" /> Guide des formats</CardTitle>
            <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', guideOpen && 'rotate-180')} />
          </button>
        </CardHeader>
        {guideOpen && (
          <CardContent className="space-y-4">
            <ul className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
              <li><strong className="text-foreground">E1</strong> — facture XML structurée (UBL / CII)</li>
              <li><strong className="text-foreground">E2</strong> — minimal / mixte : UBL min, CII min, CPP Facture mixte, Factur-X</li>
              <li><strong className="text-foreground">E3</strong> — flux mémoire / justice (optionnel)</li>
              <li><strong className="text-foreground">E4 / E5</strong> — factures de travaux (selon disponibilité API)</li>
              <li className="sm:col-span-2"><strong className="text-foreground">S / R</strong> — flux sortants Chorus (CPPFacturePivot / CPPStatut) : <em>non déposables</em></li>
            </ul>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b bg-muted/20 text-left text-muted-foreground">
                    <th className="px-2 py-1.5 font-medium">Code</th>
                    <th className="px-2 py-1.5 font-medium">Libellé</th>
                    <th className="px-2 py-1.5 font-medium">formatFlux</th>
                    <th className="px-2 py-1.5 font-medium">syntaxeFlux</th>
                    <th className="px-2 py-1.5 font-medium">Fichier attendu</th>
                    <th className="px-2 py-1.5 font-medium">Dispo. compte</th>
                  </tr>
                </thead>
                <tbody>
                  {guide.map((entry) => {
                    const available = availableFormatSet.has(entry.formatFlux);
                    return (
                      <tr key={entry.code} className={cn('border-b last:border-0', !entry.depositCompatible && 'text-muted-foreground')}>
                        <td className="px-2 py-1.5 font-mono text-[11px]">{entry.code}</td>
                        <td className="px-2 py-1.5">{entry.label}</td>
                        <td className="px-2 py-1.5 font-mono text-[11px]">{entry.formatFlux}</td>
                        <td className="px-2 py-1.5 font-mono text-[11px]">{entry.syntaxeFlux}</td>
                        <td className="px-2 py-1.5">{entry.expectedFile ?? (entry.expectedRoot ? `XML (${entry.expectedRoot})` : '—')}</td>
                        <td className="px-2 py-1.5">
                          {!entry.depositCompatible
                            ? <Badge variant="outline" className="border-destructive/30 text-destructive">non déposable</Badge>
                            : available
                              ? <Badge variant="outline" className="border-success/30 text-success">disponible</Badge>
                              : <Badge variant="outline">non listé</Badge>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

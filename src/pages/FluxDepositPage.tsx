import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  UploadCloud, FileUp, Loader2, CheckCircle2, XCircle, AlertTriangle, ShieldAlert,
  ChevronDown, RefreshCw, Info,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader } from '@/components/common/PageHeader';
import { ApiErrorCard } from '@/components/common/ApiErrorCard';
import { useToast } from '@/hooks/use-toast';
import { loadChorusConfig } from '@/lib/chorus/storage';
import { cn } from '@/lib/utils';
import {
  depositChorusFlux,
  detectChorusFlux,
  fetchChorusFluxFormats,
  fetchChorusFluxGuide,
  fetchChorusFluxSyntaxes,
  type ChorusFluxDepositResult,
  type ChorusFluxGuideEntry,
} from '@/lib/chorus/fluxDeposit';
import {
  detectedTypeLabel,
  evaluateFluxCompatibility,
  type FluxDetected,
  type FluxSeverity,
} from '@/lib/chorus/fluxDetection';

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

const STATUS_VISUALS: Record<string, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  ACCEPTED: { label: 'Accepté', className: 'bg-success/15 text-success ring-1 ring-success/30', icon: CheckCircle2 },
  REJECTED: { label: 'Rejeté', className: 'bg-warning/15 text-warning ring-1 ring-warning/30', icon: XCircle },
  BLOCKED_LOCAL_VALIDATION: { label: 'Bloqué (validation locale)', className: 'bg-warning/15 text-warning ring-1 ring-warning/30', icon: ShieldAlert },
  ERROR: { label: 'Erreur', className: 'bg-destructive/15 text-destructive ring-1 ring-destructive/30', icon: AlertTriangle },
};

const SEVERITY_VISUALS: Record<FluxSeverity, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  OK: { label: 'Compatible', className: 'bg-success/15 text-success ring-1 ring-success/30', icon: CheckCircle2 },
  WARNING: { label: 'À vérifier', className: 'bg-warning/15 text-warning ring-1 ring-warning/30', icon: AlertTriangle },
  BLOCKING: { label: 'Incompatible', className: 'bg-destructive/15 text-destructive ring-1 ring-destructive/30', icon: ShieldAlert },
};

export default function FluxDepositPage() {
  const { toast } = useToast();
  const config = useMemo(() => loadChorusConfig(), []);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [formats, setFormats] = useState<string[]>([]);
  const [formatFlux, setFormatFlux] = useState<string>('');
  const [syntaxes, setSyntaxes] = useState<string[]>([]);
  const [syntaxeFlux, setSyntaxeFlux] = useState<string>('');
  const [avecSignature, setAvecSignature] = useState(false);
  const [idUtilisateurCourant, setIdUtilisateurCourant] = useState('0');
  const [acknowledgeRisk, setAcknowledgeRisk] = useState(false);

  const [detected, setDetected] = useState<FluxDetected | null>(null);
  const [guide, setGuide] = useState<ChorusFluxGuideEntry[]>([]);

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
        if (response.syntaxes.length === 1) setSyntaxeFlux(response.syntaxes[0]);
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

  // 3) Fichier choisi -> détecter le type réel via le backend.
  const runDetection = useCallback(async (selected: File) => {
    setDetecting(true);
    setDetectError(null);
    setDetected(null);
    try {
      const response = await detectChorusFlux(config, selected);
      setDetected(response.detected);
    } catch (caught) {
      setDetectError(caught instanceof Error ? caught.message : 'Erreur lors de la détection du fichier.');
    } finally {
      setDetecting(false);
    }
  }, [config]);

  const handleFileChange = (selected: File | null) => {
    setResult(null);
    setError(null);
    setAcknowledgeRisk(false);
    setFile(selected);
    setDetected(null);
    setDetectError(null);
    if (selected && hasAllowedExtension(selected.name)) {
      void runDetection(selected);
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

  const fileError = file && !hasAllowedExtension(file.name) ? 'Seuls les fichiers .xml et .pdf sont acceptés.' : null;
  const severity = compatibility?.severity ?? null;
  const isBlocking = severity === 'BLOCKING';
  const isWarning = severity === 'WARNING';
  const canSubmit =
    Boolean(file) && !fileError && Boolean(formatFlux) && Boolean(syntaxeFlux)
    && !submitting && !detecting && !isBlocking && (!isWarning || acknowledgeRisk);

  const handleSubmit = async () => {
    if (!file || !hasAllowedExtension(file.name) || !formatFlux || !syntaxeFlux) {
      setError('Sélectionnez un fichier valide, un format et une syntaxe de flux.');
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
          title: deposit.statusLocal === 'BLOCKED_LOCAL_VALIDATION' ? 'Dépôt bloqué' : deposit.statusLocal === 'REJECTED' ? 'Flux rejeté' : 'Erreur de dépôt',
          description: deposit.explanation?.message ?? deposit.error ?? deposit.libelle ?? `codeRetour ${deposit.codeRetour ?? '?'}`,
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
                {result.explanation && (
                  <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs leading-5 text-warning">
                    {result.explanation.message}
                  </div>
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

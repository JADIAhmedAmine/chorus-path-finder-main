import { useMemo, useRef, useState } from 'react';
import {
  Network, FileUp, Loader2, CheckCircle2, XCircle, AlertTriangle, ShieldAlert,
  ChevronDown, Wand2, UploadCloud, RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader } from '@/components/common/PageHeader';
import { ApiErrorCard } from '@/components/common/ApiErrorCard';
import { useToast } from '@/hooks/use-toast';
import { loadChorusConfig } from '@/lib/chorus/storage';
import { cn } from '@/lib/utils';
import {
  G2B_CODE_INTERFACES,
  businessValidateG2BFlux,
  depositG2BFlux,
  detectG2BFlux,
  getG2BFluxStatus,
  type G2BBusinessValidation,
  type G2BDepositResult,
  type G2BDetectResult,
  type G2BStatusResult,
} from '@/lib/g2b/g2bFluxApi';

const RECO_TONE: Record<string, string> = {
  recommended: 'bg-success/15 text-success ring-1 ring-success/30',
  warning: 'bg-warning/15 text-warning ring-1 ring-warning/30',
  blocked: 'bg-destructive/15 text-destructive ring-1 ring-destructive/30',
};

const STATUS_TONE: Record<string, { tone: string; icon: typeof CheckCircle2; label: string }> = {
  RECEVABLE: { tone: 'bg-success/15 text-success ring-1 ring-success/30', icon: CheckCircle2, label: 'Recevable' },
  IRRECEVABLE: { tone: 'bg-destructive/15 text-destructive ring-1 ring-destructive/30', icon: XCircle, label: 'Irrecevable' },
  ENTRANT_ENVELOPPE_VALIDE: { tone: 'bg-warning/15 text-warning ring-1 ring-warning/30', icon: Loader2, label: 'Enveloppe valide (en cours)' },
  PROCESSING_NOT_AVAILABLE_YET: { tone: 'bg-warning/15 text-warning ring-1 ring-warning/30', icon: Loader2, label: 'Traitement en cours' },
};

export default function G2BFluxDepositPage() {
  const { toast } = useToast();
  const config = useMemo(() => loadChorusConfig(), []);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Garde anti-état périmé : ignore les réponses asynchrones d'un fichier précédent.
  const seqRef = useRef(0);

  const [file, setFile] = useState<File | null>(null);
  const [detect, setDetect] = useState<G2BDetectResult | null>(null);
  const [business, setBusiness] = useState<G2BBusinessValidation | null>(null);
  const [codeInterface, setCodeInterface] = useState('');
  const [force, setForce] = useState(false);
  const [deposit, setDeposit] = useState<G2BDepositResult | null>(null);
  const [status, setStatus] = useState<G2BStatusResult | null>(null);

  const [detecting, setDetecting] = useState(false);
  const [validating, setValidating] = useState(false);
  const [depositing, setDepositing] = useState(false);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawOpen, setRawOpen] = useState(false);

  const reset = () => {
    setDetect(null); setBusiness(null); setDeposit(null); setStatus(null); setForce(false); setError(null);
  };

  const handleFile = async (selected: File | null) => {
    const seq = ++seqRef.current;  // invalide les réponses asynchrones précédentes
    reset();
    setFile(selected);
    setCodeInterface('');
    if (!selected) return;
    setDetecting(true);
    try {
      const result = await detectG2BFlux(config, selected);
      if (seqRef.current !== seq) return;
      setDetect(result);
      if (result.recommendation.recommendedCodeInterface) setCodeInterface(result.recommendation.recommendedCodeInterface);
    } catch (caught) {
      if (seqRef.current === seq) setError(caught instanceof Error ? caught.message : 'Détection impossible.');
    } finally {
      if (seqRef.current === seq) setDetecting(false);
    }
    if (seqRef.current !== seq) return;
    setValidating(true);
    try {
      const result = await businessValidateG2BFlux(config, selected);
      if (seqRef.current === seq) setBusiness(result.businessValidation);
    } catch {
      if (seqRef.current === seq) setBusiness(null);
    } finally {
      if (seqRef.current === seq) setValidating(false);
    }
  };

  const handleDeposit = async () => {
    if (!file || !codeInterface) return;
    setDepositing(true);
    setError(null);
    setStatus(null);
    try {
      const result = await depositG2BFlux(config, file, codeInterface, force);
      setDeposit(result);
      if (result.statusLocal === 'SUBMITTED') {
        toast({ title: 'Flux G2B déposé', description: result.uidFlux ? `uidFlux : ${result.uidFlux}` : undefined });
      } else {
        toast({ variant: 'destructive', title: 'Dépôt non effectué', description: result.message ?? result.error ?? result.explanation?.friendlyMessage ?? undefined });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Dépôt impossible.');
    } finally {
      setDepositing(false);
    }
  };

  const handlePoll = async () => {
    if (!deposit?.uidFlux) return;
    setPolling(true);
    try {
      setStatus(await getG2BFluxStatus(config, deposit.uidFlux, true));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Suivi du statut impossible.');
    } finally {
      setPolling(false);
    }
  };

  const recommendation = detect?.recommendation ?? null;
  const blockedByReco = recommendation?.status === 'blocked';
  const businessBlocking = business?.severity === 'BLOCKING';
  const businessWarning = business?.severity === 'WARNING';
  const canDeposit = Boolean(file) && Boolean(codeInterface) && !blockedByReco && !businessBlocking
    && (!businessWarning || force) && !depositing && !detecting && !validating;

  const issues = business ? [...business.errors, ...business.warnings] : [];

  return (
    <div className="space-y-7 animate-fade-in">
      <PageHeader
        eyebrow={<><Network className="h-3 w-3" /> Chorus Pro · G2B</>}
        title="Dépôt de flux G2B"
        description="Assistant guidé pour l'API G2B Dépôt Flux : détection du fichier, recommandation du codeInterface, validation métier, dépôt et suivi du statut."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {/* ----- Colonne gauche ----- */}
        <div className="space-y-6">
          <Card className="card-elevated">
            <CardHeader><CardTitle className="text-base">1 · Fichier</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <button type="button" onClick={() => fileInputRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center transition-colors hover:border-primary/50 hover:bg-muted/40">
                <FileUp className="h-6 w-6 text-muted-foreground" />
                {file ? <span className="text-sm font-medium">{file.name}</span> : <span className="text-sm text-muted-foreground">Cliquez pour sélectionner un fichier (.xml ou .pdf)</span>}
              </button>
              <input ref={fileInputRef} type="file" accept=".xml,.pdf,application/xml,application/pdf" className="hidden" onChange={(e) => void handleFile(e.target.files?.[0] ?? null)} />
              {detecting && <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Analyse du fichier…</p>}

              {detect && (
                <dl className="grid grid-cols-[140px_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
                  <dt className="text-muted-foreground">Type détecté</dt><dd className="font-medium">{detect.detected.fileType ?? '—'}</dd>
                  {detect.detected.rootElement && (<><dt className="text-muted-foreground">Racine</dt><dd className="font-medium">{detect.detected.rootElement}</dd></>)}
                  {detect.detected.namespace && (<><dt className="text-muted-foreground">Namespace</dt><dd className="break-words font-mono text-[11px]">{detect.detected.namespace}</dd></>)}
                </dl>
              )}

              <div className="space-y-2">
                <Label htmlFor="g2b-code">codeInterface</Label>
                <Select value={codeInterface} onValueChange={setCodeInterface} disabled={!file}>
                  <SelectTrigger id="g2b-code"><SelectValue placeholder="Sélectionnez une interface" /></SelectTrigger>
                  <SelectContent>{G2B_CODE_INTERFACES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Validation métier */}
          {(validating || business) && (
            <Card className="card-elevated">
              <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                <CardTitle className="text-base">2 · Validation métier</CardTitle>
                {business && (() => {
                  const tone = business.severity === 'OK' ? RECO_TONE.recommended : business.severity === 'WARNING' ? RECO_TONE.warning : RECO_TONE.blocked;
                  const Icon = business.severity === 'OK' ? CheckCircle2 : business.severity === 'WARNING' ? AlertTriangle : ShieldAlert;
                  const label = business.severity === 'OK' ? 'Données métier OK' : business.severity === 'WARNING' ? 'À vérifier' : 'Dépôt bloqué';
                  return <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', tone)}><Icon className="h-3.5 w-3.5" /> {label}</span>;
                })()}
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {validating && <p className="flex items-center gap-1.5 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Validation…</p>}
                {business && (
                  <>
                    <dl className="grid grid-cols-[150px_minmax(0,1fr)] gap-x-4 gap-y-1.5">
                      <dt className="text-muted-foreground">N° facture</dt><dd className="font-medium">{business.extracted.invoiceNumber ?? '—'}</dd>
                      <dt className="text-muted-foreground">SIRET fournisseur</dt><dd className="font-medium">{business.extracted.supplierSiret ?? '—'}</dd>
                      <dt className="text-muted-foreground">SIRET destinataire</dt><dd className="font-medium">{business.extracted.customerSiret ?? '—'}</dd>
                      <dt className="text-muted-foreground">Devise / TTC</dt><dd className="font-medium">{business.extracted.currency ?? '—'} · {business.extracted.totalTtc ?? '—'}</dd>
                    </dl>
                    {issues.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sources à corriger</p>
                        {issues.map((issue, i) => (
                          <div key={i} className="rounded-lg border border-border/60 p-2.5 text-xs leading-5">
                            <p className={cn('font-medium', business.errors.includes(issue) ? 'text-destructive' : 'text-warning')}>{issue.message}</p>
                            {issue.xmlPath && <p className="text-muted-foreground">Chemin : <code className="rounded bg-muted px-1 py-0.5 text-[10.5px]">{issue.xmlPath}</code></p>}
                            <p className="text-muted-foreground">Valeur actuelle : {issue.currentValue ?? 'absente'}</p>
                            {issue.suggestedFix && <p className="text-muted-foreground">Correction : {issue.suggestedFix}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* Dépôt */}
          {detect && (
            <Card className="card-elevated">
              <CardHeader><CardTitle className="text-base">3 · Dépôt G2B</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {businessWarning && !businessBlocking && (
                  <div className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/5 p-3">
                    <Checkbox id="g2b-force" checked={force} onCheckedChange={(c) => setForce(c === true)} className="mt-0.5" />
                    <Label htmlFor="g2b-force" className="cursor-pointer text-xs font-normal leading-5 text-muted-foreground">
                      Avertissements métier présents (ex. annuaire non vérifié). Je confirme vouloir déposer malgré tout.
                    </Label>
                  </div>
                )}
                <Button onClick={() => void handleDeposit()} disabled={!canDeposit}>
                  {depositing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Dépôt…</> : <><UploadCloud className="mr-2 h-4 w-4" /> Déposer le flux ({codeInterface || '—'})</>}
                </Button>

                {deposit && deposit.statusLocal === 'SUBMITTED' && (
                  <div className="space-y-2 rounded-lg border border-success/40 bg-success/5 p-3 text-sm">
                    <p className="font-medium text-success">Flux déposé</p>
                    <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-4 gap-y-1">
                      <dt className="text-muted-foreground">uidFlux</dt><dd className="break-words font-mono text-[11px]">{deposit.uidFlux}</dd>
                      <dt className="text-muted-foreground">checksum</dt><dd className="break-words font-mono text-[11px]">{deposit.checksum} ({deposit.checksumMode})</dd>
                    </dl>
                    <Button size="sm" variant="outline" onClick={() => void handlePoll()} disabled={polling}>
                      {polling ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Suivi…</> : <><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Suivre le statut</>}
                    </Button>
                  </div>
                )}
                {deposit && deposit.statusLocal !== 'SUBMITTED' && (
                  <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs leading-5 text-warning">
                    <p>{deposit.message ?? deposit.explanation?.friendlyMessage ?? deposit.error}</p>
                    {deposit.suggestedFix && <p className="mt-1 opacity-80">Correction : {deposit.suggestedFix}</p>}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Statut */}
          {status && (
            <Card className="card-elevated">
              <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                <CardTitle className="text-base">4 · Statut du flux</CardTitle>
                {(() => {
                  const visual = STATUS_TONE[status.status ?? ''] ?? { tone: RECO_TONE.warning, icon: AlertTriangle, label: status.status ?? '—' };
                  const Icon = visual.icon;
                  return <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', visual.tone)}><Icon className="h-3.5 w-3.5" /> {visual.label}</span>;
                })()}
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {status.message && <p className="text-muted-foreground">{status.message}</p>}
                {status.explanation?.friendlyMessage && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs leading-5 text-destructive">
                    {status.explanation.friendlyMessage}
                    {status.explanation.suggestedFix && <p className="mt-1 opacity-80">Correction : {status.explanation.suggestedFix}</p>}
                  </div>
                )}
                {status.temporary && <Button size="sm" variant="outline" onClick={() => void handlePoll()} disabled={polling}><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Réessayer</Button>}
                <button type="button" onClick={() => setRawOpen((o) => !o)} className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
                  <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', rawOpen && 'rotate-180')} /> Détail technique
                </button>
                {rawOpen && <pre className="max-h-60 overflow-auto rounded-lg bg-muted/40 p-3 text-[11px]">{JSON.stringify(status, null, 2)}</pre>}
              </CardContent>
            </Card>
          )}

          {error && <ApiErrorCard severity="error" title="Action impossible" technicalDetails={error} />}
        </div>

        {/* ----- Colonne droite : recommandation ----- */}
        <div className="space-y-6">
          {recommendation && (
            <Card className="card-elevated">
              <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                <CardTitle className="text-base">Recommandation</CardTitle>
                <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', RECO_TONE[recommendation.status] ?? RECO_TONE.warning)}>
                  {recommendation.status === 'recommended' ? 'Recommandé' : recommendation.status === 'blocked' ? 'Bloqué' : 'À vérifier'}
                </span>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="font-medium">{recommendation.title}</p>
                <p className="text-muted-foreground">{recommendation.shortExplanation}</p>
                {recommendation.recommendedCodeInterface && (
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm">Interface : <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{recommendation.recommendedCodeInterface}</code></p>
                    {recommendation.recommendedCodeInterface !== codeInterface && (
                      <Button size="sm" variant="outline" onClick={() => setCodeInterface(recommendation.recommendedCodeInterface!)}>
                        <Wand2 className="mr-1.5 h-3.5 w-3.5" /> Appliquer
                      </Button>
                    )}
                  </div>
                )}
                <div className="rounded-lg bg-muted/40 p-3 text-xs leading-5">
                  <p className="font-medium text-foreground">Pourquoi ?</p>
                  <p className="text-muted-foreground">{recommendation.why}</p>
                </div>
                <p className="text-xs font-medium">{recommendation.actionLabel}</p>
              </CardContent>
            </Card>
          )}

          <Card className="card-elevated">
            <CardHeader><CardTitle className="text-base">Interfaces G2B</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-1 text-xs text-muted-foreground">
                <li><strong className="text-foreground">FSO3110A</strong> — facture UBL 2.1</li>
                <li><strong className="text-foreground">FSO3117A</strong> — facture Factur-X D22B</li>
                <li><strong className="text-foreground">FSO3300A</strong> — cycle de vie facture</li>
                <li><strong className="text-foreground">FSO6000A</strong> — e-reporting</li>
              </ul>
              <p className="mt-3 text-[11px] text-muted-foreground">Le raccordement/abonnement à l'interface est requis côté compte technique (voir admin raccordement).</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

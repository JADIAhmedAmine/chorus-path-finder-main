import { useMemo, useRef, useState } from 'react';
import { UploadCloud, FileUp, Loader2, CheckCircle2, XCircle, AlertTriangle, ChevronDown } from 'lucide-react';
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
  CHORUS_FLUX_SYNTAXES,
  depositChorusFlux,
  type ChorusFluxDepositResult,
  type ChorusFluxSyntaxe,
} from '@/lib/chorus/fluxDeposit';

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

interface StatusVisual {
  label: string;
  className: string;
  icon: typeof CheckCircle2;
}

function statusVisual(result: ChorusFluxDepositResult): StatusVisual {
  switch (result.statusLocal) {
    case 'ACCEPTED':
      return { label: 'Accepté', className: 'bg-success/15 text-success ring-1 ring-success/30', icon: CheckCircle2 };
    case 'REJECTED':
      return { label: 'Rejeté', className: 'bg-warning/15 text-warning ring-1 ring-warning/30', icon: XCircle };
    default:
      return { label: 'Erreur', className: 'bg-destructive/15 text-destructive ring-1 ring-destructive/30', icon: AlertTriangle };
  }
}

export default function FluxDepositPage() {
  const { toast } = useToast();
  const config = useMemo(() => loadChorusConfig(), []);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [syntaxeFlux, setSyntaxeFlux] = useState<ChorusFluxSyntaxe>(CHORUS_FLUX_SYNTAXES[0]);
  const [avecSignature, setAvecSignature] = useState(false);
  const [idUtilisateurCourant, setIdUtilisateurCourant] = useState('0');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ChorusFluxDepositResult | null>(null);
  const [rawOpen, setRawOpen] = useState(false);

  const fileError = file && !hasAllowedExtension(file.name)
    ? 'Seuls les fichiers .xml et .pdf sont acceptés.'
    : null;
  const canSubmit = Boolean(file) && !fileError && !submitting;

  const handleFileChange = (selected: File | null) => {
    setResult(null);
    setError(null);
    setFile(selected);
  };

  const handleSubmit = async () => {
    if (!file) {
      setError('Sélectionnez un fichier XML ou PDF/A3 à déposer.');
      return;
    }
    if (!hasAllowedExtension(file.name)) {
      setError('Seuls les fichiers .xml et .pdf sont acceptés.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setResult(null);

    const parsedUserId = Number.parseInt(idUtilisateurCourant, 10);

    try {
      const deposit = await depositChorusFlux(config, {
        file,
        syntaxeFlux,
        avecSignature,
        idUtilisateurCourant: Number.isFinite(parsedUserId) ? parsedUserId : 0,
      });
      setResult(deposit);

      if (deposit.statusLocal === 'ACCEPTED') {
        toast({
          title: 'Flux déposé',
          description: deposit.numeroFluxDepot
            ? `Numéro de flux : ${deposit.numeroFluxDepot}`
            : 'Le flux a été accepté par Chorus Pro.',
        });
      } else if (deposit.statusLocal === 'REJECTED') {
        toast({
          variant: 'destructive',
          title: 'Flux rejeté par Chorus Pro',
          description: deposit.libelle ?? `codeRetour ${deposit.codeRetour ?? '?'}`,
        });
      } else {
        toast({
          variant: 'destructive',
          title: 'Erreur de dépôt',
          description: deposit.error ?? 'Chorus Pro a renvoyé une erreur.',
        });
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Erreur inconnue lors du dépôt de flux.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-7 animate-fade-in">
      <PageHeader
        eyebrow={<><UploadCloud className="h-3 w-3" /> Chorus Pro · flux</>}
        title="Dépôt de flux"
        description="Déposez un fichier de facture structuré (XML ou PDF/A3) directement en flux via l'API Chorus Pro deposer/flux."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="card-elevated">
          <CardHeader>
            <CardTitle className="text-base">Fichier de flux</CardTitle>
          </CardHeader>
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
                {file ? (
                  <span className="text-sm font-medium text-foreground">{file.name}</span>
                ) : (
                  <span className="text-sm text-muted-foreground">Cliquez pour sélectionner un fichier</span>
                )}
                {file && (
                  <span className="text-xs text-muted-foreground">{formatBytes(file.size)}</span>
                )}
              </button>
              <input
                ref={fileInputRef}
                id="flux-file"
                type="file"
                accept={ACCEPT_ATTR}
                className="hidden"
                onChange={(event) => handleFileChange(event.target.files?.[0] ?? null)}
              />
              {fileError && <p className="text-xs text-destructive">{fileError}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="flux-syntaxe">Syntaxe du flux</Label>
              <Select value={syntaxeFlux} onValueChange={(value) => setSyntaxeFlux(value as ChorusFluxSyntaxe)}>
                <SelectTrigger id="flux-syntaxe"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CHORUS_FLUX_SYNTAXES.map((syntaxe) => (
                    <SelectItem key={syntaxe} value={syntaxe}>{syntaxe}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="flux-user-id">idUtilisateurCourant</Label>
              <Input
                id="flux-user-id"
                type="number"
                min={0}
                value={idUtilisateurCourant}
                onChange={(event) => setIdUtilisateurCourant(event.target.value)}
                className="max-w-[200px]"
              />
            </div>

            <div className="flex items-center gap-2.5">
              <Checkbox
                id="flux-signature"
                checked={avecSignature}
                onCheckedChange={(checked) => setAvecSignature(checked === true)}
              />
              <Label htmlFor="flux-signature" className="cursor-pointer font-normal">
                Avec signature (avecSignature)
              </Label>
            </div>

            <Button onClick={handleSubmit} disabled={!canSubmit} className="w-full sm:w-auto">
              {submitting ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Dépôt en cours…</>
              ) : (
                <><UploadCloud className="mr-2 h-4 w-4" /> Déposer le flux</>
              )}
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-6">
          {error && (
            <ApiErrorCard severity="error" title="Dépôt impossible" technicalDetails={error} />
          )}

          {result ? (
            <Card className="card-elevated">
              <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                <CardTitle className="text-base">Résultat du dépôt</CardTitle>
                {(() => {
                  const visual = statusVisual(result);
                  const Icon = visual.icon;
                  return (
                    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', visual.className)}>
                      <Icon className="h-3.5 w-3.5" /> {visual.label}
                    </span>
                  );
                })()}
              </CardHeader>
              <CardContent className="space-y-3">
                <dl className="grid grid-cols-[160px_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">HTTP</dt>
                  <dd className="font-medium">{result.httpStatus ?? '—'}</dd>
                  <dt className="text-muted-foreground">codeRetour</dt>
                  <dd className="font-medium">{result.codeRetour ?? '—'}</dd>
                  <dt className="text-muted-foreground">libellé</dt>
                  <dd className="font-medium break-words">{result.libelle ?? '—'}</dd>
                  <dt className="text-muted-foreground">dateDepot</dt>
                  <dd className="font-medium">{result.dateDepot ?? '—'}</dd>
                  <dt className="text-muted-foreground">numeroFluxDepot</dt>
                  <dd className="font-medium break-words">{result.numeroFluxDepot ?? '—'}</dd>
                  <dt className="text-muted-foreground">syntaxeFlux</dt>
                  <dd className="font-medium break-words">{result.syntaxeFlux ?? '—'}</dd>
                </dl>

                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setRawOpen((open) => !open)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', rawOpen && 'rotate-180')} />
                    Réponse brute (debug)
                  </button>
                  {rawOpen && (
                    <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
                      {JSON.stringify(result.raw, null, 2)}
                    </pre>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            !error && (
              <Card className="card-elevated">
                <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                  <Badge variant="outline" className="mb-1">En attente</Badge>
                  <p className="text-sm text-muted-foreground">
                    Le résultat du dépôt (codeRetour, libellé, numéro de flux) s'affichera ici.
                  </p>
                </CardContent>
              </Card>
            )
          )}
        </div>
      </div>
    </div>
  );
}

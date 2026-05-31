import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText, FileUp, Loader2, CheckCircle2, XCircle, AlertTriangle, ShieldAlert,
  ChevronDown, Sparkles, Wand2, UploadCloud, ArrowRight, Plus, Trash2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/common/PageHeader';
import { ApiErrorCard } from '@/components/common/ApiErrorCard';
import { useToast } from '@/hooks/use-toast';
import { loadChorusConfig } from '@/lib/chorus/storage';
import { cn } from '@/lib/utils';
import {
  deposerGenerated,
  detectPdfToFlux,
  extractPdfToFlux,
  generateXml,
  validateDraft,
  validateXml,
  type DeposerGeneratedResult,
  type DraftValidationResult,
  type GeneratedXml,
  type InvoiceDraft,
  type PdfDetectResult,
  type ValidateXmlResult,
} from '@/lib/chorus/pdfToFlux';

const TARGET_FORMAT = 'IN_DP_E1_STRUCT';
const TARGET_SYNTAXE = 'IN_DP_E1_UBL_INVOICE';

function parseNum(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function numStr(value: number | null): string {
  return value === null || value === undefined ? '' : String(value);
}

const STATUS_VISUALS: Record<string, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  ACCEPTED: { label: 'Accepté', className: 'bg-success/15 text-success ring-1 ring-success/30', icon: CheckCircle2 },
  REJECTED: { label: 'Rejeté', className: 'bg-warning/15 text-warning ring-1 ring-warning/30', icon: XCircle },
  BLOCKED_LOCAL_VALIDATION: { label: 'Bloqué (validation locale)', className: 'bg-warning/15 text-warning ring-1 ring-warning/30', icon: ShieldAlert },
  ERROR: { label: 'Erreur', className: 'bg-destructive/15 text-destructive ring-1 ring-destructive/30', icon: AlertTriangle },
};

function ConfidenceBadge({ score }: { score: number | undefined }) {
  if (score === undefined) return null;
  const pct = Math.round(score * 100);
  const tone = pct >= 80 ? 'border-success/30 text-success' : pct >= 50 ? 'border-warning/30 text-warning' : 'border-destructive/30 text-destructive';
  return <Badge variant="outline" className={cn('ml-2 px-1.5 py-0 text-[10px]', tone)}>{pct}%</Badge>;
}

export default function PdfToFluxPage() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const config = useMemo(() => loadChorusConfig(), []);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [detection, setDetection] = useState<PdfDetectResult | null>(null);
  const [draft, setDraft] = useState<InvoiceDraft | null>(null);
  const [confidence, setConfidence] = useState<Record<string, number>>({});
  const [extractWarnings, setExtractWarnings] = useState<string[]>([]);
  const [draftValidation, setDraftValidation] = useState<DraftValidationResult | null>(null);
  const [generated, setGenerated] = useState<GeneratedXml | null>(null);
  const [generateWarnings, setGenerateWarnings] = useState<string[]>([]);
  const [xmlValidation, setXmlValidation] = useState<ValidateXmlResult | null>(null);
  const [depositResult, setDepositResult] = useState<DeposerGeneratedResult | null>(null);

  const [detecting, setDetecting] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [validatingDraft, setValidatingDraft] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [validatingXml, setValidatingXml] = useState(false);
  const [depositing, setDepositing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [xmlOpen, setXmlOpen] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);

  const resetDownstream = () => {
    setDraftValidation(null);
    setGenerated(null);
    setGenerateWarnings([]);
    setXmlValidation(null);
    setDepositResult(null);
  };

  const handleFile = async (selected: File | null) => {
    setFile(selected);
    setDetection(null);
    setDraft(null);
    setConfidence({});
    setExtractWarnings([]);
    resetDownstream();
    setError(null);
    if (!selected) return;
    if (!selected.name.toLowerCase().endsWith('.pdf')) {
      setError('Seuls les fichiers PDF sont acceptés sur cette page.');
      return;
    }
    setDetecting(true);
    try {
      setDetection(await detectPdfToFlux(config, selected));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Détection impossible.');
    } finally {
      setDetecting(false);
    }
  };

  const handleExtract = async () => {
    if (!file) return;
    setExtracting(true);
    setError(null);
    resetDownstream();
    try {
      const result = await extractPdfToFlux(config, file);
      setDraft(result.draft);
      setConfidence(result.confidence);
      setExtractWarnings(result.warnings);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Extraction impossible.');
    } finally {
      setExtracting(false);
    }
  };

  // Toute édition du formulaire invalide les étapes aval (re-validation requise).
  const patchDraft = (updater: (current: InvoiceDraft) => InvoiceDraft) => {
    setDraft((current) => (current ? updater(current) : current));
    resetDownstream();
  };

  const handleValidateDraft = async () => {
    if (!draft) return;
    setValidatingDraft(true);
    setError(null);
    try {
      const result = await validateDraft(config, draft);
      setDraftValidation(result);
      if (result.valid) toast({ title: 'Brouillon validé', description: 'Vous pouvez générer le XML.' });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Validation impossible.');
    } finally {
      setValidatingDraft(false);
    }
  };

  const handleGenerate = async () => {
    if (!draft) return;
    setGenerating(true);
    setError(null);
    setGenerated(null);
    setXmlValidation(null);
    setDepositResult(null);
    try {
      const result = await generateXml(config, draft, { formatFlux: TARGET_FORMAT, syntaxeFlux: TARGET_SYNTAXE });
      if (!result.success || !result.generated) {
        setError(result.error ?? 'Génération du XML impossible.');
        if (result.validation) setDraftValidation(result.validation);
        return;
      }
      setGenerated(result.generated);
      setGenerateWarnings(result.warnings);
      setXmlOpen(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Génération impossible.');
    } finally {
      setGenerating(false);
    }
  };

  const handleValidateXml = async () => {
    if (!generated) return;
    setValidatingXml(true);
    setError(null);
    try {
      const result = await validateXml(config, generated.xmlPreview, generated.syntaxeFlux);
      setXmlValidation(result);
      setDepositResult(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Validation XML impossible.');
    } finally {
      setValidatingXml(false);
    }
  };

  const handleDeposit = async () => {
    if (!generated || !xmlValidation?.valid) return;
    setDepositing(true);
    setError(null);
    try {
      const result = await deposerGenerated(config, {
        xml: generated.xmlPreview,
        filename: generated.filename,
        formatFlux: generated.formatFlux,
        syntaxeFlux: generated.syntaxeFlux,
      });
      setDepositResult(result);
      if (result.statusLocal === 'ACCEPTED') {
        toast({ title: 'Flux déposé', description: result.numeroFluxDepot ? `Numéro de flux : ${result.numeroFluxDepot}` : 'Flux accepté.' });
      } else {
        toast({ variant: 'destructive', title: 'Dépôt non accepté', description: result.explanation?.message ?? result.error ?? result.libelle ?? `codeRetour ${result.codeRetour ?? '?'}` });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Dépôt impossible.');
    } finally {
      setDepositing(false);
    }
  };

  const goToFluxDeposit = () => {
    navigate('/invoices/flux', {
      state: {
        presetFormatFlux: detection?.recommended?.formatFlux?.[0],
        presetSyntaxeFlux: detection?.recommended?.syntaxeFlux?.[0],
      },
    });
  };

  const canGenerate = Boolean(draft) && draftValidation?.valid === true && !generating;
  const canDeposit = Boolean(generated) && xmlValidation?.valid === true && !depositing;

  return (
    <div className="space-y-7 animate-fade-in">
      <PageHeader
        eyebrow={<><Sparkles className="h-3 w-3" /> Chorus Pro · flux</>}
        title="PDF facture → flux"
        description="Transformez une facture PDF visuelle en flux UBL structuré. L'extraction est relue et corrigée par vos soins avant génération et dépôt — un PDF normal n'est jamais déposé tel quel."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        {/* ----------------------------- COLONNE GAUCHE ----------------------------- */}
        <div className="space-y-6">
          {/* 1. Upload + détection */}
          <Card className="card-elevated">
            <CardHeader><CardTitle className="text-base">1 · Facture PDF</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center transition-colors hover:border-primary/50 hover:bg-muted/40"
              >
                <FileUp className="h-6 w-6 text-muted-foreground" />
                {file ? <span className="text-sm font-medium">{file.name}</span> : <span className="text-sm text-muted-foreground">Cliquez pour sélectionner un PDF</span>}
              </button>
              <input ref={fileInputRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={(e) => void handleFile(e.target.files?.[0] ?? null)} />

              {detecting && <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Analyse du PDF…</p>}

              {detection && detection.isFacturx && (
                <div className="space-y-3 rounded-lg border border-success/40 bg-success/5 p-4">
                  <p className="flex items-center gap-2 text-sm font-medium text-success"><CheckCircle2 className="h-4 w-4" /> Factur-X détecté</p>
                  <p className="text-sm text-muted-foreground">{detection.message}</p>
                  <Button onClick={goToFluxDeposit} variant="outline" size="sm"><ArrowRight className="mr-1.5 h-3.5 w-3.5" /> Aller au dépôt de flux</Button>
                </div>
              )}

              {detection && detection.conversionRequired && (
                <div className="space-y-3 rounded-lg border border-warning/40 bg-warning/5 p-4">
                  <p className="flex items-center gap-2 text-sm font-medium text-warning"><AlertTriangle className="h-4 w-4" /> Conversion requise</p>
                  <p className="text-sm text-muted-foreground">Ce PDF est une facture visuelle. Il faut extraire les données puis générer un flux structuré.</p>
                  <Button onClick={() => void handleExtract()} disabled={extracting} size="sm">
                    {extracting ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Extraction…</> : <><Wand2 className="mr-1.5 h-3.5 w-3.5" /> Extraire les données</>}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 2. Formulaire de relecture */}
          {draft && (
            <Card className="card-elevated">
              <CardHeader>
                <CardTitle className="text-base">2 · Vérifier &amp; corriger</CardTitle>
                <p className="text-xs text-muted-foreground">Vérifiez les champs extraits avant de générer le XML. Les montants, SIRET et numéros de facture doivent être exacts.</p>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Fournisseur */}
                <section className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fournisseur</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Nom" conf={confidence['supplier.name']}>
                      <Input value={draft.supplier.name ?? ''} onChange={(e) => patchDraft((d) => ({ ...d, supplier: { ...d.supplier, name: e.target.value || null } }))} />
                    </Field>
                    <Field label="SIRET" conf={confidence['supplier.siret']}>
                      <Input value={draft.supplier.siret ?? ''} onChange={(e) => patchDraft((d) => ({ ...d, supplier: { ...d.supplier, siret: e.target.value || null } }))} />
                    </Field>
                    <Field label="TVA intracommunautaire" conf={confidence['supplier.vat_number']}>
                      <Input value={draft.supplier.vat_number ?? ''} onChange={(e) => patchDraft((d) => ({ ...d, supplier: { ...d.supplier, vat_number: e.target.value || null } }))} />
                    </Field>
                    <Field label="Adresse">
                      <Input value={draft.supplier.address ?? ''} onChange={(e) => patchDraft((d) => ({ ...d, supplier: { ...d.supplier, address: e.target.value || null } }))} />
                    </Field>
                  </div>
                </section>

                {/* Client */}
                <section className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Client</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Nom" conf={confidence['customer.name']}>
                      <Input value={draft.customer.name ?? ''} onChange={(e) => patchDraft((d) => ({ ...d, customer: { ...d.customer, name: e.target.value || null } }))} />
                    </Field>
                    <Field label="SIRET" conf={confidence['customer.siret']}>
                      <Input value={draft.customer.siret ?? ''} onChange={(e) => patchDraft((d) => ({ ...d, customer: { ...d.customer, siret: e.target.value || null } }))} />
                    </Field>
                    <Field label="Code service">
                      <Input value={draft.customer.service_code ?? ''} onChange={(e) => patchDraft((d) => ({ ...d, customer: { ...d.customer, service_code: e.target.value || null } }))} />
                    </Field>
                    <Field label="Numéro d'engagement">
                      <Input value={draft.customer.engagement_number ?? ''} onChange={(e) => patchDraft((d) => ({ ...d, customer: { ...d.customer, engagement_number: e.target.value || null } }))} />
                    </Field>
                    <Field label="Adresse">
                      <Input value={draft.customer.address ?? ''} onChange={(e) => patchDraft((d) => ({ ...d, customer: { ...d.customer, address: e.target.value || null } }))} />
                    </Field>
                  </div>
                </section>

                {/* Facture */}
                <section className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Facture</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Numéro de facture" conf={confidence['invoice_number']}>
                      <Input value={draft.invoice.invoice_number ?? ''} onChange={(e) => patchDraft((d) => ({ ...d, invoice: { ...d.invoice, invoice_number: e.target.value || null } }))} />
                    </Field>
                    <Field label="Devise">
                      <Input value={draft.invoice.currency ?? ''} onChange={(e) => patchDraft((d) => ({ ...d, invoice: { ...d.invoice, currency: e.target.value || null } }))} />
                    </Field>
                    <Field label="Date facture (AAAA-MM-JJ)" conf={confidence['invoice_date']}>
                      <Input value={draft.invoice.invoice_date ?? ''} onChange={(e) => patchDraft((d) => ({ ...d, invoice: { ...d.invoice, invoice_date: e.target.value || null } }))} />
                    </Field>
                    <Field label="Date échéance (AAAA-MM-JJ)" conf={confidence['due_date']}>
                      <Input value={draft.invoice.due_date ?? ''} onChange={(e) => patchDraft((d) => ({ ...d, invoice: { ...d.invoice, due_date: e.target.value || null } }))} />
                    </Field>
                    <Field label="Total HT" conf={confidence['total_ht']}>
                      <Input type="number" step="0.01" value={numStr(draft.invoice.total_ht)} onChange={(e) => patchDraft((d) => ({ ...d, invoice: { ...d.invoice, total_ht: parseNum(e.target.value) } }))} />
                    </Field>
                    <Field label="Total TVA" conf={confidence['total_tva']}>
                      <Input type="number" step="0.01" value={numStr(draft.invoice.total_tva)} onChange={(e) => patchDraft((d) => ({ ...d, invoice: { ...d.invoice, total_tva: parseNum(e.target.value) } }))} />
                    </Field>
                    <Field label="Total TTC" conf={confidence['total_ttc']}>
                      <Input type="number" step="0.01" value={numStr(draft.invoice.total_ttc)} onChange={(e) => patchDraft((d) => ({ ...d, invoice: { ...d.invoice, total_ttc: parseNum(e.target.value) } }))} />
                    </Field>
                  </div>
                </section>

                {/* TVA */}
                <section className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ventilation TVA</p>
                    <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => patchDraft((d) => ({ ...d, vat_breakdown: [...d.vat_breakdown, { vat_rate: null, base_amount: null, vat_amount: null }] }))}><Plus className="mr-1 h-3 w-3" /> Ajouter</Button>
                  </div>
                  {draft.vat_breakdown.map((entry, idx) => (
                    <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
                      <Field label="Taux %"><Input type="number" step="0.01" value={numStr(entry.vat_rate)} onChange={(e) => patchDraft((d) => ({ ...d, vat_breakdown: d.vat_breakdown.map((v, i) => i === idx ? { ...v, vat_rate: parseNum(e.target.value) } : v) }))} /></Field>
                      <Field label="Base HT"><Input type="number" step="0.01" value={numStr(entry.base_amount)} onChange={(e) => patchDraft((d) => ({ ...d, vat_breakdown: d.vat_breakdown.map((v, i) => i === idx ? { ...v, base_amount: parseNum(e.target.value) } : v) }))} /></Field>
                      <Field label="Montant TVA"><Input type="number" step="0.01" value={numStr(entry.vat_amount)} onChange={(e) => patchDraft((d) => ({ ...d, vat_breakdown: d.vat_breakdown.map((v, i) => i === idx ? { ...v, vat_amount: parseNum(e.target.value) } : v) }))} /></Field>
                      <Button type="button" size="icon" variant="ghost" className="h-9 w-9 text-muted-foreground" onClick={() => patchDraft((d) => ({ ...d, vat_breakdown: d.vat_breakdown.filter((_, i) => i !== idx) }))}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ))}
                </section>

                {/* Lignes */}
                <section className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lignes</p>
                    <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => patchDraft((d) => ({ ...d, lines: [...d.lines, { description: null, quantity: 1, unit_price: null, vat_rate: null, line_total_ht: null }] }))}><Plus className="mr-1 h-3 w-3" /> Ajouter</Button>
                  </div>
                  {draft.lines.map((line, idx) => (
                    <div key={idx} className="space-y-2 rounded-lg border border-border/60 p-3">
                      <div className="flex items-end gap-2">
                        <Field label="Description" className="flex-1"><Input value={line.description ?? ''} onChange={(e) => patchDraft((d) => ({ ...d, lines: d.lines.map((l, i) => i === idx ? { ...l, description: e.target.value || null } : l) }))} /></Field>
                        <Button type="button" size="icon" variant="ghost" className="h-9 w-9 text-muted-foreground" onClick={() => patchDraft((d) => ({ ...d, lines: d.lines.filter((_, i) => i !== idx) }))}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <Field label="Qté"><Input type="number" step="0.01" value={numStr(line.quantity)} onChange={(e) => patchDraft((d) => ({ ...d, lines: d.lines.map((l, i) => i === idx ? { ...l, quantity: parseNum(e.target.value) } : l) }))} /></Field>
                        <Field label="PU HT"><Input type="number" step="0.01" value={numStr(line.unit_price)} onChange={(e) => patchDraft((d) => ({ ...d, lines: d.lines.map((l, i) => i === idx ? { ...l, unit_price: parseNum(e.target.value) } : l) }))} /></Field>
                        <Field label="Taux %"><Input type="number" step="0.01" value={numStr(line.vat_rate)} onChange={(e) => patchDraft((d) => ({ ...d, lines: d.lines.map((l, i) => i === idx ? { ...l, vat_rate: parseNum(e.target.value) } : l) }))} /></Field>
                        <Field label="Total ligne HT"><Input type="number" step="0.01" value={numStr(line.line_total_ht)} onChange={(e) => patchDraft((d) => ({ ...d, lines: d.lines.map((l, i) => i === idx ? { ...l, line_total_ht: parseNum(e.target.value) } : l) }))} /></Field>
                      </div>
                    </div>
                  ))}
                </section>

                {/* Champs Chorus */}
                <section className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Champs Chorus</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Cadre de facturation"><Input value={draft.chorus.cadre_facturation ?? ''} onChange={(e) => patchDraft((d) => ({ ...d, chorus: { ...d.chorus, cadre_facturation: e.target.value || null } }))} /></Field>
                    <Field label="Code service"><Input value={draft.chorus.service_code ?? ''} onChange={(e) => patchDraft((d) => ({ ...d, chorus: { ...d.chorus, service_code: e.target.value || null } }))} /></Field>
                    <Field label="Numéro d'engagement"><Input value={draft.chorus.engagement_number ?? ''} onChange={(e) => patchDraft((d) => ({ ...d, chorus: { ...d.chorus, engagement_number: e.target.value || null } }))} /></Field>
                    <Field label="Format cible"><Input value={draft.chorus.format_flux_target ?? TARGET_FORMAT} readOnly className="bg-muted/40" /></Field>
                    <Field label="Syntaxe cible"><Input value={draft.chorus.syntaxe_flux_target ?? TARGET_SYNTAXE} readOnly className="bg-muted/40" /></Field>
                  </div>
                </section>

                <div className="flex flex-wrap gap-2 border-t pt-4">
                  <Button onClick={() => void handleValidateDraft()} disabled={validatingDraft} variant="outline">
                    {validatingDraft ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Validation…</> : 'Valider les données'}
                  </Button>
                  <Button onClick={() => void handleGenerate()} disabled={!canGenerate}>
                    {generating ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Génération…</> : <><FileText className="mr-2 h-4 w-4" /> Générer le XML</>}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* 3. XML généré */}
          {generated && (
            <Card className="card-elevated">
              <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                <CardTitle className="text-base">3 · XML généré</CardTitle>
                {xmlValidation && (
                  <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', xmlValidation.valid ? 'bg-success/15 text-success ring-1 ring-success/30' : 'bg-destructive/15 text-destructive ring-1 ring-destructive/30')}>
                    {xmlValidation.valid ? <CheckCircle2 className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />} {xmlValidation.valid ? 'XML valide' : 'XML invalide'}
                  </span>
                )}
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-muted-foreground">Le XML a été généré à partir des données validées. Vérifiez-le avant dépôt.</p>
                <dl className="grid grid-cols-[140px_minmax(0,1fr)] gap-x-4 gap-y-1.5">
                  <dt className="text-muted-foreground">Fichier</dt><dd className="font-medium">{generated.filename}</dd>
                  <dt className="text-muted-foreground">Format / Syntaxe</dt><dd className="font-mono text-[11px]">{generated.formatFlux} · {generated.syntaxeFlux}</dd>
                  <dt className="text-muted-foreground">Type détecté</dt><dd className="font-medium">{generated.detectedFileType}</dd>
                </dl>
                <button type="button" onClick={() => setXmlOpen((o) => !o)} className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
                  <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', xmlOpen && 'rotate-180')} /> Aperçu XML
                </button>
                {xmlOpen && <pre className="max-h-80 overflow-auto rounded-lg bg-muted/40 p-3 text-[11px] leading-relaxed">{generated.xmlPreview}</pre>}
                <div className="flex flex-wrap gap-2 border-t pt-3">
                  <Button onClick={() => void handleValidateXml()} disabled={validatingXml} variant="outline">
                    {validatingXml ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Validation…</> : 'Valider le XML'}
                  </Button>
                  <Button onClick={() => void handleDeposit()} disabled={!canDeposit}>
                    {depositing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Dépôt…</> : <><UploadCloud className="mr-2 h-4 w-4" /> Déposer le XML généré</>}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">Le dépôt envoie le XML généré à Chorus Pro via /v1/deposer/flux.</p>
              </CardContent>
            </Card>
          )}

          {error && <ApiErrorCard severity="error" title="Action impossible" technicalDetails={error} />}

          {/* 4. Résultat du dépôt */}
          {depositResult && (
            <Card className="card-elevated">
              <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                <CardTitle className="text-base">4 · Résultat du dépôt</CardTitle>
                {(() => {
                  const visual = STATUS_VISUALS[depositResult.statusLocal] ?? STATUS_VISUALS.ERROR;
                  const Icon = visual.icon;
                  return <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', visual.className)}><Icon className="h-3.5 w-3.5" /> {visual.label}</span>;
                })()}
              </CardHeader>
              <CardContent className="space-y-3">
                {depositResult.explanation && <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs leading-5 text-warning">{depositResult.explanation.message}</div>}
                <dl className="grid grid-cols-[160px_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">HTTP</dt><dd className="font-medium">{depositResult.httpStatus ?? '—'}</dd>
                  <dt className="text-muted-foreground">codeRetour</dt><dd className="font-medium">{depositResult.codeRetour ?? '—'}</dd>
                  <dt className="text-muted-foreground">libellé</dt><dd className="font-medium break-words">{depositResult.libelle ?? '—'}</dd>
                  <dt className="text-muted-foreground">dateDepot</dt><dd className="font-medium">{depositResult.dateDepot ?? '—'}</dd>
                  <dt className="text-muted-foreground">numeroFluxDepot</dt><dd className="font-medium break-words">{depositResult.numeroFluxDepot ?? '—'}</dd>
                </dl>
                <button type="button" onClick={() => setRawOpen((o) => !o)} className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
                  <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', rawOpen && 'rotate-180')} /> Réponse brute (debug)
                </button>
                {rawOpen && <pre className="max-h-72 overflow-auto rounded-lg bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-foreground">{JSON.stringify(depositResult.raw, null, 2)}</pre>}
              </CardContent>
            </Card>
          )}
        </div>

        {/* ----------------------------- COLONNE DROITE ----------------------------- */}
        <div className="space-y-6">
          <Card className="card-elevated">
            <CardHeader><CardTitle className="text-base">Assistant</CardTitle></CardHeader>
            <CardContent className="space-y-4 text-sm">
              <ol className="space-y-2">
                <Step done={Boolean(detection)} active={!detection}>Importer le PDF &amp; détecter le type</Step>
                <Step done={Boolean(draft)} active={Boolean(detection?.conversionRequired) && !draft}>Extraire les données</Step>
                <Step done={draftValidation?.valid === true} active={Boolean(draft) && draftValidation?.valid !== true}>Vérifier &amp; valider les champs</Step>
                <Step done={Boolean(generated)} active={canGenerate}>Générer le XML</Step>
                <Step done={xmlValidation?.valid === true} active={Boolean(generated) && xmlValidation?.valid !== true}>Valider le XML</Step>
                <Step done={depositResult?.statusLocal === 'ACCEPTED'} active={canDeposit}>Déposer le flux</Step>
              </ol>
              <div className="rounded-lg bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
                La validation humaine est obligatoire : aucun PDF n'est converti ni déposé automatiquement.
              </div>
            </CardContent>
          </Card>

          {/* Champs manquants / erreurs */}
          {draft && draftValidation && (draftValidation.errors.length > 0 || draftValidation.warnings.length > 0) && (
            <Card className="card-elevated">
              <CardHeader><CardTitle className="text-base">Champs à compléter</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                {draftValidation.errors.length > 0 && (
                  <ul className="space-y-1.5">
                    {draftValidation.errors.map((issue, i) => (
                      <li key={`e${i}`} className="flex items-start gap-2 text-destructive"><XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{issue.message}</span></li>
                    ))}
                  </ul>
                )}
                {draftValidation.warnings.length > 0 && (
                  <ul className="space-y-1.5">
                    {draftValidation.warnings.map((issue, i) => (
                      <li key={`w${i}`} className="flex items-start gap-2 text-warning"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{issue.message}</span></li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}

          {/* Avertissements d'extraction */}
          {extractWarnings.length > 0 && (
            <Card className="card-elevated">
              <CardHeader><CardTitle className="text-base">Avertissements d'extraction</CardTitle></CardHeader>
              <CardContent>
                <ul className="space-y-1.5 text-sm text-muted-foreground">
                  {extractWarnings.map((w, i) => <li key={i} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" /> <span>{w}</span></li>)}
                </ul>
              </CardContent>
            </Card>
          )}

          {generateWarnings.length > 0 && (
            <Card className="card-elevated">
              <CardHeader><CardTitle className="text-base">Remarques sur le XML</CardTitle></CardHeader>
              <CardContent>
                <ul className="space-y-1.5 text-sm text-muted-foreground">
                  {generateWarnings.map((w, i) => <li key={i} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" /> <span>{w}</span></li>)}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, conf, className, children }: { label: string; conf?: number; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label className="flex items-center text-xs font-normal text-muted-foreground">{label}<ConfidenceBadge score={conf} /></Label>
      {children}
    </div>
  );
}

function Step({ done, active, children }: { done: boolean; active: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className={cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px]', done ? 'bg-success text-success-foreground' : active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
        {done ? '✓' : '•'}
      </span>
      <span className={cn(done ? 'text-foreground' : active ? 'font-medium text-foreground' : 'text-muted-foreground')}>{children}</span>
    </li>
  );
}

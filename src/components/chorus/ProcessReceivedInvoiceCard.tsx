import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ChorusBackendAutomationClient } from '@/lib/chorus/backendAutomation';
import { loadChorusConfig, resolveChorusRuntimeConfig } from '@/lib/chorus/storage';
import {
  RECEPTION_PROCESS_MOTIF_REQUIRED,
  RECEPTION_PROCESS_STATUSES,
  type ReceptionProcessResult,
  type ReceptionProcessStatus,
} from '@/types/chorus';

interface ProcessReceivedInvoiceCardProps {
  identifiantFactureCPP: number;
  /** Statut actuel — utilisé pour préselectionner ou désactiver l'option. */
  currentStatus?: string | null;
  /** Appelé après un succès (HTTP 200, codeRetour=0). */
  onProcessed?: (result: ReceptionProcessResult) => void;
}

type FormState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'success'; libelle: string | null }
  | { status: 'error'; result: Extract<ReceptionProcessResult, { success: false }> };

const STATUS_LABELS: Record<ReceptionProcessStatus, string> = {
  A_RECYCLER: 'À recycler',
  COMPLETEE: 'Complétée',
  COMPTABILISEE: 'Comptabilisée',
  MISE_A_DISPOSITION: 'Mise à disposition',
  MISE_A_DISPOSITION_COMPTABLE: 'Mise à disposition comptable',
  MISE_EN_PAIEMENT: 'Mise en paiement',
  PRISE_EN_COMPTE_DESTINATAIRE: 'Prise en compte (destinataire)',
  REJETEE: 'Rejetée',
  SERVICE_FAIT: 'Service fait',
  SUSPENDUE: 'Suspendue',
  TRANSMISE_MOA: 'Transmise MOA',
  MANDATEE: 'Mandatée',
};

export function ProcessReceivedInvoiceCard({
  identifiantFactureCPP,
  currentStatus,
  onProcessed,
}: ProcessReceivedInvoiceCardProps) {
  const [nouveauStatut, setNouveauStatut] = useState<ReceptionProcessStatus | ''>('');
  const [motif, setMotif] = useState('');
  const [numeroDPMandat, setNumeroDPMandat] = useState('');
  const [formState, setFormState] = useState<FormState>({ status: 'idle' });

  const motifRequired = useMemo(
    () => Boolean(nouveauStatut && RECEPTION_PROCESS_MOTIF_REQUIRED.has(nouveauStatut)),
    [nouveauStatut],
  );

  const canSubmit =
    formState.status !== 'submitting'
    && Boolean(nouveauStatut)
    && (!motifRequired || motif.trim().length > 0);

  async function handleSubmit() {
    if (!nouveauStatut) return;
    if (motifRequired && !motif.trim()) return;

    setFormState({ status: 'submitting' });
    try {
      const config = resolveChorusRuntimeConfig(loadChorusConfig());
      const result = await new ChorusBackendAutomationClient(config).processReceivedInvoice({
        idFacture: identifiantFactureCPP,
        nouveauStatut,
        motif: motif.trim() || undefined,
        numeroDPMandat: numeroDPMandat.trim() || undefined,
      });

      if (result.ok && result.success) {
        const libelle = typeof result.response?.libelle === 'string' ? result.response.libelle : null;
        setFormState({ status: 'success', libelle });
        setMotif('');
        setNumeroDPMandat('');
        onProcessed?.(result);
      } else {
        setFormState({ status: 'error', result });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inattendue.';
      setFormState({
        status: 'error',
        result: {
          ok: false,
          success: false,
          identifiantFactureCPP,
          category: 'NETWORK',
          human_message: 'Le backend Chorus Pilot est injoignable.',
          raw_message: message,
          recommended_action: 'Vérifier que le bridge FastAPI est démarré et accessible.',
        },
      });
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center text-base">
          <ShieldCheck className="mr-2 h-4 w-4" />
          Traiter la facture reçue
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Action côté valideur (POST <code>/v1/traiter/recue</code>). Le motif est obligatoire pour
          REJETEE et SUSPENDUE.
        </p>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="reception-process-statut">Nouveau statut</Label>
            <Select
              value={nouveauStatut || undefined}
              onValueChange={(value) => setNouveauStatut(value as ReceptionProcessStatus)}
            >
              <SelectTrigger id="reception-process-statut">
                <SelectValue placeholder="Sélectionner un statut..." />
              </SelectTrigger>
              <SelectContent>
                {RECEPTION_PROCESS_STATUSES.map((value) => (
                  <SelectItem key={value} value={value} disabled={value === currentStatus}>
                    {STATUS_LABELS[value]} ({value})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {currentStatus && (
              <p className="text-xs text-muted-foreground">
                Statut actuel : <span className="font-medium">{currentStatus}</span>
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reception-process-dpmandat">N° DP / mandat (optionnel)</Label>
            <Input
              id="reception-process-dpmandat"
              value={numeroDPMandat}
              onChange={(event) => setNumeroDPMandat(event.target.value)}
              placeholder="Ex. DPM-2026-00123"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="reception-process-motif">
            Motif {motifRequired && <span className="text-destructive">*</span>}
          </Label>
          <Textarea
            id="reception-process-motif"
            value={motif}
            onChange={(event) => setMotif(event.target.value)}
            rows={3}
            placeholder={motifRequired
              ? 'Obligatoire pour REJETEE / SUSPENDUE'
              : 'Optionnel : préciser le contexte métier'}
          />
          {motifRequired && motif.trim().length === 0 && (
            <p className="text-xs text-destructive">
              Un motif explicite est requis pour {nouveauStatut}.
            </p>
          )}
        </div>

        {formState.status === 'error' && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Traitement refusé</AlertTitle>
            <AlertDescription className="space-y-1 text-sm">
              <p>{formState.result.human_message}</p>
              {formState.result.recommended_action && (
                <p className="text-xs">
                  <strong>Action recommandée :</strong> {formState.result.recommended_action}
                </p>
              )}
              {formState.result.raw_message
                && formState.result.raw_message !== formState.result.human_message && (
                  <p className="text-xs text-muted-foreground">
                    Détail : {formState.result.raw_message}
                  </p>
                )}
            </AlertDescription>
          </Alert>
        )}

        {formState.status === 'success' && (
          <Alert>
            <CheckCircle2 className="h-4 w-4 text-success" />
            <AlertTitle>Traitement enregistré côté Chorus</AlertTitle>
            <AlertDescription className="text-sm">
              {formState.libelle
                ? `Chorus a renvoyé : ${formState.libelle}.`
                : 'Le statut a été mis à jour côté Chorus.'}
              {' '}La facture est rangée dans les factures traitées.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex justify-end">
          <Button onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {formState.status === 'submitting'
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <ShieldCheck className="mr-2 h-4 w-4" />}
            Appliquer le traitement
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

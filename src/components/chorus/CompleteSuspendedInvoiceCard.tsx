import { useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Paperclip, PauseCircle, Plus, XCircle } from 'lucide-react';
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
import type {
  ReceptionCompleteAttachmentInput,
  ReceptionCompleteResult,
  ReceptionInvoiceAttachment,
} from '@/types/chorus';

interface CompleteSuspendedInvoiceCardProps {
  identifiantFactureCPP: number;
  statutFacture: string | null;
  attachments: ReceptionInvoiceAttachment[];
  onCompleted?: (result: ReceptionCompleteResult) => void;
}

type SubmitState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; result: Extract<ReceptionCompleteResult, { ok: true }> }
  | { status: 'error'; result: Extract<ReceptionCompleteResult, { ok: false }> };

function asPositiveNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

export function CompleteSuspendedInvoiceCard({
  identifiantFactureCPP,
  statutFacture,
  attachments,
  onCompleted,
}: CompleteSuspendedInvoiceCardProps) {
  const isSuspended = statutFacture?.trim().toUpperCase() === 'SUSPENDUE';
  const [commentaire, setCommentaire] = useState('');
  const [selectedAttachmentId, setSelectedAttachmentId] = useState('');
  const [attachmentType, setAttachmentType] = useState('DIVERS');
  const [lineNumber, setLineNumber] = useState('');
  const [newFile, setNewFile] = useState<File | null>(null);
  const [newFileDesignation, setNewFileDesignation] = useState('');
  const [state, setState] = useState<SubmitState>({ status: 'idle' });

  const complementaryAttachments = useMemo(
    () => attachments.filter((attachment) =>
      attachment.role === 'COMPLEMENTAIRE'
      && attachment.pieceJointeId
      && attachment.typeCode !== 'DUPLICATA_FACTUR-X'
      && attachment.typeLibelle !== 'DUPLICATA_FACTUR-X',
    ),
    [attachments],
  );
  const selectedAttachment = complementaryAttachments.find(
    (attachment) => attachment.pieceJointeId === selectedAttachmentId,
  );
  const canSubmit = isSuspended && (
    commentaire.trim().length > 0 || !!selectedAttachment || !!newFile
  ) && state.status !== 'loading';

  async function handleSubmit() {
    if (!canSubmit) return;

    const pieceJointeComplementaire: ReceptionCompleteAttachmentInput[] = [];
    if (selectedAttachment?.pieceJointeId) {
      pieceJointeComplementaire.push({
        pieceJointeComplementaireId: Number(selectedAttachment.pieceJointeId),
        pieceJointeComplementaireDesignation:
          selectedAttachment.designation || `Pièce jointe ${selectedAttachment.pieceJointeId}`,
        pieceJointeComplementaireType: attachmentType.trim() || selectedAttachment.typeCode || 'DIVERS',
        ...(asPositiveNumber(lineNumber) !== undefined
          ? { pieceJointeComplementaireNumeroLigneFacture: asPositiveNumber(lineNumber) }
          : {}),
      });
    }

    setState({ status: 'loading' });
    try {
      const config = resolveChorusRuntimeConfig(loadChorusConfig());
      const result = await new ChorusBackendAutomationClient(config).completeSuspendedInvoice({
        identifiantFactureCPP,
        commentaire: commentaire.trim() || undefined,
        pieceJointeComplementaire,
        attachmentFiles: newFile
          ? [{
              file: newFile,
              designation: newFileDesignation.trim() || newFile.name,
              type: attachmentType.trim() || 'DIVERS',
              ...(asPositiveNumber(lineNumber) !== undefined
                ? { lineNumber: asPositiveNumber(lineNumber) }
                : {}),
            }]
          : undefined,
      });
      if (result.ok) {
        setState({ status: 'success', result });
        onCompleted?.(result);
        return;
      }
      setState({ status: 'error', result });
    } catch (error) {
      setState({
        status: 'error',
        result: {
          ok: false,
          success: false,
          identifiantFactureCPP,
          category: 'UNKNOWN',
          human_message: error instanceof Error ? error.message : 'Complément impossible.',
          raw_message: 'network_or_runtime_error',
          recommended_action: 'Réessayer ; si le problème persiste, vérifier les logs Chorus.',
        },
      });
    }
  }

  if (!isSuspended) {
    return null;
  }

  return (
    <Card className="border-amber-200 bg-amber-50/40">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center text-base">
          <PauseCircle className="mr-2 h-4 w-4 text-amber-600" />
          Compléter la facture suspendue
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Paperclip className="h-4 w-4" />
          <AlertDescription>
            Ajoutez un commentaire, référencez une pièce jointe déjà connue ou téléversez une nouvelle pièce
            complémentaire. Le fichier est envoyé au backend, puis le backend l’upload dans Chorus Pro.
          </AlertDescription>
        </Alert>

        <div className="space-y-1.5">
          <Label htmlFor="complete-commentaire">Commentaire</Label>
          <Textarea
            id="complete-commentaire"
            rows={4}
            value={commentaire}
            onChange={(event) => setCommentaire(event.target.value)}
            placeholder="Expliquez le complément apporté à la facture suspendue."
          />
        </div>

        <div className="rounded-md border bg-background p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Label htmlFor="complete-new-file">Nouvelle pièce jointe complémentaire</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                PDF, image ou document justificatif à associer au complément.
              </p>
            </div>
            {newFile && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setNewFile(null);
                  setNewFileDesignation('');
                }}
              >
                Retirer
              </Button>
            )}
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr]">
            <Input
              id="complete-new-file"
              type="file"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                setNewFile(file);
                setNewFileDesignation(file?.name ?? '');
              }}
            />
            <Input
              value={newFileDesignation}
              onChange={(event) => setNewFileDesignation(event.target.value)}
              placeholder="Désignation de la pièce"
              disabled={!newFile}
            />
          </div>
          {newFile && (
            <p className="mt-2 text-xs text-muted-foreground">
              {newFile.name} · {(newFile.size / 1024).toFixed(0)} Ko
            </p>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-[1fr_160px_160px]">
          <div className="space-y-1.5">
            <Label>Pièce jointe complémentaire connue</Label>
            <Select value={selectedAttachmentId} onValueChange={setSelectedAttachmentId}>
              <SelectTrigger>
                <SelectValue placeholder="Aucune pièce sélectionnée" />
              </SelectTrigger>
              <SelectContent>
                {complementaryAttachments.map((attachment) => (
                  <SelectItem key={attachment.pieceJointeId} value={attachment.pieceJointeId || ''}>
                    {attachment.designation || `PJ ${attachment.pieceJointeId}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {complementaryAttachments.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Aucune pièce jointe complémentaire exploitable n’est listée sur cette facture.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="complete-type">Type</Label>
            <Input id="complete-type" value={attachmentType} onChange={(event) => setAttachmentType(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="complete-line">Ligne facture</Label>
            <Input
              id="complete-line"
              inputMode="numeric"
              value={lineNumber}
              onChange={(event) => setLineNumber(event.target.value)}
              placeholder="Optionnel"
            />
          </div>
        </div>

        {state.status === 'success' && (
          <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900">
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>Facture complétée</AlertTitle>
            <AlertDescription>
              {state.result.libelle || 'Chorus Pro a accepté le complément.'}
              {state.result.dateTraitement ? ` Traitée le ${state.result.dateTraitement}.` : ''}
            </AlertDescription>
          </Alert>
        )}

        {state.status === 'error' && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertTitle>{state.result.human_message}</AlertTitle>
            <AlertDescription className="space-y-1">
              <p>{state.result.recommended_action}</p>
              {state.result.raw_message && state.result.raw_message !== state.result.human_message && (
                <p className="text-xs opacity-90">Détail technique : {state.result.raw_message}</p>
              )}
              {typeof state.result.code_retour === 'number' && (
                <p className="text-xs opacity-90">codeRetour Chorus : {state.result.code_retour}</p>
              )}
            </AlertDescription>
          </Alert>
        )}

        <div className="flex justify-end">
          <Button onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {state.status === 'loading'
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <Plus className="mr-2 h-4 w-4" />}
            Compléter la facture
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

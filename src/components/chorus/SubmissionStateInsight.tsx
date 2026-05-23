import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Info, Workflow } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getChorusRawStatusConfig } from '@/lib/status-utils';
import {
  CHORUS_BLOCKED_SUBMISSION_STATE,
  ChorusSubmissionStateEvaluation,
  evaluateChorusSubmissionState,
  formatAllowedStatesForHuman,
  getChorusStateHumanLabel,
} from '@/lib/chorus/submissionState';

interface SubmissionStateInsightProps {
  /** État brut retourné par Chorus (`statusChorus`). Peut être vide. */
  state: string | null | undefined;
  /** Erreur métier renvoyée par le backend (optionnelle). */
  backendErrorMessage?: string | null;
  /** Détails techniques bruts (motif Chorus, code retour, etc.). */
  technicalDetails?: Array<{ label: string; value: string | number | null | undefined }>;
}

export function SubmissionStateInsight({
  state,
  backendErrorMessage,
  technicalDetails,
}: SubmissionStateInsightProps) {
  const evaluation = evaluateChorusSubmissionState(state);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

  const visibleDetails = (technicalDetails ?? []).filter(
    (entry) => entry.value !== undefined && entry.value !== null && String(entry.value).trim() !== '',
  );

  return (
    <div className="space-y-4">
      <SubmissionStateStatusCard evaluation={evaluation} state={state} />

      {evaluation.kind !== 'allowed' && (
        <SubmissionStateBlockingCard
          evaluation={evaluation}
          backendErrorMessage={backendErrorMessage}
        />
      )}

      <SubmissionStateRecommendationsCard evaluation={evaluation} />

      {visibleDetails.length > 0 && (
        <div className="rounded-md border bg-muted/30">
          <button
            type="button"
            onClick={() => setShowTechnicalDetails((current) => !current)}
            className="flex w-full items-center justify-between px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
            aria-expanded={showTechnicalDetails}
          >
            <span className="flex items-center gap-2">
              <Workflow className="h-4 w-4" />
              Détails techniques
            </span>
            {showTechnicalDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {showTechnicalDetails && (
            <dl className="grid grid-cols-1 gap-2 border-t bg-background px-4 py-3 text-xs text-muted-foreground md:grid-cols-2">
              {visibleDetails.map((entry) => (
                <div key={entry.label} className="flex flex-col">
                  <dt className="font-medium text-foreground">{entry.label}</dt>
                  <dd className="break-words">{String(entry.value)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}

function SubmissionStateStatusCard({
  evaluation,
  state,
}: {
  evaluation: ChorusSubmissionStateEvaluation;
  state: string | null | undefined;
}) {
  const normalized = evaluation.currentState;
  const config = normalized ? getChorusRawStatusConfig(normalized) : null;
  const humanLabel = getChorusStateHumanLabel(state);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center text-base">
          <Info className="mr-2 h-4 w-4" />
          Statut de la demande
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center rounded px-2 py-1 text-sm font-medium ${config?.bgClass ?? 'bg-muted'} ${config?.textClass ?? 'text-muted-foreground'}`}
            data-testid="submission-state-badge"
          >
            <span
              className="mr-1.5 h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: config?.color ?? '#6b7280' }}
            />
            {humanLabel}
          </span>
          {normalized && humanLabel !== normalized && (
            <span className="font-mono text-xs text-muted-foreground">({normalized})</span>
          )}
        </div>
        <p className="text-muted-foreground">{evaluation.message}</p>
        <p className="text-xs text-muted-foreground">
          États autorisés pour la soumission : <span className="font-medium">{formatAllowedStatesForHuman()}</span>.
        </p>
      </CardContent>
    </Card>
  );
}

function SubmissionStateBlockingCard({
  evaluation,
  backendErrorMessage,
}: {
  evaluation: ChorusSubmissionStateEvaluation;
  backendErrorMessage?: string | null;
}) {
  const variant: 'destructive' | 'default' =
    evaluation.kind === 'rejected' ? 'destructive' : 'default';
  const Icon = evaluation.kind === 'rejected' ? AlertTriangle : Info;
  const title = evaluation.kind === 'rejected'
    ? 'Soumission bloquée'
    : evaluation.kind === 'missing'
      ? 'État inconnu côté Chorus'
      : 'État non compatible';

  return (
    <Alert variant={variant} data-testid="submission-state-block">
      <Icon className="h-4 w-4" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="space-y-2 text-sm">
        <p>{evaluation.message}</p>
        {evaluation.kind === 'rejected' && (
          <p className="text-xs">
            État courant Chorus : <span className="font-medium">{CHORUS_BLOCKED_SUBMISSION_STATE}</span>.
          </p>
        )}
        {backendErrorMessage && backendErrorMessage !== evaluation.message && (
          <p className="text-xs text-muted-foreground">
            Réponse backend : {backendErrorMessage}
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}

function SubmissionStateRecommendationsCard({
  evaluation,
}: {
  evaluation: ChorusSubmissionStateEvaluation;
}) {
  const Icon = evaluation.canSubmit ? CheckCircle2 : AlertTriangle;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center text-base">
          <Icon className="mr-2 h-4 w-4" />
          Action recommandée
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {evaluation.recommendedActions.map((action) => (
            <li key={action}>{action}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ChorusApiReturnSummary } from '@/lib/chorus/submissionApiReturn';

const TONE_CLASSES: Record<ChorusApiReturnSummary['tone'], string> = {
  success: 'border-success/30 bg-success/5',
  accepted: 'border-primary/30 bg-primary/5',
  warning: 'border-warning/30 bg-warning/5',
  error: 'border-destructive/30 bg-destructive/5',
  neutral: 'border-border bg-muted/20',
};

const BADGE_CLASSES: Record<ChorusApiReturnSummary['tone'], string> = {
  success: 'border-success/40 text-success',
  accepted: 'border-primary/40 text-primary',
  warning: 'border-warning/40 text-warning',
  error: 'border-destructive/40 text-destructive',
  neutral: 'border-border text-muted-foreground',
};

function SummaryField({ label, value }: { label: string; value?: string }) {
  if (!value) {
    return null;
  }

  return (
    <div className="rounded-lg border bg-background p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-sm font-medium">{value}</p>
    </div>
  );
}

export function ChorusApiReturnSummaryPanel({ summary }: { summary: ChorusApiReturnSummary }) {
  const resultLabel = summary.codeRetourDescription ?? summary.httpDescription;

  return (
    <div className={cn('rounded-lg border p-4', TONE_CLASSES[summary.tone])}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-medium">{resultLabel}</p>
          {summary.libelle && <p className="mt-1 text-xs text-muted-foreground">{summary.libelle}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {summary.httpStatus !== undefined && (
            <Badge variant="outline" className={BADGE_CLASSES[summary.tone]}>
              HTTP {summary.httpStatus}
            </Badge>
          )}
          {summary.codeRetour !== undefined && (
            <Badge variant="outline" className={BADGE_CLASSES[summary.tone]}>
              codeRetour {summary.codeRetour}
            </Badge>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <SummaryField label="Description HTTP" value={summary.httpDescription} />
        <SummaryField label="Statut facture" value={summary.statutFacture} />
        <SummaryField label="N° facture" value={summary.numeroFacture} />
        <SummaryField label="Identifiant facture CPP" value={summary.identifiantFactureCPP} />
        <SummaryField label="Identifiant structure" value={summary.identifiantStructure} />
        <SummaryField label="Date dépôt" value={summary.dateDepot} />
        <SummaryField label="Empreinte certificat" value={summary.empreinteCertificatDepot} />
      </div>
    </div>
  );
}

import { Link } from 'react-router-dom';
import { ArrowRight, FileStack, Layers, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { resolveFluxTechnicalStatus, FLUX_TONE_BADGE } from '@/lib/flux/fluxStatus';
import type { FluxTone } from '@/lib/flux/content';

export interface FluxSummaryAction {
  label: string;
  to: string;
  /** Met en avant l'action principale. */
  primary?: boolean;
}

export interface FluxSummaryCardProps {
  /** Identifiant du flux (uidFlux). */
  fluxId: string;
  /** Type de flux (ex. « Flux entrant », code interface…). */
  fluxType?: string;
  /** Format détecté (ex. UBL, CII, Factur-X). */
  format?: string;
  /** Date de dépôt (déjà formatée pour l'affichage). */
  depositDate?: string;
  /** Statut technique brut (résolu en libellé + tonalité). */
  technicalStatus?: string | null;
  /** Surcharge manuelle de la tonalité si besoin. */
  tone?: FluxTone;
  /** Nombre de factures contenues dans le flux. */
  invoiceCount?: number | null;
  /** Erreur principale à afficher (le cas échéant). */
  mainError?: string | null;
  /** Action recommandée (texte). */
  recommendedAction?: string | null;
  /** Boutons contextuels : « Voir détail », « Corriger », « Suivre »… */
  actions?: FluxSummaryAction[];
  icon?: LucideIcon;
  className?: string;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-[13px] font-medium text-foreground">{value ?? '—'}</dd>
    </div>
  );
}

/**
 * Fiche de résumé d'un flux, uniformisée.
 * Présentationnelle : les données viennent en props (depuis G2BDepositResult, un futur
 * historique de flux, etc.). Aucune logique réseau ici.
 */
export function FluxSummaryCard({
  fluxId,
  fluxType,
  format,
  depositDate,
  technicalStatus,
  tone,
  invoiceCount,
  mainError,
  recommendedAction,
  actions,
  icon: Icon = Layers,
  className,
}: FluxSummaryCardProps) {
  const resolved = resolveFluxTechnicalStatus(technicalStatus);
  const badgeTone = tone ?? resolved.tone;

  return (
    <div className={cn('rounded-xl border bg-card p-4 shadow-soft', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-[18px] w-[18px]" />
          </div>
          <div className="min-w-0">
            <p className="truncate font-mono text-[13px] font-semibold text-foreground" title={fluxId}>
              {fluxId}
            </p>
            <p className="truncate text-[11.5px] text-muted-foreground">{fluxType ?? 'Flux Chorus Pro'}</p>
          </div>
        </div>
        <span
          className={cn(
            'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset',
            FLUX_TONE_BADGE[badgeTone],
          )}
        >
          {resolved.label}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5 sm:grid-cols-3">
        <Field label="Format" value={format} />
        <Field label="Dépôt" value={depositDate} />
        <Field
          label="Factures"
          value={
            <span className="inline-flex items-center gap-1">
              <FileStack className="h-3.5 w-3.5 text-muted-foreground" />
              {invoiceCount ?? '—'}
            </span>
          }
        />
      </dl>

      {mainError && (
        <p className="mt-3 rounded-lg border border-destructive/20 bg-destructive-soft/50 px-3 py-2 text-[12px] leading-5 text-destructive">
          {mainError}
        </p>
      )}

      {recommendedAction && (
        <p className="mt-3 flex items-start gap-2 text-[12.5px] leading-5 text-foreground">
          <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span>{recommendedAction}</span>
        </p>
      )}

      {actions && actions.length > 0 && (
        <div className="mt-3.5 flex flex-wrap gap-2">
          {actions.map((action) => (
            <Link
              key={`${action.label}-${action.to}`}
              to={action.to}
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                action.primary
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'border bg-card text-foreground shadow-soft hover:border-primary/40 hover:bg-muted/50',
              )}
            >
              {action.label}
              <ArrowRight className="h-3 w-3" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

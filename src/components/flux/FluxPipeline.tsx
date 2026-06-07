import { Link } from 'react-router-dom';
import { ArrowRight, Check, Circle, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  FLUX_PIPELINE_STEPS,
  type FluxPipelineStep,
  type FluxStepStatus,
} from '@/lib/flux/content';

const STATUS_META: Record<
  FluxStepStatus,
  { label: string; node: string; chip: string; icon: typeof Check }
> = {
  idle: {
    label: 'Non commencé',
    node: 'border-border bg-card text-muted-foreground',
    chip: 'bg-muted text-muted-foreground ring-border',
    icon: Circle,
  },
  in_progress: {
    label: 'En cours',
    node: 'border-info/40 bg-info-soft text-info',
    chip: 'bg-info-soft text-info ring-info/20',
    icon: Loader2,
  },
  valid: {
    label: 'Valide',
    node: 'border-success/40 bg-success-soft text-success',
    chip: 'bg-success-soft text-success ring-success/20',
    icon: Check,
  },
  error: {
    label: 'Erreur',
    node: 'border-destructive/40 bg-destructive-soft text-destructive',
    chip: 'bg-destructive-soft text-destructive ring-destructive/20',
    icon: X,
  },
};

interface FluxPipelineProps {
  /** Étapes à afficher. Par défaut : pipeline de référence (10 étapes). */
  steps?: FluxPipelineStep[];
  className?: string;
}

/**
 * Pipeline de traitement du flux (stepper vertical).
 * Sur le hub, les étapes sont neutres (vue de référence pédagogique). Le composant
 * accepte un tableau d'étapes surchargé (avec statut) pour suivre un flux réel.
 */
export function FluxPipeline({ steps = FLUX_PIPELINE_STEPS, className }: FluxPipelineProps) {
  return (
    <ol className={cn('relative space-y-1', className)}>
      {steps.map((step, index) => {
        const status: FluxStepStatus = step.status ?? 'idle';
        const meta = STATUS_META[status];
        const StatusIcon = meta.icon;
        const isLast = index === steps.length - 1;
        return (
          <li key={step.id} className="relative flex gap-3.5 pb-1">
            {/* Ligne de liaison */}
            {!isLast && (
              <span
                aria-hidden
                className="absolute left-[17px] top-9 bottom-0 w-px bg-border"
              />
            )}
            {/* Nœud */}
            <div
              className={cn(
                'relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border shadow-soft',
                meta.node,
              )}
            >
              <step.icon className="h-4 w-4" />
            </div>
            {/* Contenu */}
            <div className="min-w-0 flex-1 rounded-lg border bg-card p-3 shadow-soft sm:flex sm:items-center sm:gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10.5px] font-semibold tabular-nums text-muted-foreground/70">
                    {String(step.id).padStart(2, '0')}
                  </span>
                  <span className="text-[13.5px] font-semibold text-foreground">{step.title}</span>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-medium ring-1 ring-inset',
                      meta.chip,
                    )}
                  >
                    <StatusIcon
                      className={cn('h-3 w-3', status === 'in_progress' && 'animate-spin')}
                    />
                    {meta.label}
                  </span>
                </div>
                <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">
                  {step.description}
                </p>
              </div>
              {step.action && (
                <Link
                  to={step.action.to}
                  className="mt-2 inline-flex shrink-0 items-center gap-1 rounded-md border bg-card px-2.5 py-1.5 text-[12px] font-medium text-foreground shadow-soft transition-colors hover:border-primary/40 hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:mt-0"
                >
                  {step.action.label}
                  <ArrowRight className="h-3 w-3" />
                </Link>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

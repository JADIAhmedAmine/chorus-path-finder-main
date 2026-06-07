import { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  Info,
  ListChecks,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { OfficialSourcesBox } from './OfficialSourcesBox';
import type { OfficialSource } from '@/lib/flux/officialSources';

export interface ProcessExplanationCardProps {
  /** Titre de la carte, ex. « Comment fonctionne le dépôt de flux ? ». */
  title: string;
  /** Explication courte, toujours visible. */
  shortDescription: string;
  /** Rattachement aux sources officielles (phrase de contexte). */
  officialContext?: string;
  /** Étapes du processus (liste ordonnée). */
  steps?: string[];
  /** Données requises pour réussir l'opération. */
  requiredData?: string[];
  /** Erreurs fréquentes à éviter. */
  commonErrors?: string[];
  /** Ce que l'utilisateur doit faire ensuite. */
  userNextAction?: string;
  /** Sources officielles (par défaut : PISTE + Chorus Pro / AIFE). */
  officialSources?: OfficialSource[];
  /** Icône d'en-tête. */
  icon?: LucideIcon;
  /** Replier le détail dans un volet (par défaut true). */
  collapsible?: boolean;
  /** Ouvrir le détail au montage (par défaut false). */
  defaultOpen?: boolean;
  className?: string;
}

function DetailList({
  label,
  items,
  icon: Icon,
  ordered = false,
  tone = 'default',
}: {
  label: string;
  items: string[];
  icon: LucideIcon;
  ordered?: boolean;
  tone?: 'default' | 'warning';
}) {
  const ListTag = ordered ? 'ol' : 'ul';
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className={cn('h-3.5 w-3.5', tone === 'warning' ? 'text-warning' : 'text-primary')} />
        {label}
      </p>
      <ListTag
        className={cn(
          'mt-2 space-y-1.5 text-[13px] leading-5 text-foreground',
          ordered ? 'list-inside list-decimal' : '',
        )}
      >
        {items.map((item, index) => (
          <li
            key={`${item}-${index}`}
            className={cn(!ordered && 'flex items-start gap-2')}
          >
            {!ordered && (
              <span
                className={cn(
                  'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                  tone === 'warning' ? 'bg-warning' : 'bg-primary/60',
                )}
                aria-hidden
              />
            )}
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ListTag>
    </div>
  );
}

/**
 * Carte d'explication de processus réutilisable.
 * Affiche en permanence le « quoi » (description + contexte officiel + prochaine action)
 * et replie le « comment » (étapes, données requises, erreurs fréquentes) pour ne pas
 * surcharger les pages. Toujours rattachée aux sources officielles via OfficialSourcesBox.
 */
export function ProcessExplanationCard({
  title,
  shortDescription,
  officialContext,
  steps,
  requiredData,
  commonErrors,
  userNextAction,
  officialSources,
  icon: Icon = Info,
  collapsible = true,
  defaultOpen = false,
  className,
}: ProcessExplanationCardProps) {
  const [open, setOpen] = useState(defaultOpen);

  const hasDetail =
    (steps?.length ?? 0) > 0
    || (requiredData?.length ?? 0) > 0
    || (commonErrors?.length ?? 0) > 0;

  const detail = (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {steps && steps.length > 0 && (
          <DetailList label="Étapes" items={steps} icon={ListChecks} ordered />
        )}
        {requiredData && requiredData.length > 0 && (
          <DetailList label="Données requises" items={requiredData} icon={ListChecks} />
        )}
        {commonErrors && commonErrors.length > 0 && (
          <DetailList label="Erreurs fréquentes" items={commonErrors} icon={AlertTriangle} tone="warning" />
        )}
      </div>
      <OfficialSourcesBox sources={officialSources} />
    </div>
  );

  return (
    <Card className={cn('border-primary/15 bg-card', className)}>
      <CardContent className="space-y-3 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-[18px] w-[18px]" />
          </div>
          <div className="min-w-0 space-y-1">
            <h3 className="text-[15px] font-semibold leading-snug text-foreground">{title}</h3>
            <p className="text-[13px] leading-6 text-muted-foreground">{shortDescription}</p>
          </div>
        </div>

        {officialContext && (
          <p className="rounded-lg border border-info/20 bg-info-soft/30 px-3 py-2 text-[12.5px] leading-5 text-muted-foreground">
            {officialContext}
          </p>
        )}

        {userNextAction && (
          <p className="flex items-start gap-2 text-[13px] font-medium text-foreground">
            <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>{userNextAction}</span>
          </p>
        )}

        {hasDetail && (
          collapsible ? (
            <Collapsible open={open} onOpenChange={setOpen}>
              <CollapsibleTrigger className="flex items-center gap-1.5 text-[12.5px] font-medium text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md">
                {open ? 'Masquer le détail' : 'Voir le détail'}
                <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-3">{detail}</CollapsibleContent>
            </Collapsible>
          ) : (
            <div className="pt-1">{detail}</div>
          )
        )}

        {!hasDetail && <OfficialSourcesBox sources={officialSources} />}
      </CardContent>
    </Card>
  );
}

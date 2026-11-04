import { BookMarked, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { OFFICIAL_SOURCES, type OfficialSource } from '@/lib/flux/officialSources';

interface OfficialSourcesBoxProps {
  /** Sources à afficher. Par défaut : PISTE + Chorus Pro / AIFE. */
  sources?: OfficialSource[];
  /** Note de prudence affichée sous les liens. */
  note?: string;
  className?: string;
}

/**
 * Encadré « Sources officielles » réutilisable.
 * Rappelle d'où viennent les explications et invite à vérifier les règles précises
 * dans la documentation officielle (PISTE / Chorus Pro · AIFE).
 */
export function OfficialSourcesBox({
  sources = OFFICIAL_SOURCES,
  note = "Les explications de cette interface sont pédagogiques. En cas de doute, la règle officielle prévaut : vérifiez le détail dans ces sources.",
  className,
}: OfficialSourcesBoxProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-info/25 bg-info-soft/40 p-4',
        className,
      )}
    >
      <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-info">
        <BookMarked className="h-3.5 w-3.5" />
        Sources officielles
      </div>
      <ul className="mt-2.5 space-y-2">
        {sources.map((source) => (
          <li key={source.url}>
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer noopener"
              className="group flex items-start gap-2 rounded-lg p-1.5 -m-1.5 transition-colors hover:bg-info/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/40"
            >
              <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-foreground underline-offset-2 group-hover:underline">
                  {source.label}
                </span>
                <span className="block text-[12px] leading-5 text-muted-foreground">
                  {source.description}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
      {note && (
        <p className="mt-2.5 text-[11.5px] leading-5 text-muted-foreground">{note}</p>
      )}
    </div>
  );
}

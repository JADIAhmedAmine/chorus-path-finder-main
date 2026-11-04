import { useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, Copy, ExternalLink, Lightbulb, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type Severity = 'error' | 'warning' | 'info';

interface ApiErrorCardProps {
  severity?: Severity;
  title: string;
  explanation?: ReactNode;
  suggestion?: ReactNode;
  technicalCode?: string;
  technicalDetails?: unknown;
  docHref?: string;
  onRetry?: () => void;
  retryLabel?: string;
  actions?: ReactNode;
  className?: string;
}

const SEV_STYLES: Record<Severity, { ring: string; bg: string; iconBg: string; iconColor: string }> = {
  error: {
    ring: 'ring-destructive/20',
    bg: 'bg-destructive-soft/40',
    iconBg: 'bg-destructive/10',
    iconColor: 'text-destructive',
  },
  warning: {
    ring: 'ring-warning/20',
    bg: 'bg-warning-soft/40',
    iconBg: 'bg-warning/10',
    iconColor: 'text-warning',
  },
  info: {
    ring: 'ring-info/20',
    bg: 'bg-info-soft/40',
    iconBg: 'bg-info/10',
    iconColor: 'text-info',
  },
};

function formatTechnical(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function ApiErrorCard({
  severity = 'error',
  title,
  explanation,
  suggestion,
  technicalCode,
  technicalDetails,
  docHref,
  onRetry,
  retryLabel = 'Réessayer',
  actions,
  className,
}: ApiErrorCardProps) {
  const [open, setOpen] = useState(false);
  const styles = SEV_STYLES[severity];
  const technicalText = formatTechnical(technicalDetails);

  const copyTechnical = async () => {
    const payload = [technicalCode, technicalText].filter(Boolean).join('\n');
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(payload);
      toast.success('Détails techniques copiés');
    } catch {
      toast.error('Impossible de copier');
    }
  };

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border bg-card p-5 shadow-soft ring-1 ring-inset',
        styles.ring,
        className,
      )}
    >
      <div className={cn('pointer-events-none absolute inset-0 -z-10', styles.bg)} />
      <div className="flex items-start gap-4">
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', styles.iconBg)}>
          <AlertTriangle className={cn('h-5 w-5', styles.iconColor)} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold text-foreground">{title}</h3>
          {explanation && (
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{explanation}</p>
          )}

          {suggestion && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border bg-card/70 p-3 text-sm">
              <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div className="leading-6 text-foreground">{suggestion}</div>
            </div>
          )}

          {(onRetry || actions || docHref) && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {actions}
              {onRetry && (
                <Button size="sm" variant="default" onClick={onRetry}>
                  <RotateCw className="mr-1.5 h-3.5 w-3.5" />
                  {retryLabel}
                </Button>
              )}
              {docHref && (
                <Button size="sm" variant="outline" asChild>
                  <a href={docHref} target="_blank" rel="noreferrer">
                    Documentation
                    <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                  </a>
                </Button>
              )}
            </div>
          )}

          {(technicalCode || technicalText) && (
            <div className="mt-4 border-t border-border/70 pt-3">
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronDown
                  className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')}
                />
                Détails techniques
                {technicalCode && (
                  <span className="ml-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10.5px] text-foreground">
                    {technicalCode}
                  </span>
                )}
              </button>
              {open && technicalText && (
                <div className="mt-2 overflow-hidden rounded-lg border bg-muted/40">
                  <div className="flex items-center justify-between border-b bg-card/50 px-3 py-1.5">
                    <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      Réponse API
                    </span>
                    <button
                      type="button"
                      onClick={copyTechnical}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <Copy className="h-3 w-3" />
                      Copier
                    </button>
                  </div>
                  <pre className="max-h-72 overflow-auto px-3 py-2.5 font-mono text-[11.5px] leading-5 text-foreground/85">
                    {technicalText}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

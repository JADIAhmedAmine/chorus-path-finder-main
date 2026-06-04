import { AlertCircle, CheckCircle2, Info, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { getInvoiceGuide } from '@/lib/chorus/invoiceStatusGuide';
import type { InvoiceDisplayModel } from '@/lib/chorus/invoiceDisplay';

const severityStyle = {
  info: {
    icon: Info,
    className: 'border-info/25 bg-info/5 text-info',
  },
  warning: {
    icon: TriangleAlert,
    className: 'border-warning/30 bg-warning/10 text-warning',
  },
  error: {
    icon: AlertCircle,
    className: 'border-destructive/25 bg-destructive/10 text-destructive',
  },
  success: {
    icon: CheckCircle2,
    className: 'border-success/25 bg-success/10 text-success',
  },
} as const;

export function InvoiceActionGuide({ invoice }: { invoice: InvoiceDisplayModel }) {
  const guide = getInvoiceGuide(invoice);
  const style = severityStyle[guide.severity];
  const Icon = style.icon;

  return (
    <section className={cn('rounded-lg border p-4', style.className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Icon className="h-4 w-4" />
            Que signifie ce statut ?
          </div>
          <p className="mt-1 text-sm text-foreground">{guide.description}</p>
          <p className="mt-2 text-xs text-muted-foreground">{guide.contextDescription}</p>
        </div>
        <Badge variant="outline" className="bg-background/60">
          {guide.contextLabel} · {guide.statusLabel}
        </Badge>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Ce que vous pouvez faire
          </p>
          <ul className="mt-2 space-y-1.5 text-sm text-foreground">
            {guide.actions.map((action) => (
              <li key={`${action.label}-${action.availability}`} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-60" />
                <span>
                  {action.label}
                  {action.availability !== 'available' && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      ({action.availability === 'planned' ? 'prévu' : 'non disponible actuellement'})
                    </span>
                  )}
                  {action.note && <span className="block text-xs text-muted-foreground">{action.note}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Ce qui est attendu
          </p>
          <p className="mt-2 text-sm text-foreground">{guide.recommendedAction}</p>
        </div>
      </div>
    </section>
  );
}

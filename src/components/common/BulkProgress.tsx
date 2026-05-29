import { Loader2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

interface BulkProgressProps {
  /** Nombre d'éléments effectivement traités (succès + erreurs). */
  processed: number;
  /** Nombre total demandé. */
  total: number;
  label?: string;
  className?: string;
}

export function BulkProgress({ processed, total, label, className }: BulkProgressProps) {
  const safeTotal = Math.max(total, 1);
  const ratio = Math.min(Math.max(processed / safeTotal, 0), 1) * 100;
  const isDone = total > 0 && processed >= total;

  return (
    <div
      className={cn(
        'rounded-md border bg-card p-3 animate-fade-in-up',
        isDone ? 'border-success/30 bg-success/5' : 'border-border',
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-2 font-medium">
          {!isDone && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {label ?? 'Consultation des factures'}
        </span>
        <span className="font-mono tabular-nums text-muted-foreground">
          {processed} / {total}
        </span>
      </div>
      <Progress value={ratio} className="mt-2 h-1.5" />
    </div>
  );
}

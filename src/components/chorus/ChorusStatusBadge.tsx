import { cn } from '@/lib/utils';
import { getChorusRawStatusConfig } from '@/lib/status-utils';

const CRITICAL_STATUSES = new Set<string>(['REJETEE', 'SUSPENDUE', 'A_RECYCLER']);
const PAID_STATUSES = new Set<string>(['MISE_EN_PAIEMENT', 'COMPTABILISEE', 'MANDATEE']);

interface ChorusStatusBadgeProps {
  value?: string | null;
  size?: 'sm' | 'md';
  className?: string;
}

export function ChorusStatusBadge({ value, size = 'sm', className }: ChorusStatusBadgeProps) {
  if (!value || !value.trim()) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const normalized = value.trim().toUpperCase();
  const config = getChorusRawStatusConfig(value);
  const isCritical = CRITICAL_STATUSES.has(normalized);
  const isPaid = PAID_STATUSES.has(normalized);

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-medium leading-none max-w-full',
        size === 'sm' ? 'gap-1.5 px-2 py-0.5 text-[11px]' : 'gap-2 px-2.5 py-1 text-xs',
        config.bgClass,
        config.textClass,
        isPaid && 'border-success/30',
        normalized === 'REJETEE' && 'border-destructive/40 pulse-critical',
        !isCritical && !isPaid && 'border-border/40',
        className,
      )}
      data-status={normalized}
      title={config.label}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: config.color }}
        aria-hidden="true"
      />
      <span className="truncate">{config.label}</span>
    </span>
  );
}

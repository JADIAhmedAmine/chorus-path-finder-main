import type { InvoiceStatusInternal } from '@/types';
import { getStatusConfig } from '@/lib/status-utils';
import { cn } from '@/lib/utils';

interface StatusBadgeProps {
  status: InvoiceStatusInternal | string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = getStatusConfig(status as InvoiceStatusInternal);
  return (
    <span className={cn('status-badge', config.bgClass, config.textClass, className)}>
      <span className="mr-1.5 h-1.5 w-1.5 rounded-full" style={{ backgroundColor: config.color }} />
      {config.label}
    </span>
  );
}

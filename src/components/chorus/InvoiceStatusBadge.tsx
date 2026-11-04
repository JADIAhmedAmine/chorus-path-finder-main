import { cn } from '@/lib/utils';
import { getChorusRawStatusConfig } from '@/lib/status-utils';

export function InvoiceStatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const config = getChorusRawStatusConfig(status);
  return (
    <span
      className={cn(
        'inline-flex max-w-[240px] items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ring-current/10',
        config.bgClass,
        config.textClass,
        className,
      )}
    >
      <span className="mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: config.color }} />
      <span className="truncate">{config.label}</span>
    </span>
  );
}

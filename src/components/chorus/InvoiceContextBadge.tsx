import { Inbox, SendHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { InvoiceBusinessContext } from '@/lib/chorus/invoiceStatusGuide';

export function InvoiceContextBadge({
  context,
  className,
}: {
  context: InvoiceBusinessContext;
  className?: string;
}) {
  const isReception = context === 'reception';
  const Icon = isReception ? Inbox : SendHorizontal;
  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
        isReception
          ? 'border-sky-200 bg-sky-50 text-sky-700'
          : 'border-indigo-200 bg-indigo-50 text-indigo-700',
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {isReception ? 'Réception' : 'Émission'}
    </Badge>
  );
}

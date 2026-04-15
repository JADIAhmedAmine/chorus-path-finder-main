import type { InvoiceStatusHistory } from '@/types';
import { getStatusConfig, formatDateTime } from '@/lib/status-utils';
import { cn } from '@/lib/utils';

interface StatusTimelineProps {
  events: InvoiceStatusHistory[];
}

const sourceLabels: Record<string, string> = {
  SYSTEM: 'Système',
  USER: 'Utilisateur',
  CHORUS: 'Chorus Pro',
};

export function StatusTimeline({ events }: StatusTimelineProps) {
  const sorted = [...events].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

  return (
    <div className="space-y-0">
      {sorted.map((event, index) => {
        const config = getStatusConfig(event.newStatus as any);
        const isLast = index === sorted.length - 1;
        return (
          <div key={event.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className="h-3 w-3 rounded-full border-2 mt-1.5" style={{ borderColor: config.color, backgroundColor: index === 0 ? config.color : 'transparent' }} />
              {!isLast && <div className="w-px flex-1 bg-border min-h-[2rem]" />}
            </div>
            <div className={cn("pb-4", index === 0 && "font-medium")}>
              <div className="flex items-center gap-2">
                <span className="text-sm">{event.eventLabel}</span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{sourceLabels[event.source] || event.source}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">{formatDateTime(event.occurredAt)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

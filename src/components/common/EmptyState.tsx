import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  variant?: 'subtle' | 'card';
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
  variant = 'subtle',
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-12 text-center animate-fade-in-up',
        variant === 'subtle'
          ? 'rounded-xl border border-dashed bg-dotted'
          : 'rounded-xl border bg-card shadow-soft',
        className,
      )}
    >
      <div className="relative animate-scale-in">
        <div className="absolute inset-0 -m-2 rounded-full bg-primary/5 blur-xl" aria-hidden />
        <div className="relative flex h-12 w-12 items-center justify-center rounded-full border bg-card shadow-soft">
          <Icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        </div>
      </div>
      <h3 className="text-[15px] font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="max-w-md text-[13px] leading-6 text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

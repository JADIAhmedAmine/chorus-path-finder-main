import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  meta,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        'flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between',
        className,
      )}
    >
      <div className="min-w-0 max-w-3xl space-y-1.5">
        {eyebrow && (
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {eyebrow}
          </div>
        )}
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-foreground">
          {title}
        </h1>
        {description && (
          <p className="text-sm leading-6 text-muted-foreground">{description}</p>
        )}
        {meta && <div className="pt-1 text-xs text-muted-foreground">{meta}</div>}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 lg:shrink-0">{actions}</div>
      )}
    </header>
  );
}

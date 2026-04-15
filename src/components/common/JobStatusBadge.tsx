import type { JobStatus } from '@/types';
import { getJobStatusConfig } from '@/lib/status-utils';
import { cn } from '@/lib/utils';

interface JobStatusBadgeProps {
  status: JobStatus;
  className?: string;
}

export function JobStatusBadge({ status, className }: JobStatusBadgeProps) {
  const config = getJobStatusConfig(status);
  return (
    <span className={cn('status-badge', config.bgClass, config.textClass, className)}>
      <span className="mr-1.5 h-1.5 w-1.5 rounded-full" style={{ backgroundColor: config.color }} />
      {config.label}
    </span>
  );
}

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface SkeletonKpiGridProps {
  count?: number;
  className?: string;
}

export function SkeletonKpiGrid({ count = 4, className }: SkeletonKpiGridProps) {
  return (
    <div
      className={cn(
        'grid gap-3 sm:grid-cols-2 xl:grid-cols-4 stagger-children',
        className,
      )}
    >
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="rounded-md border p-3"
          style={{ animationDelay: `${index * 60}ms` }}
        >
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-7 w-16" />
        </div>
      ))}
    </div>
  );
}

interface SkeletonTableProps {
  rows?: number;
  columns?: number;
  className?: string;
}

export function SkeletonTable({ rows = 5, columns = 7, className }: SkeletonTableProps) {
  return (
    <div className={cn('overflow-hidden rounded-md border', className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/30 text-left">
            {Array.from({ length: columns }).map((_, index) => (
              <th key={index} className="p-3">
                <Skeleton className="h-3 w-20" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <tr
              key={rowIndex}
              className="border-b last:border-0 animate-fade-in-up"
              style={{ animationDelay: `${rowIndex * 50}ms` }}
            >
              {Array.from({ length: columns }).map((_, colIndex) => (
                <td key={colIndex} className="p-3">
                  <Skeleton className={cn('h-3', colIndex === 0 ? 'w-12' : 'w-24')} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

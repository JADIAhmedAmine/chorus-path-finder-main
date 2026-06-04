import { Link } from 'react-router-dom';
import type { ComponentType, ReactNode } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus, type LucideIcon } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { cn } from '@/lib/utils';

type Tone = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

interface KpiCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon | ComponentType<{ className?: string }>;
  tone?: Tone;
  trend?: {
    value: number;
    direction?: 'up' | 'down' | 'flat';
    label?: string;
  };
  sparkline?: number[];
  href?: string;
  loading?: boolean;
  className?: string;
  animationDelayMs?: number;
}

const TONE_STYLES: Record<Tone, { icon: string; iconBg: string; spark: string; accent: string }> = {
  default: {
    icon: 'text-foreground',
    iconBg: 'bg-muted text-muted-foreground',
    spark: 'hsl(var(--muted-foreground))',
    accent: 'from-foreground/0 via-foreground/0 to-foreground/0',
  },
  primary: {
    icon: 'text-primary',
    iconBg: 'bg-primary/10 text-primary',
    spark: 'hsl(var(--primary))',
    accent: 'from-primary/[0.06] via-primary/0 to-primary/0',
  },
  success: {
    icon: 'text-success',
    iconBg: 'bg-success-soft text-success',
    spark: 'hsl(var(--success))',
    accent: 'from-success/[0.06] via-success/0 to-success/0',
  },
  warning: {
    icon: 'text-warning',
    iconBg: 'bg-warning-soft text-warning',
    spark: 'hsl(var(--warning))',
    accent: 'from-warning/[0.07] via-warning/0 to-warning/0',
  },
  danger: {
    icon: 'text-destructive',
    iconBg: 'bg-destructive-soft text-destructive',
    spark: 'hsl(var(--destructive))',
    accent: 'from-destructive/[0.06] via-destructive/0 to-destructive/0',
  },
  info: {
    icon: 'text-info',
    iconBg: 'bg-info-soft text-info',
    spark: 'hsl(var(--info))',
    accent: 'from-info/[0.06] via-info/0 to-info/0',
  },
};

function TrendChip({ trend }: { trend: NonNullable<KpiCardProps['trend']> }) {
  const direction = trend.direction
    ?? (trend.value > 0 ? 'up' : trend.value < 0 ? 'down' : 'flat');
  const Icon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : Minus;
  const tone =
    direction === 'up'
      ? 'bg-success-soft text-success ring-success/20'
      : direction === 'down'
      ? 'bg-destructive-soft text-destructive ring-destructive/20'
      : 'bg-muted text-muted-foreground ring-border';
  const formatted = `${trend.value > 0 ? '+' : ''}${trend.value.toFixed(trend.value % 1 === 0 ? 0 : 1)}%`;
  return (
    <span className={cn('inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset', tone)}>
      <Icon className="h-3 w-3" />
      {formatted}
    </span>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length === 0) return null;
  const id = `spark-${Math.random().toString(36).slice(2, 9)}`;
  const points = data.map((v, i) => ({ i, v }));
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 opacity-90">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, bottom: 0, left: 0, right: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.32} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.75}
            fill={`url(#${id})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default',
  trend,
  sparkline,
  href,
  loading,
  className,
  animationDelayMs,
}: KpiCardProps) {
  const styles = TONE_STYLES[tone];
  const isInteractive = Boolean(href);
  const cardClassName = cn(
    'group relative isolate overflow-hidden rounded-xl border bg-card p-5 shadow-soft',
    'transition-all duration-200 ease-out',
    isInteractive && 'hover:-translate-y-px hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    'animate-fade-in-up',
    className,
  );
  const cardStyle = animationDelayMs ? { animationDelay: `${animationDelayMs}ms` } : undefined;
  const content = (
    <>
      <div className={cn('pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b', styles.accent)} />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <p className="mt-2 flex items-baseline gap-2 text-[28px] font-semibold leading-none tracking-tight tabular-nums">
            {loading ? (
              <span className="inline-block h-7 w-20 animate-pulse rounded bg-muted" />
            ) : (
              value
            )}
          </p>
          {(hint || trend) && (
            <div className="mt-2 flex items-center gap-2 text-[12px] text-muted-foreground">
              {trend && <TrendChip trend={trend} />}
              {hint && <span className="truncate">{hint}</span>}
            </div>
          )}
        </div>
        {Icon && (
          <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', styles.iconBg)}>
            <Icon className={cn('h-[18px] w-[18px]')} />
          </div>
        )}
      </div>
      {sparkline && sparkline.length > 1 && (
        <Sparkline data={sparkline} color={styles.spark} />
      )}
      {isInteractive && (
        <span className="absolute bottom-3 right-4 inline-flex items-center text-[11px] font-medium text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
          Ouvrir <ArrowRight className="ml-1 h-3 w-3" />
        </span>
      )}
    </>
  );

  if (href) {
    return (
      <Link to={href} className={cardClassName} style={cardStyle}>
        {content}
      </Link>
    );
  }

  return (
    <div className={cardClassName} style={cardStyle}>
      {content}
    </div>
  );
}

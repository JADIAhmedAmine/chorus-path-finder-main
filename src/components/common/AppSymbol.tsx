import { cn } from '@/lib/utils';
import { getAppLogoUrl, getAppName } from '@/lib/branding';

export { getAppName, getAppTagline } from '@/lib/branding';

interface AppSymbolProps {
  className?: string;
  imgClassName?: string;
}

export function AppSymbol({ className, imgClassName }: AppSymbolProps) {
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center overflow-hidden', className)}>
      <img
        src={getAppLogoUrl()}
        alt={`Symbole ${getAppName()}`}
        className={cn('h-full w-full object-contain', imgClassName)}
      />
    </span>
  );
}

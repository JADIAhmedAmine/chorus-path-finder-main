import { cn } from '@/lib/utils';

export const APP_SYMBOL_PATH = '/app-symbol.svg';
export const APP_NAME = 'Chorus Pilot';
export const APP_TAGLINE = 'Automatisation des factures Chorus Pro';

interface AppSymbolProps {
  className?: string;
  imgClassName?: string;
}

export function AppSymbol({ className, imgClassName }: AppSymbolProps) {
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center overflow-hidden', className)}>
      <img
        src={APP_SYMBOL_PATH}
        alt={`Symbole ${APP_NAME}`}
        className={cn('h-full w-full object-contain', imgClassName)}
      />
    </span>
  );
}

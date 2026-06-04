import { useEffect, useRef, useState } from 'react';
import {
  Download,
  FileArchive,
  FileCode2,
  FileText,
  Loader2,
  Paperclip,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { ChorusBackendAutomationClient } from '@/lib/chorus/backendAutomation';
import { loadChorusConfig, resolveChorusRuntimeConfig } from '@/lib/chorus/storage';
import { resolveChorusInvoiceId, triggerBrowserDownload, type ChorusInvoiceDownloadTarget } from '@/lib/chorus/invoiceDownload';
import type { ReceptionDownloadFormat } from '@/types/chorus';
import type { Invoice } from '@/types';
import type { InvoiceDisplayModel } from '@/lib/chorus/invoiceDisplay';
import { cn } from '@/lib/utils';

interface InvoiceDownloadMenuProps {
  invoice: Invoice | InvoiceDisplayModel | ChorusInvoiceDownloadTarget;
  /** Compact icon-only trigger (for dense tables). Default false. */
  compact?: boolean;
  /** Button label when not compact. Default "PJ / Télécharger". */
  label?: string;
  className?: string;
  size?: 'sm' | 'default';
  variant?: 'outline' | 'ghost' | 'secondary' | 'default';
}

interface FormatOption {
  format: ReceptionDownloadFormat;
  label: string;
  description: string;
  icon: typeof FileText;
  withPj?: boolean;
  preview?: boolean;
}

type PdfPreviewState =
  | { status: 'idle' }
  | { status: 'loading'; id: number }
  | { status: 'ready'; id: number; url: string; filename: string }
  | { status: 'error'; id: number; message: string };

const FORMAT_OPTIONS: FormatOption[] = [
  {
    format: 'PDF',
    label: 'Aperçu PDF',
    description: 'Ouvre la facture dans un nouvel onglet.',
    icon: FileText,
    preview: true,
  },
  {
    format: 'PDF',
    label: 'Télécharger PDF',
    description: 'Enregistre la facture en PDF.',
    icon: Download,
  },
  {
    format: 'XML',
    label: 'Télécharger XML',
    description: 'Source structurée (UBL / CII / Factur-X).',
    icon: FileCode2,
  },
  {
    format: 'ZIP',
    label: 'ZIP avec pièces jointes',
    description: 'Facture + toutes les PJ complémentaires.',
    icon: FileArchive,
    withPj: true,
  },
];

export function InvoiceDownloadMenu({
  invoice,
  compact = false,
  label = 'PJ / Télécharger',
  className,
  size = 'sm',
  variant = 'outline',
}: InvoiceDownloadMenuProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [pdfPreview, setPdfPreview] = useState<PdfPreviewState>({ status: 'idle' });
  const previewUrlRef = useRef<string | null>(null);
  const previewLoadRef = useRef(0);
  const chorusId = resolveChorusInvoiceId(invoice);
  const disabled = chorusId === null;

  useEffect(() => () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }, []);

  const ensurePdfPreview = async () => {
    if (chorusId === null) return;
    if (pdfPreview.status === 'ready' && pdfPreview.id === chorusId) return;
    if (pdfPreview.status === 'loading' && pdfPreview.id === chorusId) return;

    const loadId = previewLoadRef.current + 1;
    previewLoadRef.current = loadId;
    setPdfPreview({ status: 'loading', id: chorusId });

    try {
      const config = resolveChorusRuntimeConfig(loadChorusConfig());
      const client = new ChorusBackendAutomationClient(config);
      const result = await client.downloadInvoice({
        idFacture: chorusId,
        format: 'PDF',
      });

      if (previewLoadRef.current !== loadId) return;

      if (!result.ok) {
        setPdfPreview({
          status: 'error',
          id: chorusId,
          message: result.human_message || 'Miniature PDF indisponible.',
        });
        return;
      }

      const objectUrl = URL.createObjectURL(result.blob);
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
      previewUrlRef.current = objectUrl;
      setPdfPreview({
        status: 'ready',
        id: chorusId,
        url: objectUrl,
        filename: result.filename,
      });
    } catch (error) {
      if (previewLoadRef.current !== loadId) return;
      setPdfPreview({
        status: 'error',
        id: chorusId,
        message: error instanceof Error ? error.message : 'Miniature PDF indisponible.',
      });
    }
  };

  const handleSelect = async (option: FormatOption) => {
    if (chorusId === null) return;
    const key = `${option.format}-${option.preview ? 'preview' : option.withPj ? 'pj' : 'dl'}`;
    const previewWindow = option.preview ? window.open('about:blank', '_blank') : null;
    if (previewWindow) previewWindow.opener = null;

    setBusy(key);
    const toastId = toast.loading(
      option.preview ? 'Ouverture du PDF…' : `Préparation du ${option.format}…`,
    );

    try {
      const config = resolveChorusRuntimeConfig(loadChorusConfig());
      const client = new ChorusBackendAutomationClient(config);
      const result = await client.downloadInvoice({
        idFacture: chorusId,
        format: option.format,
        avecPiecesJointesComplementaires: option.withPj ? true : undefined,
      });

      if (!result.ok) {
        previewWindow?.close();
        toast.error(result.human_message || 'Téléchargement impossible.', { id: toastId });
        return;
      }

      const objectUrl = URL.createObjectURL(result.blob);
      if (option.preview && previewWindow) {
        previewWindow.location.href = objectUrl;
        toast.success('PDF ouvert dans un nouvel onglet.', { id: toastId });
      } else {
        triggerBrowserDownload(objectUrl, result.filename);
        toast.success(`${result.filename} téléchargé.`, { id: toastId });
      }
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    } catch (error) {
      previewWindow?.close();
      const message = error instanceof Error ? error.message : 'Erreur réseau pendant le téléchargement.';
      toast.error(message, { id: toastId });
    } finally {
      setBusy(null);
    }
  };

  const trigger = compact ? (
    <Button
      variant={variant}
      size="icon"
      disabled={disabled || busy !== null}
      className={cn('h-8 w-8', className)}
      aria-label={disabled ? 'Téléchargement indisponible' : label}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
    </Button>
  ) : (
    <Button
      variant={variant}
      size={size}
      disabled={disabled || busy !== null}
      className={cn('h-8 gap-1.5 px-2.5', className)}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
      {label}
    </Button>
  );

  const wrappedTrigger = disabled ? (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild><span tabIndex={0}>{trigger}</span></TooltipTrigger>
        <TooltipContent side="top" className="max-w-[220px] text-[12px]">
          Téléchargement indisponible : aucun identifiant Chorus n’est encore attaché à cette facture (sync requise).
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : trigger;

  if (disabled) {
    return wrappedTrigger;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex flex-col gap-0.5 py-2">
          <span className="text-[13px] font-semibold">Télécharger la facture</span>
          <span className="text-[11px] font-normal text-muted-foreground">
            Source Chorus Pro · id {chorusId}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {FORMAT_OPTIONS.map((option) => {
          const key = `${option.format}-${option.preview ? 'preview' : option.withPj ? 'pj' : 'dl'}`;
          const item = (
            <DropdownMenuItem
              key={key}
              onSelect={(event) => {
                event.preventDefault();
                void handleSelect(option);
              }}
              className="flex items-start gap-2.5 py-2"
            >
              <option.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-medium leading-tight">{option.label}</p>
                <p className="text-[11px] leading-snug text-muted-foreground">{option.description}</p>
              </div>
              {option.withPj && (
                <span className="ml-1 inline-flex shrink-0 items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-primary">
                  + PJ
                </span>
              )}
            </DropdownMenuItem>
          );

          if (!option.preview) {
            return item;
          }

          return (
            <HoverCard
              key={key}
              openDelay={300}
              closeDelay={100}
              onOpenChange={(open) => {
                if (open) void ensurePdfPreview();
              }}
            >
              <HoverCardTrigger asChild>{item}</HoverCardTrigger>
              <HoverCardContent side="left" align="start" className="w-[320px] p-2">
                <PdfHoverPreview state={pdfPreview} />
              </HoverCardContent>
            </HoverCard>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PdfHoverPreview({ state }: { state: PdfPreviewState }) {
  if (state.status === 'loading') {
    return (
      <div className="flex h-[390px] items-center justify-center rounded-md border bg-muted/20 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Chargement du PDF...
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="flex h-[180px] flex-col items-center justify-center rounded-md border bg-muted/20 p-4 text-center text-sm">
        <FileText className="mb-2 h-6 w-6 text-muted-foreground" />
        <p className="font-medium">Miniature indisponible</p>
        <p className="mt-1 text-xs text-muted-foreground">{state.message}</p>
      </div>
    );
  }

  if (state.status !== 'ready') {
    return (
      <div className="flex h-[180px] items-center justify-center rounded-md border bg-muted/20 text-sm text-muted-foreground">
        Survoler pour charger la miniature.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-md border bg-muted/20">
        <object
          data={`${state.url}#page=1&toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
          type="application/pdf"
          className="h-[390px] w-full"
          aria-label={`Miniature PDF ${state.filename}`}
        >
          <div className="flex h-[390px] items-center justify-center p-4 text-center text-sm text-muted-foreground">
            Aperçu PDF non pris en charge par ce navigateur.
          </div>
        </object>
      </div>
      <p className="truncate text-[11px] text-muted-foreground" title={state.filename}>
        {state.filename}
      </p>
    </div>
  );
}

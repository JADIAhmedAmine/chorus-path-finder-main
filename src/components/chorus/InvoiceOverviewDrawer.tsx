import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { InvoiceActionGuide } from '@/components/chorus/InvoiceActionGuide';
import { InvoiceContextBadge } from '@/components/chorus/InvoiceContextBadge';
import { InvoiceDownloadMenu } from '@/components/chorus/InvoiceDownloadMenu';
import { InvoiceStatusBadge } from '@/components/chorus/InvoiceStatusBadge';
import type { InvoiceDisplayModel } from '@/lib/chorus/invoiceDisplay';

interface InvoiceOverviewDrawerProps {
  invoice: InvoiceDisplayModel | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: currency || 'EUR',
  }).format(Number.isFinite(amount) ? amount : 0);
}

function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: value.includes('T') ? '2-digit' : undefined,
    minute: value.includes('T') ? '2-digit' : undefined,
  }).format(date);
}

function DetailItem({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="min-w-0 rounded-md border bg-muted/20 p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-foreground" title={String(value ?? '')}>
        {value ?? '—'}
      </p>
    </div>
  );
}

export function InvoiceOverviewDrawer({ invoice, open, onOpenChange }: InvoiceOverviewDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl xl:max-w-3xl">
        <SheetHeader className="space-y-2 pb-4">
          <div className="flex flex-wrap items-center gap-2">
            {invoice && <InvoiceContextBadge context={invoice.context} />}
            {invoice && <InvoiceStatusBadge status={invoice.status} />}
          </div>
          <SheetTitle className="text-base">
            {invoice ? invoice.number : 'Détail facture'}
          </SheetTitle>
          <SheetDescription className="text-xs">
            Aperçu dynamique harmonisé avec les informations Chorus disponibles.
          </SheetDescription>
        </SheetHeader>

        {invoice && (
          <div className="space-y-5">
            <div className="grid gap-3 md:grid-cols-2">
              <DetailItem label="Numéro de facture" value={invoice.number} />
              <DetailItem label="Type" value={invoice.context === 'reception' ? 'Réception' : 'Émission'} />
              <DetailItem label="Statut métier" value={invoice.statusLabel} />
              <DetailItem label="Fournisseur" value={invoice.supplierName} />
              <DetailItem label="Destinataire" value={invoice.recipientName} />
              <DetailItem label="Montant TTC" value={formatAmount(invoice.amountTtc, invoice.currency)} />
              <DetailItem label="Devise" value={invoice.currency} />
              <DetailItem label={invoice.dateLabel} value={formatDate(invoice.date)} />
              <DetailItem label="Identifiant Chorus / CPP" value={invoice.chorusId} />
              <DetailItem label="Source" value={invoice.source} />
              <DetailItem label="Dernière mise à jour" value={formatDate(invoice.lastUpdated)} />
              <DetailItem label="Référence interne" value={invoice.id} />
            </div>

            {invoice.reason && (
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Motif / retour Chorus
                </p>
                <p className="mt-1 text-sm text-foreground">{invoice.reason}</p>
              </div>
            )}

            <InvoiceActionGuide invoice={invoice} />

            <Separator />

            <div className="flex flex-wrap justify-end gap-2">
              <InvoiceDownloadMenu invoice={invoice} label="Télécharger" />
              {invoice.detailHref && (
                <Button variant="outline" size="sm" asChild>
                  <Link to={invoice.detailHref}>
                    <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                    Ouvrir la fiche complète
                  </Link>
                </Button>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

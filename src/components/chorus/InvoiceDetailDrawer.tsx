import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { ReceptionInvoice } from '@/types/chorus';
import { InvoiceDetailPanel } from '@/pages/ReceptionProcessing';

interface InvoiceDetailDrawerProps {
  invoice: ReceptionInvoice | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InvoiceDetailDrawer({ invoice, open, onOpenChange }: InvoiceDetailDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-2xl xl:max-w-3xl"
      >
        <SheetHeader className="space-y-1.5 pb-4">
          <SheetTitle className="flex items-center gap-2 text-base">
            Aperçu facture
            {invoice?.numeroFacture && (
              <span className="font-mono text-xs text-muted-foreground">
                {invoice.numeroFacture}
              </span>
            )}
          </SheetTitle>
          <SheetDescription className="text-xs">
            Détail récupéré depuis Chorus Pro. Ouvrir la fiche complète pour les actions de traitement.
          </SheetDescription>
        </SheetHeader>

        {invoice && (
          <>
            <InvoiceDetailPanel invoice={invoice} />
            <div className="mt-4 flex justify-end">
              <Button variant="outline" size="sm" asChild>
                <Link to={`/invoices/reception/${invoice.identifiantFactureCPP ?? ''}`}>
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  Ouvrir la fiche complète
                </Link>
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

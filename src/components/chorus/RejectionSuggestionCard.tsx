import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ExternalLink,
  FileCheck2,
  Lightbulb,
  Loader2,
  Phone,
  RefreshCw,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { analyzeRejection, type RejectionActionType, type RejectionAnalysis } from '@/lib/chorus/rejectionAnalysis';
import type { Invoice } from '@/types';
import { cn } from '@/lib/utils';

const FIELD_LABELS: Record<string, string> = {
  engagementNumber: 'N° engagement',
  marketNumber: 'N° marché',
  purchaseOrderNumber: 'N° bon de commande',
  publicCustomerSiret: 'SIRET destinataire',
  publicCustomerId: 'Destinataire',
  supplierSiret: 'SIRET fournisseur',
  totalAmountHt: 'Total HT',
  totalVat: 'TVA',
  totalAmountTtc: 'Total TTC',
  invoiceDate: 'Date facture',
  supplierInvoiceNumber: 'N° facture',
  currencyCode: 'Devise',
};

interface ActionCta {
  to: string;
  label: string;
  icon: LucideIcon;
}

function ctaFor(action: RejectionActionType, invoiceId: string): ActionCta {
  const detailHref = `/invoices/chorus/${encodeURIComponent(invoiceId)}`;
  switch (action) {
    case 'RESOUMETTRE':
      return {
        to: `/invoices/new?invoiceId=${encodeURIComponent(invoiceId)}&correction=1`,
        label: 'Corriger et resoumettre',
        icon: ArrowRight,
      };
    case 'RECYCLER':
      return { to: detailHref, label: 'Recycler la facture', icon: RefreshCw };
    case 'COMPLETER':
      return { to: detailHref, label: 'Compléter la facture', icon: FileCheck2 };
    case 'CONTACTER_CLIENT':
      return { to: detailHref, label: 'Voir le détail', icon: Phone };
    case 'AUCUNE':
    default:
      return { to: detailHref, label: 'Voir l’historique', icon: ExternalLink };
  }
}

// Sur la fiche détail, les actions RECYCLER / COMPLETER se font dans des blocs
// déjà présents plus bas : on remplace le bouton (qui renverrait sur la même page)
// par un indice.
const DETAIL_HINTS: Partial<Record<RejectionActionType, string>> = {
  RECYCLER: 'Utilisez le bloc « Recyclage » ci-dessous pour compléter et recycler la facture.',
  COMPLETER: 'Utilisez le bloc « Complétion » ci-dessous pour finaliser la facture suspendue.',
};

export function RejectionSuggestionCard({
  invoice,
  onDetailPage = false,
}: {
  invoice: Invoice;
  /** Affichage sur la fiche détail : masque les CTA redondants (on y est déjà). */
  onDetailPage?: boolean;
}) {
  const [analysis, setAnalysis] = useState<RejectionAnalysis | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setAnalysis(null);

    void analyzeRejection(invoice)
      .then((result) => {
        if (!cancelled) {
          setAnalysis(result);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [invoice]);

  const cta = analysis ? ctaFor(analysis.actionRecommandee, invoice.id) : null;

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/[0.03] p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lightbulb className="h-4 w-4" />}
        </span>
        <div className="flex flex-1 items-center gap-2">
          <p className="text-sm font-semibold text-foreground">Suggestion de traitement</p>
          {analysis && (
            <Badge
              variant="outline"
              className={cn(
                'gap-1 text-[10px]',
                analysis.source === 'llm' && 'border-primary/40 text-primary',
              )}
            >
              {analysis.source === 'llm' ? <Sparkles className="h-3 w-3" /> : null}
              {analysis.source === 'llm' ? 'IA' : 'Règles'}
            </Badge>
          )}
        </div>
      </div>

      {loading && (
        <p className="text-xs text-muted-foreground">Analyse du motif de rejet en cours…</p>
      )}

      {!loading && analysis && (
        <div className="space-y-3">
          <p className="text-sm text-foreground">{analysis.explication}</p>

          {analysis.etapes.length > 0 && (
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              {analysis.etapes.map((etape, index) => (
                <li key={index}>{etape}</li>
              ))}
            </ol>
          )}

          {analysis.champsACorriger.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                À vérifier :
              </span>
              {analysis.champsACorriger.map((field) => (
                <Badge key={field} variant="secondary" className="text-[10px]">
                  {FIELD_LABELS[field] ?? field}
                </Badge>
              ))}
            </div>
          )}

          {cta && (!onDetailPage || analysis.actionRecommandee === 'RESOUMETTRE') && (
            <Button asChild size="sm" className="h-8">
              <Link to={cta.to}>
                <cta.icon className="mr-1.5 h-3.5 w-3.5" />
                {cta.label}
              </Link>
            </Button>
          )}

          {onDetailPage && DETAIL_HINTS[analysis.actionRecommandee] && (
            <p className="text-xs font-medium text-primary">{DETAIL_HINTS[analysis.actionRecommandee]}</p>
          )}
        </div>
      )}
    </div>
  );
}

import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getChorusRawStatusConfig } from '@/lib/status-utils';

export type InvoiceDirection = 'emission' | 'reception';

export interface InvoiceSummaryAction {
  label: string;
  to: string;
  primary?: boolean;
}

export interface InvoiceSummaryCardProps {
  /** Numéro de facture (fournisseur ou Chorus). */
  invoiceNumber: string;
  supplier?: string | null;
  recipient?: string | null;
  supplierSiret?: string | null;
  recipientSiret?: string | null;
  /** Montant TTC (déjà formaté en devise pour l'affichage). */
  totalTtc?: string | null;
  currency?: string | null;
  /** Statut métier brut Chorus (résolu via getChorusRawStatusConfig). */
  status?: string | null;
  /** Sens du flux : émission (envoyée) ou réception (reçue). */
  direction?: InvoiceDirection;
  /** Action recommandée (texte). */
  recommendedAction?: string | null;
  /** Boutons contextuels : « Voir facture », « Corriger », « Suivre »… */
  actions?: InvoiceSummaryAction[];
  className?: string;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-[13px] font-medium text-foreground" title={typeof value === 'string' ? value : undefined}>
        {value ?? '—'}
      </dd>
    </div>
  );
}

const DIRECTION_META: Record<InvoiceDirection, { label: string; icon: typeof ArrowUpRight; className: string }> = {
  emission: { label: 'Émission', icon: ArrowUpRight, className: 'bg-info-soft text-info ring-info/20' },
  reception: { label: 'Réception', icon: ArrowDownLeft, className: 'bg-muted text-muted-foreground ring-border' },
};

/**
 * Fiche de résumé d'une facture, uniformisée (émission ou réception).
 * Présentationnelle : les données arrivent en props. Le statut métier est coloré via le
 * mapping Chorus existant (getChorusRawStatusConfig) pour rester cohérent avec le reste.
 */
export function InvoiceSummaryCard({
  invoiceNumber,
  supplier,
  recipient,
  supplierSiret,
  recipientSiret,
  totalTtc,
  currency,
  status,
  direction = 'emission',
  recommendedAction,
  actions,
  className,
}: InvoiceSummaryCardProps) {
  const statusConfig = status ? getChorusRawStatusConfig(status) : null;
  const dir = DIRECTION_META[direction];
  const DirIcon = dir.icon;

  return (
    <div className={cn('rounded-xl border bg-card p-4 shadow-soft', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileText className="h-[18px] w-[18px]" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-foreground" title={invoiceNumber}>
              {invoiceNumber}
            </p>
            <span
              className={cn(
                'mt-0.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-medium ring-1 ring-inset',
                dir.className,
              )}
            >
              <DirIcon className="h-3 w-3" />
              {dir.label}
            </span>
          </div>
        </div>
        {statusConfig && (
          <span className={cn('status-badge shrink-0', statusConfig.bgClass, statusConfig.textClass)}>
            <span className="mr-1.5 h-1.5 w-1.5 rounded-full" style={{ backgroundColor: statusConfig.color }} />
            {statusConfig.label}
          </span>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5">
        <Field label="Fournisseur" value={supplier} />
        <Field label="Destinataire" value={recipient} />
        <Field label="SIRET fournisseur" value={supplierSiret} />
        <Field label="SIRET destinataire" value={recipientSiret} />
        <Field
          label="Montant TTC"
          value={totalTtc ? <span className="tabular-nums">{totalTtc}</span> : null}
        />
        <Field label="Devise" value={currency} />
      </dl>

      {recommendedAction && (
        <p className="mt-3 flex items-start gap-2 text-[12.5px] leading-5 text-foreground">
          <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span>{recommendedAction}</span>
        </p>
      )}

      {actions && actions.length > 0 && (
        <div className="mt-3.5 flex flex-wrap gap-2">
          {actions.map((action) => (
            <Link
              key={`${action.label}-${action.to}`}
              to={action.to}
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                action.primary
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'border bg-card text-foreground shadow-soft hover:border-primary/40 hover:bg-muted/50',
              )}
            >
              {action.label}
              <ArrowRight className="h-3 w-3" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

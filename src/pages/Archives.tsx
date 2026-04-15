import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/common/StatusBadge';
import { invoices, getSupplier, getCustomer } from '@/data/mock-data';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/status-utils';
import { Archive, Eye } from 'lucide-react';

const archived = invoices.filter(i => i.statusInternal === 'ARCHIVED');

export default function Archives() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold">Archives</h1>
        <p className="text-sm text-muted-foreground">{archived.length} facture(s) archivée(s)</p>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left p-3 font-medium">N° Facture</th>
                <th className="text-left p-3 font-medium">Fournisseur</th>
                <th className="text-left p-3 font-medium">Client</th>
                <th className="text-right p-3 font-medium">Montant TTC</th>
                <th className="text-left p-3 font-medium">Archivé le</th>
                <th className="text-left p-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {archived.map(inv => {
                const supplier = getSupplier(inv.supplierOrganizationId);
                const customer = getCustomer(inv.publicCustomerId);
                return (
                  <tr key={inv.id} className="border-b">
                    <td className="p-3 font-medium">{inv.supplierInvoiceNumber}</td>
                    <td className="p-3">{supplier?.legalName}</td>
                    <td className="p-3">{customer?.legalName}</td>
                    <td className="p-3 text-right font-medium">{formatCurrency(inv.totalTtc)}</td>
                    <td className="p-3 text-xs text-muted-foreground">{inv.archivedAt ? formatDateTime(inv.archivedAt) : '-'}</td>
                    <td className="p-3">
                      <Button variant="ghost" size="sm" asChild>
                        <Link to={`/invoices/${inv.id}`}><Eye className="h-4 w-4" /></Link>
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {archived.length === 0 && (
                <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Aucune facture archivée</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

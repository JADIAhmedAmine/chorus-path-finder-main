import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { StatusBadge } from '@/components/common/StatusBadge';
import { formatCurrency, formatDate } from '@/lib/status-utils';
import { getInvoices, getPublicCustomers, getSuppliers } from '@/data/mock-data';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { Search, Download, Plus, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import type { InvoiceStatusInternal } from '@/types';

const allStatuses: InvoiceStatusInternal[] = [
  'DRAFT_UPLOADED', 'DRAFT_STRUCTURED', 'PENDING_HUMAN_REVIEW', 'READY_FOR_SUBMISSION',
  'SUBMISSION_REQUESTED', 'SUBMITTED_TO_CHORUS', 'REJECTED_BUSINESS', 'REJECTED_TECHNICAL',
  'ACCEPTED_BY_CHORUS', 'PAID', 'ARCHIVED'
];

const PAGE_SIZE = 10;

export default function InvoiceList() {
  const [searchParams] = useSearchParams();
  const initialStatus = searchParams.get('status') || '';
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [formatFilter, setFormatFilter] = useState('');
  const [page, setPage] = useState(1);
  const { data, loading, error } = useAsyncResource(
    async () => {
      const [invoices, suppliers, publicCustomers] = await Promise.all([
        getInvoices(),
        getSuppliers(),
        getPublicCustomers(),
      ]);

      return { invoices, suppliers, publicCustomers };
    },
    [],
    {
      invoices: [],
      suppliers: [],
      publicCustomers: [],
    },
  );

  const supplierById = useMemo(
    () => new Map(data.suppliers.map((supplier) => [supplier.id, supplier])),
    [data.suppliers],
  );
  const customerById = useMemo(
    () => new Map(data.publicCustomers.map((customer) => [customer.id, customer])),
    [data.publicCustomers],
  );

  const filtered = useMemo(() => {
    return data.invoices.filter((inv) => {
      const supplier = supplierById.get(inv.supplierOrganizationId);
      const customer = customerById.get(inv.publicCustomerId);
      const matchSearch = !search || [
        inv.supplierInvoiceNumber,
        supplier?.legalName,
        supplier?.siret,
        customer?.legalName,
      ].some(v => v?.toLowerCase().includes(search.toLowerCase()));

      const matchStatus = !statusFilter || statusFilter.split(',').includes(inv.statusInternal);
      const matchFormat = !formatFilter || inv.sourceFormat === formatFilter;
      return matchSearch && matchStatus && matchFormat;
    });
  }, [customerById, data.invoices, formatFilter, search, statusFilter, supplierById]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const safePage = Math.min(page, Math.max(totalPages, 1));
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const exportCSV = () => {
    const headers = ['Numéro', 'Fournisseur', 'SIRET', 'Client', 'Date', 'Montant TTC', 'Statut'];
    const rows = filtered.map(inv => {
      const supplier = supplierById.get(inv.supplierOrganizationId);
      const customer = customerById.get(inv.publicCustomerId);
      return [inv.supplierInvoiceNumber, supplier?.legalName, supplier?.siret, customer?.legalName, inv.invoiceDate, inv.totalTtc, inv.statusInternal].join(';');
    });
    const csv = [headers.join(';'), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'factures-export.csv';
    a.click();
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Factures</h1>
          <p className="text-sm text-muted-foreground">
            {loading ? 'Chargement des factures...' : `${filtered.length} facture(s) trouvée(s)`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCSV}>
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
          <Button asChild>
            <Link to="/invoices/new"><Plus className="mr-2 h-4 w-4" /> Nouvelle facture</Link>
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Rechercher par numéro, fournisseur, SIRET..." className="pl-9" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
            </div>
            <Select value={statusFilter} onValueChange={v => { setStatusFilter(v === 'all' ? '' : v); setPage(1); }}>
              <SelectTrigger className="w-[200px]"><Filter className="mr-2 h-4 w-4" /><SelectValue placeholder="Tous les statuts" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les statuts</SelectItem>
                {allStatuses.map(s => <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={formatFilter} onValueChange={v => { setFormatFilter(v === 'all' ? '' : v); setPage(1); }}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="Format" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous</SelectItem>
                <SelectItem value="PDF">PDF</SelectItem>
                <SelectItem value="XML">XML</SelectItem>
                <SelectItem value="FACTUR_X">Factur-X</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left p-3 font-medium">N° Facture</th>
                  <th className="text-left p-3 font-medium">Fournisseur</th>
                  <th className="text-left p-3 font-medium hidden lg:table-cell">Client public</th>
                  <th className="text-left p-3 font-medium hidden md:table-cell">Date</th>
                  <th className="text-right p-3 font-medium">Montant TTC</th>
                  <th className="text-left p-3 font-medium hidden md:table-cell">Format</th>
                  <th className="text-left p-3 font-medium">Statut</th>
                  <th className="text-left p-3 font-medium hidden lg:table-cell">MAJ</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((inv) => {
                  const supplier = supplierById.get(inv.supplierOrganizationId);
                  const customer = customerById.get(inv.publicCustomerId);
                  return (
                    <tr key={inv.id} className="border-b hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => window.location.href = `/invoices/${inv.id}`}>
                      <td className="p-3">
                        <Link to={`/invoices/${inv.id}`} className="font-medium text-accent hover:underline">{inv.supplierInvoiceNumber}</Link>
                      </td>
                      <td className="p-3">
                        <div>{supplier?.legalName}</div>
                        <div className="text-xs text-muted-foreground">{supplier?.siret}</div>
                      </td>
                      <td className="p-3 hidden lg:table-cell">{customer?.legalName}</td>
                      <td className="p-3 hidden md:table-cell">{formatDate(inv.invoiceDate)}</td>
                      <td className="p-3 text-right font-medium">{formatCurrency(inv.totalTtc)}</td>
                      <td className="p-3 hidden md:table-cell">
                        <span className="text-xs px-2 py-0.5 rounded bg-muted">{inv.sourceFormat}</span>
                      </td>
                      <td className="p-3"><StatusBadge status={inv.statusInternal} /></td>
                      <td className="p-3 text-xs text-muted-foreground hidden lg:table-cell">{formatDate(inv.updatedAt)}</td>
                    </tr>
                  );
                })}
                {paginated.length === 0 && (
                  <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">Aucune facture trouvée</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <span className="text-sm text-muted-foreground">Page {safePage} / {totalPages}</span>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={safePage === 1} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" disabled={safePage === totalPages} onClick={() => setPage(p => p + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

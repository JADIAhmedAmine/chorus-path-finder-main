import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useReferenceCatalog } from '@/hooks/use-reference-catalog';
import { Search, Plus, Edit, Building2, ClipboardList } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function References() {
  const [custSearch, setCustSearch] = useState('');
  const [svcSearch, setSvcSearch] = useState('');
  const [customerPage, setCustomerPage] = useState(1);
  const [servicePage, setServicePage] = useState(1);
  const {
    publicCustomers,
    publicServices,
    metadata,
    loading,
    error,
  } = useReferenceCatalog();

  const filteredCustomers = publicCustomers.filter(c =>
    !custSearch || [c.legalName, c.codeDestinataire, c.siret].some(v => v.toLowerCase().includes(custSearch.toLowerCase()))
  );
  const filteredServices = publicServices.filter(s =>
    !svcSearch || [s.label, s.codeServiceExecutant].some(v => v.toLowerCase().includes(svcSearch.toLowerCase()))
  );
  const PAGE_SIZE = 100;
  const totalCustomerPages = Math.max(1, Math.ceil(filteredCustomers.length / PAGE_SIZE));
  const totalServicePages = Math.max(1, Math.ceil(filteredServices.length / PAGE_SIZE));
  const paginatedCustomers = filteredCustomers.slice((customerPage - 1) * PAGE_SIZE, customerPage * PAGE_SIZE);
  const paginatedServices = filteredServices.slice((servicePage - 1) * PAGE_SIZE, servicePage * PAGE_SIZE);
  const servicesByCustomerId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const service of publicServices) {
      counts.set(service.publicCustomerId, (counts.get(service.publicCustomerId) ?? 0) + 1);
    }
    return counts;
  }, [publicServices]);

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-semibold">Référentiels</h1>
      {loading && (
        <p className="text-sm text-muted-foreground">Chargement des référentiels Chorus...</p>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!error && (publicCustomers.length > 0 || publicServices.length > 0) && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-medium">Source active :</span>
              <Badge variant={metadata.publicCustomersSource === 'annuaire' ? 'default' : 'secondary'}>
                Clients publics : {metadata.publicCustomersSource === 'annuaire' ? `Annuaire ${metadata.annuaireSourceFormat === 'json' ? 'JSON' : 'XML'} Chorus` : metadata.publicCustomersSource === 'api' ? 'API backend' : 'Aucune'}
              </Badge>
              <Badge variant={metadata.publicServicesSource === 'annuaire' ? 'default' : 'secondary'}>
                Services : {metadata.publicServicesSource === 'annuaire' ? `Annuaire ${metadata.annuaireSourceFormat === 'json' ? 'JSON' : 'XML'} Chorus` : metadata.publicServicesSource === 'api' ? 'API backend' : 'Aucune'}
              </Badge>
              {metadata.annuaireXmlUrl && (metadata.publicCustomersSource === 'annuaire' || metadata.publicServicesSource === 'annuaire') && (
                <span className="text-xs text-muted-foreground">
                  Annuaire chargé : {metadata.annuaireStructureCount} structures, {metadata.annuaireServiceCount} services.
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="customers">
        <TabsList>
          <TabsTrigger value="customers"><Building2 className="mr-2 h-4 w-4" /> Clients publics</TabsTrigger>
          <TabsTrigger value="services"><ClipboardList className="mr-2 h-4 w-4" /> Services destinataires</TabsTrigger>
        </TabsList>

        <TabsContent value="customers" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="relative w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Rechercher..." className="pl-9" value={custSearch} onChange={e => { setCustSearch(e.target.value); setCustomerPage(1); }} />
            </div>
            <Button><Plus className="mr-2 h-4 w-4" /> Ajouter</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {filteredCustomers.length} destinataire(s) trouves. Affichage de {paginatedCustomers.length} ligne(s) sur cette page.
          </p>
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left p-3 font-medium">Code</th>
                    <th className="text-left p-3 font-medium">Nom</th>
                    <th className="text-left p-3 font-medium">SIRET</th>
                    <th className="text-left p-3 font-medium">Type</th>
                    <th className="text-left p-3 font-medium">Services</th>
                    <th className="text-left p-3 font-medium">Statut</th>
                    <th className="text-left p-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedCustomers.map(c => {
                    const svcCount = servicesByCustomerId.get(c.id) ?? 0;
                    return (
                      <tr key={c.id} className="border-b">
                        <td className="p-3 font-mono text-xs">{c.codeDestinataire}</td>
                        <td className="p-3 font-medium">{c.legalName}</td>
                        <td className="p-3 text-muted-foreground">{c.siret}</td>
                        <td className="p-3"><Badge variant="secondary">{c.structureType}</Badge></td>
                        <td className="p-3">{svcCount}</td>
                        <td className="p-3">
                          {c.active ? (
                            <span className="text-xs px-2 py-0.5 rounded bg-success/10 text-success">Actif</span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">Inactif</span>
                          )}
                        </td>
                        <td className="p-3"><Button variant="ghost" size="sm"><Edit className="h-4 w-4" /></Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {totalCustomerPages > 1 && (
                <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
                  <span className="text-muted-foreground">Page {customerPage} / {totalCustomerPages}</span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={customerPage === 1} onClick={() => setCustomerPage((value) => value - 1)}>
                      Précédent
                    </Button>
                    <Button variant="outline" size="sm" disabled={customerPage === totalCustomerPages} onClick={() => setCustomerPage((value) => value + 1)}>
                      Suivant
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="services" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="relative w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Rechercher..." className="pl-9" value={svcSearch} onChange={e => { setSvcSearch(e.target.value); setServicePage(1); }} />
            </div>
            <Button><Plus className="mr-2 h-4 w-4" /> Ajouter</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {filteredServices.length} service(s) trouves. Affichage de {paginatedServices.length} ligne(s) sur cette page.
          </p>
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left p-3 font-medium">Code</th>
                    <th className="text-left p-3 font-medium">Libellé</th>
                    <th className="text-left p-3 font-medium">Client public</th>
                    <th className="text-left p-3 font-medium">Engagement</th>
                    <th className="text-left p-3 font-medium">Bon de cmd.</th>
                    <th className="text-left p-3 font-medium">Statut</th>
                    <th className="text-left p-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedServices.map(s => {
                    const customer = publicCustomers.find(c => c.id === s.publicCustomerId);
                    return (
                      <tr key={s.id} className="border-b">
                        <td className="p-3 font-mono text-xs">{s.codeServiceExecutant}</td>
                        <td className="p-3 font-medium">{s.label}</td>
                        <td className="p-3">{customer?.legalName}</td>
                        <td className="p-3">{s.engagementRequired ? <Badge variant="destructive" className="text-xs">Obligatoire</Badge> : <span className="text-xs text-muted-foreground">Non</span>}</td>
                        <td className="p-3">{s.purchaseOrderRequired ? <Badge variant="destructive" className="text-xs">Obligatoire</Badge> : <span className="text-xs text-muted-foreground">Non</span>}</td>
                        <td className="p-3">
                          {s.active ? (
                            <span className="text-xs px-2 py-0.5 rounded bg-success/10 text-success">Actif</span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">Inactif</span>
                          )}
                        </td>
                        <td className="p-3"><Button variant="ghost" size="sm"><Edit className="h-4 w-4" /></Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {totalServicePages > 1 && (
                <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
                  <span className="text-muted-foreground">Page {servicePage} / {totalServicePages}</span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={servicePage === 1} onClick={() => setServicePage((value) => value - 1)}>
                      Précédent
                    </Button>
                    <Button variant="outline" size="sm" disabled={servicePage === totalServicePages} onClick={() => setServicePage((value) => value + 1)}>
                      Suivant
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

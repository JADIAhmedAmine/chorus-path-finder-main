import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { publicCustomers, publicServices, getServicesForCustomer } from '@/data/mock-data';
import { Search, Plus, Edit, Building2, ClipboardList } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function References() {
  const [custSearch, setCustSearch] = useState('');
  const [svcSearch, setSvcSearch] = useState('');

  const filteredCustomers = publicCustomers.filter(c =>
    !custSearch || [c.legalName, c.codeDestinataire, c.siret].some(v => v.toLowerCase().includes(custSearch.toLowerCase()))
  );
  const filteredServices = publicServices.filter(s =>
    !svcSearch || [s.label, s.codeServiceExecutant].some(v => v.toLowerCase().includes(svcSearch.toLowerCase()))
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-semibold">Référentiels</h1>

      <Tabs defaultValue="customers">
        <TabsList>
          <TabsTrigger value="customers"><Building2 className="mr-2 h-4 w-4" /> Clients publics</TabsTrigger>
          <TabsTrigger value="services"><ClipboardList className="mr-2 h-4 w-4" /> Services destinataires</TabsTrigger>
        </TabsList>

        <TabsContent value="customers" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="relative w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Rechercher..." className="pl-9" value={custSearch} onChange={e => setCustSearch(e.target.value)} />
            </div>
            <Button><Plus className="mr-2 h-4 w-4" /> Ajouter</Button>
          </div>
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
                  {filteredCustomers.map(c => {
                    const svcCount = getServicesForCustomer(c.id).length;
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
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="services" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="relative w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Rechercher..." className="pl-9" value={svcSearch} onChange={e => setSvcSearch(e.target.value)} />
            </div>
            <Button><Plus className="mr-2 h-4 w-4" /> Ajouter</Button>
          </div>
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
                  {filteredServices.map(s => {
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
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

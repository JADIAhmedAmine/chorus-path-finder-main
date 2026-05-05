import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useReferenceCatalog } from '@/hooks/use-reference-catalog';
import { Search, Plus, Info, Building2, ClipboardList, RefreshCw, Loader2, Server, FileJson } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { loadChorusConfig } from '@/lib/chorus/storage';
import {
  ChorusBackendAutomationClient,
  type ChorusAnnuaireSyncResult,
  type ChorusSiretInformationResult,
} from '@/lib/chorus/backendAutomation';
import type { PublicCustomer } from '@/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function displayValue(value: unknown): string {
  if (typeof value === 'boolean') {
    return value ? 'Oui' : 'Non';
  }

  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }

  if (typeof value === 'string' && value.trim()) {
    return value;
  }

  return 'Non renseigné';
}

function pickInfoField(info: unknown, key: string): unknown {
  return isRecord(info) ? info[key] : undefined;
}

function matchesSearch(values: Array<string | undefined>, search: string): boolean {
  const normalizedSearch = search.trim().toLowerCase();
  if (!normalizedSearch) {
    return true;
  }

  return values.some((value) => (value ?? '').toLowerCase().includes(normalizedSearch));
}

function InfoTile({
  label,
  value,
  className = '',
}: {
  label: string;
  value: unknown;
  className?: string;
}) {
  return (
    <div className={`rounded-md border bg-background p-3 ${className}`}>
      <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-sm">{displayValue(value)}</p>
    </div>
  );
}

function CustomerInformationView({
  customer,
  result,
}: {
  customer: PublicCustomer | null;
  result: ChorusSiretInformationResult;
}) {
  const info = result.info;
  const raisonSociale = pickInfoField(info, 'raisonSociale') || customer?.legalName;
  const estActif = pickInfoField(info, 'estActif');
  const libelle = pickInfoField(info, 'libelle');
  const codeRetour = pickInfoField(info, 'codeRetour');

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-muted/20 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">Structure INSEE</p>
            <h2 className="mt-1 text-lg font-semibold">{displayValue(raisonSociale)}</h2>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {displayValue(pickInfoField(info, 'siret') || result.siretStructure)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={estActif === false ? 'secondary' : 'default'}>
              {estActif === false ? 'Inactif' : 'Actif'}
            </Badge>
            {codeRetour !== undefined && <Badge variant="outline">Retour {displayValue(codeRetour)}</Badge>}
            {typeof libelle === 'string' && libelle && <Badge variant="secondary">{libelle}</Badge>}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium">Identité</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <InfoTile label="SIRET" value={pickInfoField(info, 'siret')} />
          <InfoTile label="SIREN" value={pickInfoField(info, 'siren')} />
          <InfoTile label="Siège" value={pickInfoField(info, 'siege')} />
          <InfoTile label="Civilité" value={pickInfoField(info, 'civilite')} />
          <InfoTile label="Numéro interne" value={pickInfoField(info, 'numeroInterneClassement')} />
          <InfoTile label="Non diffusible INSEE" value={pickInfoField(info, 'nonDiffusibleInsee')} />
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium">Adresse</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <InfoTile label="Adresse" value={pickInfoField(info, 'adresse')} className="md:col-span-2" />
          <InfoTile label="Localisation siège" value={pickInfoField(info, 'localisationSiege')} />
          <InfoTile label="Prédécesseur / successeur" value={pickInfoField(info, 'siretPredecesseurSuccesseur')} />
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium">Classification</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <InfoTile label="Catégorie juridique" value={pickInfoField(info, 'categorieJuridique')} />
          <InfoTile label="Catégorie entreprise" value={pickInfoField(info, 'categorieEntreprise')} />
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium">Dates</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <InfoTile label="Création entreprise" value={pickInfoField(info, 'dateCreationEntreprise')} />
          <InfoTile label="Création établissement" value={pickInfoField(info, 'dateCreationEtablissement')} />
          <InfoTile label="Réactivation établissement" value={pickInfoField(info, 'dateReactivationEtablissement')} />
        </div>
      </div>

      <details className="rounded-md border bg-muted/20 p-4">
        <summary className="cursor-pointer text-sm font-medium">Réponse complète</summary>
        <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">
          {JSON.stringify(info ?? null, null, 2)}
        </pre>
      </details>
    </div>
  );
}

export default function References() {
  const [custSearch, setCustSearch] = useState('');
  const [svcSearch, setSvcSearch] = useState('');
  const [customerPage, setCustomerPage] = useState(1);
  const [servicePage, setServicePage] = useState(1);
  const [syncingAnnuaire, setSyncingAnnuaire] = useState(false);
  const [annuaireSyncResult, setAnnuaireSyncResult] = useState<ChorusAnnuaireSyncResult | null>(null);
  const [annuaireSyncError, setAnnuaireSyncError] = useState<string | null>(null);
  const [customerInfoOpen, setCustomerInfoOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<PublicCustomer | null>(null);
  const [loadingCustomerInfo, setLoadingCustomerInfo] = useState(false);
  const [customerInfoResult, setCustomerInfoResult] = useState<ChorusSiretInformationResult | null>(null);
  const [customerInfoError, setCustomerInfoError] = useState<string | null>(null);
  const {
    publicCustomers,
    publicServices,
    metadata,
    loading,
    error,
    refresh,
  } = useReferenceCatalog();
  const annuaireSyncUrl = useMemo(() => {
    const client = new ChorusBackendAutomationClient(loadChorusConfig());
    return client.annuaireSyncUrl;
  }, []);
  const [searchParams, setSearchParams] = useSearchParams();
  const autoOpenedSiretRef = useRef<string | null>(null);

  const filteredCustomers = publicCustomers.filter((customer) =>
    matchesSearch([customer.legalName, customer.codeDestinataire, customer.siret], custSearch),
  );
  const filteredServices = publicServices.filter((service) =>
    matchesSearch([service.label, service.codeServiceExecutant], svcSearch),
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

  async function handleSyncAnnuaire() {
    setSyncingAnnuaire(true);
    setAnnuaireSyncError(null);

    try {
      const client = new ChorusBackendAutomationClient(loadChorusConfig());
      const result = await client.syncAnnuaire();
      setAnnuaireSyncResult(result);
      refresh();
    } catch (syncError) {
      setAnnuaireSyncResult(null);
      setAnnuaireSyncError(syncError instanceof Error ? syncError.message : 'Synchronisation annuaire impossible.');
    } finally {
      setSyncingAnnuaire(false);
    }
  }

  useEffect(() => {
    const requestedSiret = searchParams.get('siret');
    if (!requestedSiret || autoOpenedSiretRef.current === requestedSiret) {
      return;
    }
    if (publicCustomers.length === 0) {
      return;
    }

    const normalized = requestedSiret.replace(/\D/g, '');
    const match = publicCustomers.find((customer) => {
      const customerSiret = (customer.siret || '').replace(/\D/g, '');
      const customerCode = (customer.codeDestinataire || '').replace(/\D/g, '');
      return customerSiret === normalized || customerCode === normalized;
    });

    if (!match) {
      return;
    }

    autoOpenedSiretRef.current = requestedSiret;
    setCustSearch(match.legalName);
    setCustomerPage(1);
    void handleLoadCustomerInfo(match);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('siret');
    setSearchParams(nextParams, { replace: true });
  }, [publicCustomers, searchParams, setSearchParams]);

  async function handleLoadCustomerInfo(customer: PublicCustomer) {
    const siretStructure = (customer.siret || customer.codeDestinataire).replace(/\D/g, '');
    setSelectedCustomer(customer);
    setCustomerInfoOpen(true);
    setLoadingCustomerInfo(true);
    setCustomerInfoResult(null);
    setCustomerInfoError(null);

    if (!siretStructure) {
      setLoadingCustomerInfo(false);
      setCustomerInfoError('Aucun SIRET exploitable pour ce client.');
      return;
    }

    try {
      const client = new ChorusBackendAutomationClient(loadChorusConfig());
      const result = await client.consultSiretInformation(siretStructure);
      setCustomerInfoResult(result);
    } catch (infoError) {
      setCustomerInfoError(infoError instanceof Error ? infoError.message : 'Consultation SIRET impossible.');
    } finally {
      setLoadingCustomerInfo(false);
    }
  }

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

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="h-4 w-4" />
              Automatisation Chorus
            </CardTitle>
            <Badge variant="secondary">Bridge Python</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div className="space-y-2">
              <Label>Endpoint annuaire</Label>
              <div className="rounded-md border bg-muted/30 px-3 py-2 font-mono text-xs break-all">
                {annuaireSyncUrl}
              </div>
            </div>
            <Button onClick={handleSyncAnnuaire} disabled={syncingAnnuaire}>
              {syncingAnnuaire ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Synchroniser l&apos;annuaire
            </Button>
          </div>

          {annuaireSyncResult && (
            <Alert>
              <FileJson className="h-4 w-4" />
              <AlertDescription>
                JSON généré : {annuaireSyncResult.structureCount} structures, {annuaireSyncResult.serviceCount} services
                {annuaireSyncResult.jsonPath ? ` (${annuaireSyncResult.jsonPath})` : ''}.
              </AlertDescription>
            </Alert>
          )}

          {annuaireSyncError && (
            <Alert variant="destructive">
              <AlertDescription>{annuaireSyncError}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

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
                        <td className="p-3">
                          <Button variant="ghost" size="sm" onClick={() => void handleLoadCustomerInfo(c)}>
                            <Info className="mr-2 h-4 w-4" />
                            Plus d&apos;infos
                          </Button>
                        </td>
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
                        <td className="p-3">
                          <Button variant="ghost" size="sm">
                            <Info className="mr-2 h-4 w-4" />
                            Voir
                          </Button>
                        </td>
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

      <Dialog open={customerInfoOpen} onOpenChange={setCustomerInfoOpen}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Informations client</DialogTitle>
            <DialogDescription>
              {selectedCustomer
                ? `${selectedCustomer.legalName} - ${selectedCustomer.siret || selectedCustomer.codeDestinataire}`
                : 'Consultation des informations SIRET.'}
            </DialogDescription>
          </DialogHeader>

          {loadingCustomerInfo && (
            <div className="flex items-center gap-2 rounded-md border bg-muted/20 p-4 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Consultation du référentiel SIRET...
            </div>
          )}

          {customerInfoError && (
            <Alert variant="destructive">
              <AlertDescription>{customerInfoError}</AlertDescription>
            </Alert>
          )}

          {customerInfoResult && (
            <CustomerInformationView customer={selectedCustomer} result={customerInfoResult} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

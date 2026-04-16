import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { tenant, currentUser, suppliers } from '@/data/mock-data';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { createChorusConnector } from '@/lib/chorus/client';
import { loadChorusConfig, maskSecret, saveChorusConfig } from '@/lib/chorus/storage';
import type { ChorusConfig, ChorusConnectionResult } from '@/types/chorus';
import { Loader2, PlugZap } from 'lucide-react';

const connectorModeLabels = {
  mock: 'Mock / démonstration',
  direct: 'Connexion directe (dev uniquement)',
} as const;

const connectionMethodLabels = {
  GET: 'GET',
  POST: 'POST',
} as const;

export default function SettingsPage() {
  const { toast } = useToast();
  const [config, setConfig] = useState<ChorusConfig>(() => loadChorusConfig());
  const [testingConnection, setTestingConnection] = useState(false);
  const [lastConnectionResult, setLastConnectionResult] = useState<ChorusConnectionResult | null>(null);

  const connectorStatus = useMemo(() => {
    if (!config.enabled) {
      return 'Désactivé';
    }

    return config.mode === 'mock' ? 'Simulation active' : 'Prêt pour test réel';
  }, [config.enabled, config.mode]);

  const handleFieldChange = <K extends keyof ChorusConfig>(field: K, value: ChorusConfig[K]) => {
    setConfig((previous) => ({
      ...previous,
      [field]: value,
    }));
  };

  const handleSave = () => {
    saveChorusConfig(config);
    toast({
      title: 'Configuration sauvegardée',
      description: 'Le connecteur Chorus Pro a été mis à jour dans ce navigateur.',
    });
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setLastConnectionResult(null);

    try {
      const connector = createChorusConnector(config);
      const result = await connector.testConnection();
      setLastConnectionResult(result);
      toast({
        title: 'Connexion Chorus validée',
        description: result.message,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue';
      const result: ChorusConnectionResult = {
        ok: false,
        message,
      };
      setLastConnectionResult(result);
      toast({
        title: 'Échec de connexion',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setTestingConnection(false);
    }
  };

  return (
    <div className="max-w-5xl space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold">Paramètres</h1>
        <p className="text-sm text-muted-foreground">Configuration de l'organisation, de l'utilisateur et du connecteur Chorus Pro</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Organisation</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <InfoRow label="Nom" value={tenant.name} />
          <InfoRow label="Code" value={tenant.code} />
          <InfoRow label="Statut" value={tenant.active ? 'Actif' : 'Inactif'} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Utilisateur courant</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <InfoRow label="Nom" value={`${currentUser.firstName} ${currentUser.lastName}`} />
          <InfoRow label="Email" value={currentUser.email} />
          <InfoRow label="Rôle" value={currentUser.roleCode} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Fournisseurs enregistrés</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {suppliers.map(s => (
            <div key={s.id} className="flex items-center justify-between py-2">
              <div>
                <div className="font-medium text-sm">{s.legalName}</div>
                <div className="text-xs text-muted-foreground">SIRET: {s.siret} · TVA: {s.vatNumber}</div>
              </div>
              <Badge variant={s.active ? 'default' : 'secondary'}>{s.active ? 'Actif' : 'Inactif'}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <PlugZap className="h-4 w-4" />
            Chorus Pro — Connecteur
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-1">
                <Label htmlFor="chorus-enabled">Activer le connecteur</Label>
                <p className="text-xs text-muted-foreground">Désactive les appels externes et laisse le projet en démo.</p>
              </div>
              <Switch
                id="chorus-enabled"
                checked={config.enabled}
                onCheckedChange={(checked) => handleFieldChange('enabled', checked)}
              />
            </div>

            <div className="space-y-2">
              <Label>Mode de connexion</Label>
              <Select value={config.mode} onValueChange={(value: ChorusConfig['mode']) => handleFieldChange('mode', value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mock">{connectorModeLabels.mock}</SelectItem>
                  <SelectItem value="direct">{connectorModeLabels.direct}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="token-url">URL OAuth2</Label>
              <Input id="token-url" value={config.tokenUrl} onChange={(e) => handleFieldChange('tokenUrl', e.target.value)} placeholder="https://sandbox-oauth.aife.economie.gouv.fr/api/oauth/token" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="api-base-url">Base API</Label>
              <Input id="api-base-url" value={config.apiBaseUrl} onChange={(e) => handleFieldChange('apiBaseUrl', e.target.value)} placeholder="https://..." />
            </div>

            <div className="space-y-2">
              <Label htmlFor="client-id">Client ID PISTE</Label>
              <Input id="client-id" value={config.clientId} onChange={(e) => handleFieldChange('clientId', e.target.value)} placeholder="client-id" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="client-secret">Client secret PISTE</Label>
              <Input id="client-secret" type="password" value={config.clientSecret} onChange={(e) => handleFieldChange('clientSecret', e.target.value)} placeholder="client-secret" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="technical-login">Login compte technique</Label>
              <Input id="technical-login" value={config.technicalLogin} onChange={(e) => handleFieldChange('technicalLogin', e.target.value)} placeholder="login technique" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="technical-password">Mot de passe compte technique</Label>
              <Input id="technical-password" type="password" value={config.technicalPassword} onChange={(e) => handleFieldChange('technicalPassword', e.target.value)} placeholder="mot de passe technique" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="scope">Scope OAuth2</Label>
              <Input id="scope" value={config.scope} onChange={(e) => handleFieldChange('scope', e.target.value)} placeholder="openid" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="connection-test-path">Endpoint test connexion</Label>
              <Input id="connection-test-path" value={config.connectionTestPath} onChange={(e) => handleFieldChange('connectionTestPath', e.target.value)} placeholder="/health" />
            </div>

            <div className="space-y-2">
              <Label>Méthode test connexion</Label>
              <Select value={config.connectionTestMethod} onValueChange={(value: ChorusConfig['connectionTestMethod']) => handleFieldChange('connectionTestMethod', value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="GET">{connectionMethodLabels.GET}</SelectItem>
                  <SelectItem value="POST">{connectionMethodLabels.POST}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="upload-file-path">Endpoint upload fichier</Label>
              <Input id="upload-file-path" value={config.uploadFilePath} onChange={(e) => handleFieldChange('uploadFilePath', e.target.value)} placeholder="/transverses/fichiers" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="submit-invoice-path">Endpoint soumission facture</Label>
              <Input id="submit-invoice-path" value={config.submitInvoicePath} onChange={(e) => handleFieldChange('submitInvoicePath', e.target.value)} placeholder="/factures/soumettre" />
            </div>
          </div>

          <Separator />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <InfoTile label="Mode" value={connectorModeLabels[config.mode]} />
            <InfoTile label="Statut" value={connectorStatus} />
            <InfoTile label="Client secret" value={maskSecret(config.clientSecret)} />
          </div>

          <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
            En production, évite d'exposer le client secret PISTE dans le front Vite. Le connecteur direct ajouté ici est surtout utile pour la sandbox, les tests de dev et le prototypage rapide.
            Pour un endpoint Chorus de recherche comme `/v1/rechercher/fournisseur`, utilise `POST` pour le test de connexion.
          </div>

          <div className="flex flex-wrap gap-3">
            <Button onClick={handleSave}>Enregistrer la configuration</Button>
            <Button variant="outline" onClick={handleTestConnection} disabled={testingConnection}>
              {testingConnection ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Tester la connexion
            </Button>
          </div>

          {lastConnectionResult && (
            <div className={`rounded-lg border p-4 ${lastConnectionResult.ok ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-destructive/40 bg-destructive/5'}`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium text-sm">{lastConnectionResult.ok ? 'Connexion validée' : 'Connexion en erreur'}</div>
                  <p className="text-sm text-muted-foreground mt-1">{lastConnectionResult.message}</p>
                </div>
                <Badge variant={lastConnectionResult.ok ? 'default' : 'destructive'}>
                  {lastConnectionResult.ok ? 'OK' : 'KO'}
                </Badge>
              </div>
              {lastConnectionResult.tokenPreview ? (
                <p className="text-xs text-muted-foreground mt-3">Token: {lastConnectionResult.tokenPreview}</p>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium text-sm mt-1">{value}</div>
    </div>
  );
}

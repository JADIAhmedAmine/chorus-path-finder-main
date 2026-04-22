import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useReferenceCatalog } from '@/hooks/use-reference-catalog';
import { createChorusConnector } from '@/lib/chorus/client';
import { loadAuthSession } from '@/lib/auth/session';
import { loadChorusConfig, maskSecret, resolveChorusRuntimeConfig, saveChorusConfig } from '@/lib/chorus/storage';
import type { ChorusConfig, ChorusConnectionResult, ChorusTechnicalContextResolutionResult } from '@/types/chorus';
import { Loader2, PlugZap } from 'lucide-react';

const connectorModeLabels = {
  mock: 'Mock / démonstration',
  direct: 'Connexion directe (dev uniquement)',
} as const;

const connectionMethodLabels = {
  GET: 'GET',
  POST: 'POST',
} as const;

const paymentModeLabels = {
  CHEQUE: 'CHEQUE',
  ESPECE: 'ESPECE',
  VIREMENT: 'VIREMENT',
  PRELEVEMENT: 'PRELEVEMENT',
  AUTRE: 'AUTRE',
  REPORT: 'REPORT',
} as const;

const invoiceTypeLabels = {
  FACTURE: 'FACTURE',
  AVOIR: 'AVOIR',
} as const;

const vatTypeLabels = {
  AUTO: 'AUTO',
  TVA_SUR_DEBIT: 'TVA_SUR_DEBIT',
  TVA_SUR_ENCAISSEMENT: 'TVA_SUR_ENCAISSEMENT',
  EXONERATION: 'EXONERATION',
  SANS_TVA: 'SANS_TVA',
} as const;

export default function SettingsPage() {
  const { toast } = useToast();
  const authSession = loadAuthSession();
  const [config, setConfig] = useState<ChorusConfig>(() => loadChorusConfig());
  const [testingConnection, setTestingConnection] = useState(false);
  const [lastConnectionResult, setLastConnectionResult] = useState<ChorusConnectionResult | null>(null);
  const [resolvingTechnicalContext, setResolvingTechnicalContext] = useState(false);
  const [lastTechnicalContextResult, setLastTechnicalContextResult] = useState<ChorusTechnicalContextResolutionResult | null>(null);
  const [technicalContextEmail, setTechnicalContextEmail] = useState(authSession?.email ?? '');
  const [technicalContextSupplierId, setTechnicalContextSupplierId] = useState('');
  const { suppliers, loading: loadingReferenceSuppliers, error: referenceSuppliersError } = useReferenceCatalog(config, {
    includeSuppliers: true,
    includePublicCustomers: false,
    includePublicServices: false,
    includeAnnuaire: false,
  });

  const connectorStatus = useMemo(() => {
    if (!config.enabled) {
      return 'Désactivé';
    }

    return config.mode === 'mock' ? 'Simulation active' : 'Prêt pour test réel';
  }, [config.enabled, config.mode]);
  const userApisRequireProductionAccess = useMemo(() => {
    const userPaths = `${config.userAccountPath} ${config.userConnectionsPath}`.toLowerCase();
    return userPaths.includes('service-qualif') || userPaths.includes('sandbox');
  }, [config.userAccountPath, config.userConnectionsPath]);

  const selectedSupplierForTechnicalContext = useMemo(
    () => suppliers.find((supplier) => supplier.id === technicalContextSupplierId),
    [technicalContextSupplierId],
  );

  const handleFieldChange = <K extends keyof ChorusConfig>(field: K, value: ChorusConfig[K]) => {
    setConfig((previous) => {
      const nextConfig = {
        ...previous,
        [field]: value,
      };

      saveChorusConfig(nextConfig);
      return nextConfig;
    });
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
      const connector = createChorusConnector(resolveChorusRuntimeConfig(config));
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

  const handleResolveTechnicalContext = async () => {
    setResolvingTechnicalContext(true);
    setLastTechnicalContextResult(null);

    try {
      const connector = createChorusConnector(resolveChorusRuntimeConfig(config));
      const result = await connector.resolveTechnicalContext({
        userEmail: technicalContextEmail.trim() || undefined,
        supplierSiret: selectedSupplierForTechnicalContext?.siret,
      });

      const nextConfig: ChorusConfig = {
        ...config,
        submissionCurrentUserId: result.userId !== undefined ? String(result.userId) : config.submissionCurrentUserId,
        submissionSupplierId: result.supplierStructureId !== undefined ? String(result.supplierStructureId) : config.submissionSupplierId,
        submissionSupplierServiceId: result.supplierServiceId !== undefined ? String(result.supplierServiceId) : config.submissionSupplierServiceId,
      };

      setConfig(nextConfig);
      saveChorusConfig(nextConfig);
      setLastTechnicalContextResult(result);

      toast({
        title: 'Contexte Chorus récupéré',
        description: result.message,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue';
      toast({
        title: 'Échec récupération contexte',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setResolvingTechnicalContext(false);
    }
  };

  return (
    <div className="max-w-5xl space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold">Paramètres</h1>
        <p className="text-sm text-muted-foreground">Configuration de l'organisation, de l'utilisateur et du connecteur Chorus Pro</p>
      </div>

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
              <Input id="upload-file-path" value={config.uploadFilePath} onChange={(e) => handleFieldChange('uploadFilePath', e.target.value)} placeholder="/v1/ajouter/fichier" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="submit-invoice-path">Endpoint soumission facture</Label>
              <Input id="submit-invoice-path" value={config.submitInvoicePath} onChange={(e) => handleFieldChange('submitInvoicePath', e.target.value)} placeholder="/factures/soumettre" />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="submission-bridge-url">Endpoint backend Python de soumission</Label>
              <Input
                id="submission-bridge-url"
                value={config.submissionBridgeUrl}
                onChange={(e) => handleFieldChange('submissionBridgeUrl', e.target.value)}
                placeholder="http://127.0.0.1:8008/api/chorus/submit"
              />
              <p className="text-xs text-muted-foreground">
                Si renseigné, l&apos;interface délègue l&apos;upload PDF et la soumission à `chorus_python` au lieu d&apos;appeler Chorus directement depuis le navigateur.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reference-api-base-url">Base API référentiels</Label>
              <Input
                id="reference-api-base-url"
                value={config.referenceApiBaseUrl}
                onChange={(e) => handleFieldChange('referenceApiBaseUrl', e.target.value)}
                placeholder="https://mon-backend/api"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="reference-suppliers-path">Endpoint fournisseurs</Label>
              <Input
                id="reference-suppliers-path"
                value={config.referenceSuppliersPath}
                onChange={(e) => handleFieldChange('referenceSuppliersPath', e.target.value)}
                placeholder="/references/suppliers"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="reference-public-customers-path">Endpoint clients publics</Label>
              <Input
                id="reference-public-customers-path"
                value={config.referencePublicCustomersPath}
                onChange={(e) => handleFieldChange('referencePublicCustomersPath', e.target.value)}
                placeholder="/references/public-customers"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="reference-public-services-path">Endpoint services publics</Label>
              <Input
                id="reference-public-services-path"
                value={config.referencePublicServicesPath}
                onChange={(e) => handleFieldChange('referencePublicServicesPath', e.target.value)}
                placeholder="/references/public-services"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="reference-annuaire-json-url">Annuaire JSON normalisé</Label>
              <Input
                id="reference-annuaire-json-url"
                value={config.referenceAnnuaireJsonUrl}
                onChange={(e) => handleFieldChange('referenceAnnuaireJsonUrl', e.target.value)}
                placeholder="/annuaire/annuaire.normalized.json"
              />
              <p className="text-xs text-muted-foreground">
                Source recommandée pour charger rapidement l&apos;annuaire Chorus déjà converti en JSON.
              </p>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="reference-annuaire-xml-url">Annuaire XML Chorus</Label>
              <Input
                id="reference-annuaire-xml-url"
                value={config.referenceAnnuaireXmlUrl}
                onChange={(e) => handleFieldChange('referenceAnnuaireXmlUrl', e.target.value)}
                placeholder="/annuaire/FAR..."
              />
              <p className="text-xs text-muted-foreground">
                Fallback XML si le JSON normalisé n&apos;est pas encore disponible.
              </p>
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium">Contexte technique Chorus</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Ces identifiants ne viennent pas du PDF. Ils servent a construire le JSON minimal exact pour `ajouter/fichier` puis `soumettre`.
              </p>
            </div>

            <div className="rounded-lg border bg-muted/20 p-4 space-y-4">
              <div>
                <p className="text-sm font-medium">Récupération automatique via API utilisateurs</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Cette action appelle `consulter/compte` pour `idUtilisateurCourant` et `monCompte/recuperer/rattachements` pour `idStructure` / `idService`.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="technical-context-email">Email utilisateur Chorus</Label>
                  <Input
                    id="technical-context-email"
                    value={technicalContextEmail}
                    onChange={(e) => setTechnicalContextEmail(e.target.value)}
                    placeholder="adresse email de connexion Chorus"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Fournisseur à rapprocher</Label>
                  <Select value={technicalContextSupplierId} onValueChange={setTechnicalContextSupplierId}>
                    <SelectTrigger><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
                    <SelectContent>
                      {suppliers.filter((supplier) => supplier.active).map((supplier) => (
                        <SelectItem key={supplier.id} value={supplier.id}>
                          {supplier.legalName} ({supplier.siret})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {loadingReferenceSuppliers && (
                <p className="text-xs text-muted-foreground">
                  Chargement des fournisseurs depuis l’API de référentiel…
                </p>
              )}

              {referenceSuppliersError && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  {referenceSuppliersError}
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  onClick={handleResolveTechnicalContext}
                  disabled={resolvingTechnicalContext || userApisRequireProductionAccess}
                >
                  {resolvingTechnicalContext ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Récupérer depuis Chorus
                </Button>
              </div>

              {userApisRequireProductionAccess && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
                  <p className="font-medium">API utilisateurs non exploitable dans cette configuration</p>
                  <p className="mt-1 text-muted-foreground">
                    Les endpoints configurés pointent vers la qualification / sandbox. Dans ton contexte actuel, la récupération automatique
                    via `consulter/compte` et `monCompte/recuperer/rattachements` doit être considérée comme indisponible.
                    Renseigne donc `idUtilisateurCourant`, `idFournisseur` et `idServiceFournisseur` manuellement dans ce bloc.
                  </p>
                </div>
              )}

              {lastTechnicalContextResult && (
                <div className="rounded-lg border bg-background p-4 text-sm space-y-2">
                  <p className="font-medium">{lastTechnicalContextResult.message}</p>
                  <p className="text-muted-foreground">
                    `idUtilisateurCourant`: {lastTechnicalContextResult.userId ?? 'non trouvé'} ·
                    `idFournisseur`: {lastTechnicalContextResult.supplierStructureId ?? 'non trouvé'} ·
                    `idServiceFournisseur`: {lastTechnicalContextResult.supplierServiceId ?? 'non trouvé'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Le rapprochement du fournisseur par SIRET est {lastTechnicalContextResult.matchedOnSupplierSiret ? 'réussi' : 'approximatif'}.
                  </p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="submission-current-user-id">idUtilisateurCourant</Label>
                <Input id="submission-current-user-id" value={config.submissionCurrentUserId} onChange={(e) => handleFieldChange('submissionCurrentUserId', e.target.value)} placeholder="331" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="submission-supplier-id">idFournisseur</Label>
                <Input id="submission-supplier-id" value={config.submissionSupplierId} onChange={(e) => handleFieldChange('submissionSupplierId', e.target.value)} placeholder="160" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="submission-supplier-service-id">idServiceFournisseur</Label>
                <Input id="submission-supplier-service-id" value={config.submissionSupplierServiceId} onChange={(e) => handleFieldChange('submissionSupplierServiceId', e.target.value)} placeholder="436" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="submission-bank-account-code">codeCoordonneesBancairesFournisseur</Label>
                <Input id="submission-bank-account-code" value={config.submissionBankAccountCode} onChange={(e) => handleFieldChange('submissionBankAccountCode', e.target.value)} placeholder="132" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="submission-cadre-code">codeCadreFacturation</Label>
                <Input id="submission-cadre-code" value={config.submissionCadreCode} onChange={(e) => handleFieldChange('submissionCadreCode', e.target.value)} placeholder="A1_FACTURE_FOURNISSEUR" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="submission-validator-structure-code">codeStructureValideur</Label>
                <Input id="submission-validator-structure-code" value={config.submissionValidatorStructureCode} onChange={(e) => handleFieldChange('submissionValidatorStructureCode', e.target.value)} placeholder="Optionnel" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="submission-validator-service-code">codeServiceValideur</Label>
                <Input id="submission-validator-service-code" value={config.submissionValidatorServiceCode} onChange={(e) => handleFieldChange('submissionValidatorServiceCode', e.target.value)} placeholder="Optionnel" />
              </div>

              <div className="space-y-2">
                <Label>Mode de paiement</Label>
                <Select value={config.submissionPaymentMode} onValueChange={(value: ChorusConfig['submissionPaymentMode']) => handleFieldChange('submissionPaymentMode', value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CHEQUE">{paymentModeLabels.CHEQUE}</SelectItem>
                    <SelectItem value="ESPECE">{paymentModeLabels.ESPECE}</SelectItem>
                    <SelectItem value="VIREMENT">{paymentModeLabels.VIREMENT}</SelectItem>
                    <SelectItem value="PRELEVEMENT">{paymentModeLabels.PRELEVEMENT}</SelectItem>
                    <SelectItem value="AUTRE">{paymentModeLabels.AUTRE}</SelectItem>
                    <SelectItem value="REPORT">{paymentModeLabels.REPORT}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Type de facture</Label>
                <Select value={config.submissionInvoiceType} onValueChange={(value: ChorusConfig['submissionInvoiceType']) => handleFieldChange('submissionInvoiceType', value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FACTURE">{invoiceTypeLabels.FACTURE}</SelectItem>
                    <SelectItem value="AVOIR">{invoiceTypeLabels.AVOIR}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Type TVA</Label>
                <Select value={config.submissionVatType} onValueChange={(value: ChorusConfig['submissionVatType']) => handleFieldChange('submissionVatType', value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AUTO">{vatTypeLabels.AUTO}</SelectItem>
                    <SelectItem value="TVA_SUR_DEBIT">{vatTypeLabels.TVA_SUR_DEBIT}</SelectItem>
                    <SelectItem value="TVA_SUR_ENCAISSEMENT">{vatTypeLabels.TVA_SUR_ENCAISSEMENT}</SelectItem>
                    <SelectItem value="EXONERATION">{vatTypeLabels.EXONERATION}</SelectItem>
                    <SelectItem value="SANS_TVA">{vatTypeLabels.SANS_TVA}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="submission-vat-exoneration-reason">motifExonerationTva</Label>
                <Input id="submission-vat-exoneration-reason" value={config.submissionVatExonerationReason} onChange={(e) => handleFieldChange('submissionVatExonerationReason', e.target.value)} placeholder="Seulement si EXONERATION" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="submission-original-invoice-number">numeroFactureOrigine</Label>
                <Input id="submission-original-invoice-number" value={config.submissionOriginalInvoiceNumber} onChange={(e) => handleFieldChange('submissionOriginalInvoiceNumber', e.target.value)} placeholder="Pour un avoir" />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="submission-comment">commentaire</Label>
                <Input id="submission-comment" value={config.submissionComment} onChange={(e) => handleFieldChange('submissionComment', e.target.value)} placeholder="Optionnel" />
              </div>
            </div>
          </div>

          <Separator />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <InfoTile label="Mode" value={connectorModeLabels[config.mode]} />
            <InfoTile label="Statut" value={connectorStatus} />
            <InfoTile label="Client secret" value={maskSecret(config.clientSecret)} />
          </div>

          <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
            Les champs de cette page sont autosauvegardés localement dès la saisie. Le bouton `Enregistrer la configuration` reste disponible comme action explicite de confirmation.
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

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium text-sm mt-1">{value}</div>
    </div>
  );
}

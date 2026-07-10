import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { PageHeader } from '@/components/common/PageHeader';
import { authenticatedFetch, loadAuthSession } from '@/lib/auth/session';
import {
  DEFAULT_BRANDING,
  DEFAULT_PRIMARY_HEX,
  commitBranding,
  getAppLogoUrl,
  getBranding,
} from '@/lib/branding';
import { createChorusConnector } from '@/lib/chorus/client';
import { applyEnvironmentPreset, loadChorusConfig, resolveChorusRuntimeConfig } from '@/lib/chorus/storage';
import type { ChorusConnectionResult, ChorusEnvironment } from '@/types/chorus';
import { Building2, Image as ImageIcon, KeyRound, Loader2, Palette, PlugZap, ShieldCheck, Trash2 } from 'lucide-react';

type CredentialField = 'clientId' | 'clientSecret' | 'technicalLogin' | 'technicalPassword';
type CredentialSource = 'file' | 'env' | 'missing';
type CredentialsStatus = Record<string, Record<CredentialField, CredentialSource>>;

const credentialFieldLabels: Record<CredentialField, string> = {
  clientId: 'PISTE — client_id',
  clientSecret: 'PISTE — client_secret',
  technicalLogin: 'Chorus Pro — login du compte technique',
  technicalPassword: 'Chorus Pro — mot de passe du compte technique',
};

const credentialSourceLabels: Record<CredentialSource, string> = {
  file: "Configuré via l'interface",
  env: 'Configuré côté serveur (.env)',
  missing: 'Non configuré',
};

const environmentLabels: Record<ChorusEnvironment, string> = {
  qualif: 'Qualification (sandbox PISTE)',
  prod: 'Production (PISTE)',
};

const emptyCredentialsDraft = {
  clientId: '',
  clientSecret: '',
  technicalLogin: '',
  technicalPassword: '',
};

export default function OrganizationSetupPage() {
  const { toast } = useToast();
  const session = loadAuthSession();
  const isAdmin = session?.roleCode?.trim().toUpperCase() === 'ADMINISTRATEUR';

  // --- Marque blanche ---
  const [appName, setAppName] = useState(() => getBranding().appName);
  const [appTagline, setAppTagline] = useState(() => getBranding().appTagline);
  const [primaryColor, setPrimaryColor] = useState(() => getBranding().primaryColor || DEFAULT_PRIMARY_HEX);
  const [useCustomColor, setUseCustomColor] = useState(() => Boolean(getBranding().primaryColor));
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoVersion, setLogoVersion] = useState(0);
  const [savingBranding, setSavingBranding] = useState(false);
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  const logoPreviewUrl = useMemo(
    () => (logoFile ? URL.createObjectURL(logoFile) : getAppLogoUrl()),
    // logoVersion force le rafraîchissement de l'aperçu après upload/suppression
    [logoFile, logoVersion],
  );
  useEffect(() => {
    if (!logoFile) return;
    const url = logoPreviewUrl;
    return () => URL.revokeObjectURL(url);
  }, [logoFile, logoPreviewUrl]);

  // --- Identifiants techniques ---
  const [credsEnv, setCredsEnv] = useState<ChorusEnvironment>(() => loadChorusConfig().environment ?? 'qualif');
  const [credsDraft, setCredsDraft] = useState({ ...emptyCredentialsDraft });
  const [credsStatus, setCredsStatus] = useState<CredentialsStatus | null>(null);
  const [savingCreds, setSavingCreds] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionResult, setConnectionResult] = useState<ChorusConnectionResult | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    void refreshCredentialsStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  async function refreshCredentialsStatus() {
    try {
      const response = await authenticatedFetch('/api/admin/chorus-credentials', {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return;
      const body = await response.json();
      setCredsStatus(body?.environments ?? null);
    } catch {
      setCredsStatus(null);
    }
  }

  const handleSaveBranding = async () => {
    setSavingBranding(true);
    try {
      if (logoFile) {
        const form = new FormData();
        form.append('file', logoFile);
        const upload = await authenticatedFetch('/api/admin/branding/logo', { method: 'POST', body: form });
        if (!upload.ok) {
          const body = await upload.json().catch(() => ({}));
          throw new Error(typeof body?.detail === 'string' ? body.detail : 'Échec du téléversement du logo.');
        }
      }

      const response = await authenticatedFetch('/api/admin/branding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          appName,
          appTagline,
          primaryColor: useCustomColor ? primaryColor : '',
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body?.detail === 'string' ? body.detail : "Échec de l'enregistrement de la marque.");
      }

      commitBranding(await response.json());
      setLogoFile(null);
      if (logoInputRef.current) logoInputRef.current.value = '';
      setLogoVersion((version) => version + 1);
      toast({
        title: 'Marque enregistrée',
        description: 'Nom, couleurs et logo sont appliqués pour tous les utilisateurs.',
      });
    } catch (error) {
      toast({
        title: 'Échec enregistrement marque',
        description: error instanceof Error ? error.message : 'Erreur inconnue.',
        variant: 'destructive',
      });
    } finally {
      setSavingBranding(false);
    }
  };

  const handleResetBranding = async () => {
    setSavingBranding(true);
    try {
      await authenticatedFetch('/api/admin/branding/logo', { method: 'DELETE' });
      const response = await authenticatedFetch('/api/admin/branding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          appName: DEFAULT_BRANDING.appName,
          appTagline: DEFAULT_BRANDING.appTagline,
          primaryColor: '',
        }),
      });
      if (!response.ok) throw new Error('Réinitialisation impossible.');

      const branding = commitBranding(await response.json());
      setAppName(branding.appName);
      setAppTagline(branding.appTagline);
      setPrimaryColor(DEFAULT_PRIMARY_HEX);
      setUseCustomColor(false);
      setLogoFile(null);
      if (logoInputRef.current) logoInputRef.current.value = '';
      setLogoVersion((version) => version + 1);
      toast({ title: 'Marque réinitialisée', description: 'Retour à l’apparence par défaut.' });
    } catch (error) {
      toast({
        title: 'Échec réinitialisation',
        description: error instanceof Error ? error.message : 'Erreur inconnue.',
        variant: 'destructive',
      });
    } finally {
      setSavingBranding(false);
    }
  };

  const handleSaveCredentials = async () => {
    const hasValue = Object.values(credsDraft).some((value) => value.trim());
    if (!hasValue) {
      toast({
        title: 'Aucun identifiant saisi',
        description: 'Renseigne au moins un champ à mettre à jour.',
        variant: 'destructive',
      });
      return;
    }

    setSavingCreds(true);
    try {
      const response = await authenticatedFetch('/api/admin/chorus-credentials', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ environment: credsEnv, ...credsDraft }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body?.detail === 'string' ? body.detail : "Échec de l'enregistrement des identifiants.");
      }

      const body = await response.json();
      setCredsStatus(body?.environments ?? null);
      setCredsDraft({ ...emptyCredentialsDraft });
      toast({
        title: 'Identifiants enregistrés',
        description: `Stockés côté serveur pour l'environnement ${environmentLabels[credsEnv]}. Lance un test de connexion pour valider.`,
      });
    } catch (error) {
      toast({
        title: 'Échec enregistrement identifiants',
        description: error instanceof Error ? error.message : 'Erreur inconnue.',
        variant: 'destructive',
      });
    } finally {
      setSavingCreds(false);
    }
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setConnectionResult(null);
    try {
      const config = applyEnvironmentPreset(loadChorusConfig(), credsEnv);
      const connector = createChorusConnector(resolveChorusRuntimeConfig(config));
      const result = await connector.testConnection();
      setConnectionResult(result);
      toast({ title: 'Connexion Chorus validée', description: result.message });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue';
      setConnectionResult({ ok: false, message });
      toast({ title: 'Échec de connexion', description: message, variant: 'destructive' });
    } finally {
      setTestingConnection(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="max-w-3xl space-y-6 animate-fade-in">
        <PageHeader
          eyebrow={<><Building2 className="h-3 w-3" /> Organisation</>}
          title="Mon organisation"
          description="Configuration de la marque et des accès techniques Chorus Pro."
        />
        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertDescription>
            Cette page est réservée aux administrateurs. Contacte l&apos;administrateur de la plateforme pour
            modifier la marque ou les identifiants techniques.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const envStatus = credsStatus?.[credsEnv] ?? null;

  return (
    <div className="max-w-5xl space-y-7 animate-fade-in">
      <PageHeader
        eyebrow={<><Building2 className="h-3 w-3" /> Organisation</>}
        title="Mon organisation"
        description="Personnalise l'application aux couleurs de ton entité et renseigne les accès techniques PISTE / Chorus Pro. Tout est stocké côté serveur : aucun secret ne transite par le navigateur des utilisateurs."
      />

      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Palette className="h-4 w-4" />
            Identité &amp; apparence (marque blanche)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="branding-app-name">Nom de l&apos;application</Label>
              <Input
                id="branding-app-name"
                value={appName}
                maxLength={80}
                onChange={(event) => setAppName(event.target.value)}
                placeholder="Ex. Factures Publiques — Mairie de X"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="branding-tagline">Slogan / sous-titre</Label>
              <Input
                id="branding-tagline"
                value={appTagline}
                maxLength={160}
                onChange={(event) => setAppTagline(event.target.value)}
                placeholder="Affiché sur l'écran de connexion"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="branding-color">Couleur principale</Label>
              <div className="flex items-center gap-3">
                <Input
                  id="branding-color"
                  type="color"
                  className="h-10 w-16 cursor-pointer p-1"
                  value={primaryColor}
                  onChange={(event) => {
                    setPrimaryColor(event.target.value);
                    setUseCustomColor(true);
                  }}
                />
                <Input
                  className="w-32 font-mono"
                  value={primaryColor}
                  onChange={(event) => {
                    setPrimaryColor(event.target.value);
                    setUseCustomColor(true);
                  }}
                  placeholder="#1d4fd7"
                />
                {useCustomColor && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setUseCustomColor(false);
                      setPrimaryColor(DEFAULT_PRIMARY_HEX);
                    }}
                  >
                    Couleur par défaut
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Boutons, liens et éléments actifs de l&apos;interface (thèmes clair et sombre dérivés automatiquement).
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="branding-logo">Logo</Label>
              <div className="flex items-center gap-4">
                <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-muted/30">
                  {logoPreviewUrl ? (
                    <img src={logoPreviewUrl} alt="Aperçu du logo" className="h-full w-full object-contain" />
                  ) : (
                    <ImageIcon className="h-6 w-6 text-muted-foreground" />
                  )}
                </span>
                <div className="flex-1 space-y-1">
                  <Input
                    id="branding-logo"
                    ref={logoInputRef}
                    type="file"
                    accept=".svg,.png,.jpg,.jpeg,.webp,.ico"
                    onChange={(event) => setLogoFile(event.target.files?.[0] ?? null)}
                  />
                  <p className="text-xs text-muted-foreground">SVG, PNG, JPG ou WEBP — 2 Mo max.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button onClick={handleSaveBranding} disabled={savingBranding}>
              {savingBranding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Enregistrer l&apos;apparence
            </Button>
            <Button variant="outline" onClick={handleResetBranding} disabled={savingBranding}>
              <Trash2 className="mr-2 h-4 w-4" />
              Réinitialiser (marque par défaut)
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            Accès techniques PISTE &amp; compte technique Chorus Pro
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground space-y-2">
            <p>
              <span className="font-medium text-foreground">1. PISTE</span> — crée une application sur{' '}
              <a href="https://piste.gouv.fr" target="_blank" rel="noreferrer" className="underline underline-offset-2">
                piste.gouv.fr
              </a>{' '}
              et souscris à l&apos;API « Factures » Chorus Pro pour obtenir le <code className="font-mono">client_id</code> et le{' '}
              <code className="font-mono">client_secret</code> OAuth2.
            </p>
            <p>
              <span className="font-medium text-foreground">2. Chorus Pro</span> — dans{' '}
              <a href="https://portail.chorus-pro.gouv.fr" target="_blank" rel="noreferrer" className="underline underline-offset-2">
                portail.chorus-pro.gouv.fr
              </a>
              , déclare un compte technique (raccordement API) rattaché à ta structure : c&apos;est le couple login / mot de
              passe technique demandé ci-dessous.
            </p>
            <p>
              Les valeurs saisies sont chiffrées en transit et stockées côté serveur avec des permissions restreintes.
              Elles priment sur les variables d&apos;environnement du serveur.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2 md:col-span-2">
              <Label>Environnement concerné</Label>
              <Select value={credsEnv} onValueChange={(value: ChorusEnvironment) => { setCredsEnv(value); setConnectionResult(null); }}>
                <SelectTrigger className="md:w-1/2"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="qualif">{environmentLabels.qualif}</SelectItem>
                  <SelectItem value="prod">{environmentLabels.prod}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(Object.keys(credentialFieldLabels) as CredentialField[]).map((field) => (
              <div key={field} className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor={`cred-${field}`}>{credentialFieldLabels[field]}</Label>
                  {envStatus ? (
                    <Badge variant={envStatus[field] === 'missing' ? 'destructive' : 'secondary'} className="shrink-0 font-normal">
                      {credentialSourceLabels[envStatus[field]]}
                    </Badge>
                  ) : null}
                </div>
                <Input
                  id={`cred-${field}`}
                  type={field === 'clientSecret' || field === 'technicalPassword' ? 'password' : 'text'}
                  autoComplete="off"
                  value={credsDraft[field]}
                  onChange={(event) => setCredsDraft((draft) => ({ ...draft, [field]: event.target.value }))}
                  placeholder={envStatus && envStatus[field] !== 'missing' ? 'Laisser vide pour conserver la valeur actuelle' : ''}
                />
              </div>
            ))}
          </div>

          <Separator />

          <div className="flex flex-wrap gap-3">
            <Button onClick={handleSaveCredentials} disabled={savingCreds}>
              {savingCreds ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Enregistrer les identifiants
            </Button>
            <Button variant="outline" onClick={handleTestConnection} disabled={testingConnection}>
              {testingConnection ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlugZap className="mr-2 h-4 w-4" />}
              Tester la connexion
            </Button>
          </div>

          {connectionResult && (
            <div className={`rounded-lg border p-4 ${connectionResult.ok ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-destructive/40 bg-destructive/5'}`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium text-sm">{connectionResult.ok ? 'Connexion validée' : 'Connexion en erreur'}</div>
                  <p className="text-sm text-muted-foreground mt-1">{connectionResult.message}</p>
                </div>
                <Badge variant={connectionResult.ok ? 'default' : 'destructive'}>{connectionResult.ok ? 'OK' : 'KO'}</Badge>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

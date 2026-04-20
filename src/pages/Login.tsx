import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { getCurrentUser } from '@/data/mock-data';
import { loadAuthSession, saveAuthSession, syncAuthSessionToChorusConfig } from '@/lib/auth/session';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { Shield } from 'lucide-react';

export default function Login() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [existingSession] = useState(() => loadAuthSession());
  const { data: currentUser, error: currentUserError } = useAsyncResource(
    () => getCurrentUser(),
    [],
    {
      id: 'user-unresolved',
      tenantId: 'tenant-unresolved',
      email: existingSession?.email ?? '',
      firstName: existingSession?.firstName ?? '',
      lastName: existingSession?.lastName ?? '',
      roleCode: existingSession?.roleCode === 'DEPOSANT' || existingSession?.roleCode === 'ADMINISTRATEUR' || existingSession?.roleCode === 'AUDITEUR'
        ? existingSession.roleCode
        : 'GESTIONNAIRE',
      active: true,
      createdAt: existingSession?.createdAt ?? new Date(0).toISOString(),
      updatedAt: existingSession?.createdAt ?? new Date(0).toISOString(),
    },
  );
  const [email, setEmail] = useState(existingSession?.email ?? '');
  const [firstName, setFirstName] = useState(existingSession?.firstName ?? '');
  const [lastName, setLastName] = useState(existingSession?.lastName ?? '');
  const [password, setPassword] = useState('password');
  const [chorusCurrentUserId, setChorusCurrentUserId] = useState('');
  const [chorusSupplierId, setChorusSupplierId] = useState('');
  const [chorusSupplierServiceId, setChorusSupplierServiceId] = useState('');
  const [chorusBankAccountCode, setChorusBankAccountCode] = useState('');

  useEffect(() => {
    if (!existingSession) {
      setEmail((value) => value || currentUser.email);
      setFirstName((value) => value || currentUser.firstName);
      setLastName((value) => value || currentUser.lastName);
      return;
    }

    setEmail(existingSession.email);
    setFirstName(existingSession.firstName);
    setLastName(existingSession.lastName);
    setChorusCurrentUserId(existingSession.chorusCurrentUserId ?? '');
    setChorusSupplierId(existingSession.chorusSupplierId ?? '');
    setChorusSupplierServiceId(existingSession.chorusSupplierServiceId ?? '');
    setChorusBankAccountCode(existingSession.chorusBankAccountCode ?? '');
  }, [existingSession]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();

    const session = {
      email: email.trim(),
      firstName: firstName.trim() || currentUser.firstName,
      lastName: lastName.trim() || currentUser.lastName,
      roleCode: currentUser.roleCode,
      chorusCurrentUserId: chorusCurrentUserId.trim() || undefined,
      chorusSupplierId: chorusSupplierId.trim() || undefined,
      chorusSupplierServiceId: chorusSupplierServiceId.trim() || undefined,
      chorusBankAccountCode: chorusBankAccountCode.trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    saveAuthSession(session);
    syncAuthSessionToChorusConfig(session);
    toast({
      title: existingSession ? 'Profil mis à jour' : 'Session ouverte',
      description: 'La session locale et les identifiants Chorus utiles ont ete enregistres.',
    });
    navigate('/', { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center">
              <Shield className="h-7 w-7 text-primary-foreground" />
            </div>
          </div>
          <div>
            <CardTitle className="text-xl">FacturX Pro</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {existingSession ? 'Mettre à jour la session locale et le contexte Chorus' : 'Connexion locale et contexte utile au flux Chorus'}
            </p>
          </div>
        </CardHeader>
        <CardContent>
          {currentUserError && (
            <Alert className="mb-4">
              <AlertDescription>
                Le profil utilisateur n&apos;a pas pu être chargé depuis le backend. Le formulaire reste utilisable avec la session locale.
              </AlertDescription>
            </Alert>
          )}
          {existingSession && (
            <div className="mb-4 rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
              Une session est déjà active. Tu peux modifier ici ton profil local et les identifiants Chorus utiles, puis enregistrer.
            </div>
          )}
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="first-name">Prénom</Label>
                <Input id="first-name" value={firstName} onChange={e => setFirstName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="last-name">Nom</Label>
                <Input id="last-name" value={lastName} onChange={e => setLastName(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Mot de passe</Label>
              <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} />
            </div>

            <div className="rounded-lg border bg-muted/20 p-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Infos utiles pour Chorus</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Optionnel mais pratique pour pre-remplir la soumission reelle dans la sandbox.
                  </p>
                </div>
                <Badge variant="secondary">Sandbox</Badge>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="chorus-current-user-id">idUtilisateurCourant</Label>
                  <Input id="chorus-current-user-id" value={chorusCurrentUserId} onChange={e => setChorusCurrentUserId(e.target.value)} placeholder="331" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="chorus-supplier-id">idFournisseur</Label>
                  <Input id="chorus-supplier-id" value={chorusSupplierId} onChange={e => setChorusSupplierId(e.target.value)} placeholder="160" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="chorus-supplier-service-id">idServiceFournisseur</Label>
                  <Input id="chorus-supplier-service-id" value={chorusSupplierServiceId} onChange={e => setChorusSupplierServiceId(e.target.value)} placeholder="436" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="chorus-bank-account-code">codeCoordonneesBancairesFournisseur</Label>
                  <Input id="chorus-bank-account-code" value={chorusBankAccountCode} onChange={e => setChorusBankAccountCode(e.target.value)} placeholder="132" />
                </div>
              </div>
            </div>

            <Button type="submit" className="w-full">
              {existingSession ? 'Mettre à jour la session' : 'Se connecter'}
            </Button>
          </form>
          <p className="text-xs text-muted-foreground text-center mt-4">
            Environnement de démonstration — connexion simulée, session locale persistée dans le navigateur.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { loadAuthSession, saveAuthSession, syncAuthSessionToChorusConfig } from '@/lib/auth/session';
import { useToast } from '@/hooks/use-toast';
import { APP_NAME, AppSymbol } from '@/components/common/AppSymbol';

export default function Login() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [existingSession] = useState(() => loadAuthSession());
  const [email, setEmail] = useState(existingSession?.email ?? '');
  const [password, setPassword] = useState('');

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedEmail = email.trim();
    const [namePart] = normalizedEmail.split('@');

    const session = {
      email: normalizedEmail,
      firstName: existingSession?.firstName || namePart || 'Utilisateur',
      lastName: existingSession?.lastName || '',
      roleCode: existingSession?.roleCode || 'GESTIONNAIRE',
      chorusCurrentUserId: existingSession?.chorusCurrentUserId,
      chorusSupplierId: existingSession?.chorusSupplierId,
      chorusSupplierServiceId: existingSession?.chorusSupplierServiceId,
      chorusBankAccountCode: existingSession?.chorusBankAccountCode,
      createdAt: existingSession?.createdAt || new Date().toISOString(),
    };

    saveAuthSession(session);
    syncAuthSessionToChorusConfig(session);
    toast({
      title: 'Session ouverte',
      description: 'Connexion locale activée pour cette session pré-production.',
    });
    navigate('/', { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-4">
          <div className="flex justify-center">
            <AppSymbol className="h-12 w-12 rounded-xl" />
          </div>
          <div>
            <CardTitle className="text-xl">{APP_NAME}</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Connexion pré-production
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Mot de passe</Label>
              <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" />
            </div>

            <Button type="submit" className="w-full">
              Se connecter
            </Button>
          </form>
          <p className="text-xs text-muted-foreground text-center mt-4">
            Accès préliminaire avec session locale.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

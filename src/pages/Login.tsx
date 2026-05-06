import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2 } from 'lucide-react';
import { loadAuthSession, saveAuthSession, syncAuthSessionToChorusConfig } from '@/lib/auth/session';
import { useToast } from '@/hooks/use-toast';
import { APP_NAME, APP_TAGLINE, AppSymbol } from '@/components/common/AppSymbol';

interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  email: string;
}

export default function Login() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [existingSession] = useState(() => loadAuthSession());
  const [email, setEmail] = useState(existingSession?.email ?? '');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const detail = typeof body?.detail === 'string' ? body.detail : 'Email ou mot de passe invalide.';
        setError(detail);
        return;
      }

      const data = (await response.json()) as LoginResponse;
      const normalizedEmail = data.email.trim();
      const [namePart] = normalizedEmail.split('@');
      const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

      const session = {
        email: normalizedEmail,
        firstName: existingSession?.firstName || namePart || 'Utilisateur',
        lastName: existingSession?.lastName || '',
        roleCode: existingSession?.roleCode || 'GESTIONNAIRE',
        chorusCurrentUserId: existingSession?.chorusCurrentUserId,
        chorusSupplierId: existingSession?.chorusSupplierId,
        chorusSupplierServiceId: existingSession?.chorusSupplierServiceId,
        chorusBankAccountCode: existingSession?.chorusBankAccountCode,
        accessToken: data.access_token,
        expiresAt,
        createdAt: existingSession?.createdAt || new Date().toISOString(),
      };

      saveAuthSession(session);
      syncAuthSessionToChorusConfig(session);
      toast({
        title: 'Session ouverte',
        description: `Connecté en tant que ${normalizedEmail}.`,
      });
      navigate('/', { replace: true });
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Connexion impossible.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background via-background to-accent/10">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(1,16,52,0.12),transparent_60%)]" />
      <Card className="w-full max-w-md shadow-xl border-border/60 backdrop-blur-sm">
        <CardHeader className="text-center space-y-5 pt-8">
          <div className="flex justify-center">
            <AppSymbol className="h-24 w-24 rounded-2xl shadow-lg ring-1 ring-border/40" />
          </div>
          <div className="space-y-2">
            <CardTitle className="text-3xl font-semibold tracking-tight">{APP_NAME}</CardTitle>
            <p className="text-sm text-muted-foreground">{APP_TAGLINE}</p>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" disabled={submitting} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Mot de passe</Label>
              <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" disabled={submitting} />
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Se connecter
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

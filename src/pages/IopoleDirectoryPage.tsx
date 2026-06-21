import { useState } from 'react';
import { Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { checkIopolePeppol, searchIopoleDirectory } from '@/lib/providers/iopole';

function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export default function IopoleDirectoryPage() {
  const { toast } = useToast();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<unknown>(null);
  const [scheme, setScheme] = useState('0225');
  const [value, setValue] = useState('');
  const [participant, setParticipant] = useState<unknown>(null);

  function err(e: unknown) {
    toast({ title: 'Erreur annuaire', description: (e as Error).message, variant: 'destructive' });
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Search className="h-6 w-6" /> Iopole — Annuaire
        </h1>
        <p className="text-sm text-muted-foreground">
          Destinataires (annuaire français) et vérification de routing Peppol.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recherche annuaire français</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Input
              placeholder="SIREN, SIRET ou raison sociale"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && q.trim() && searchIopoleDirectory(q.trim()).then(setResults).catch(err)}
              className="w-96"
            />
            <Button variant="outline" onClick={() => q.trim() && searchIopoleDirectory(q.trim()).then(setResults).catch(err)}>
              Rechercher
            </Button>
          </div>
          <Json value={results} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vérifier un participant Peppol (routing + métadonnées)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Input placeholder="scheme (ex: 0225)" value={scheme} onChange={(e) => setScheme(e.target.value)} className="w-40" />
            <Input
              placeholder="value (ex: SIREN)"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && value.trim() && checkIopolePeppol(scheme.trim(), value.trim()).then(setParticipant).catch(err)}
              className="w-64"
            />
            <Button variant="outline" onClick={() => value.trim() && checkIopolePeppol(scheme.trim(), value.trim()).then(setParticipant).catch(err)}>
              Vérifier
            </Button>
          </div>
          <Json value={participant} />
        </CardContent>
      </Card>
    </div>
  );
}

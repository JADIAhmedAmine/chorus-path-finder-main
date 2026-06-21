import { useRef, useState } from 'react';
import { FileUp, Loader2, Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { convertPdfToIopole, emitIopoleFromJson } from '@/lib/providers/iopole';

export default function IopolePdfToInvoicePage() {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [converting, setConverting] = useState(false);
  const [sending, setSending] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [jsonText, setJsonText] = useState('');

  async function onConvert(file: File) {
    setConverting(true);
    setWarnings([]);
    setJsonText('');
    try {
      const res = await convertPdfToIopole(file);
      setWarnings(res.warnings || []);
      setJsonText(JSON.stringify(res.iopoleJson, null, 2));
      toast({ title: 'PDF analysé', description: 'Relisez et corrigez les champs avant envoi.' });
    } catch (e) {
      toast({ title: 'Échec analyse PDF', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setConverting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function onSend() {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      toast({ title: 'JSON invalide', description: 'Corrigez le JSON avant envoi.', variant: 'destructive' });
      return;
    }
    setSending(true);
    try {
      const res = await emitIopoleFromJson(parsed, 'facturx');
      toast({ title: 'Facture générée et envoyée', description: `id: ${res.id}` });
    } catch (e) {
      toast({ title: 'Échec génération / envoi', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <FileUp className="h-6 w-6" /> Iopole — PDF → Facture électronique
        </h1>
        <p className="text-sm text-muted-foreground">
          Importez n'importe quel PDF de facture : extraction automatique → relecture → génération Factur-X conforme → envoi.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Importer un PDF</CardTitle>
        </CardHeader>
        <CardContent>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onConvert(f);
            }}
          />
          <Button onClick={() => fileRef.current?.click()} disabled={converting}>
            {converting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileUp className="mr-2 h-4 w-4" />}
            Choisir un PDF de facture
          </Button>
        </CardContent>
      </Card>

      {jsonText && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Relire et corriger</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {warnings.length > 0 && (
              <ul className="rounded-md bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                {warnings.map((w, i) => (
                  <li key={i}>⚠️ {w}</li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              Vérifiez surtout : vendeur (nom, SIREN, <b>numéro de TVA</b>), acheteur, montants. Le SIREN/n° TVA du
              vendeur est requis pour une génération conforme EN 16931.
            </p>
            <Textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              className="min-h-[360px] font-mono text-xs"
              spellCheck={false}
            />
            <Button onClick={onSend} disabled={sending}>
              {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              3. Générer le Factur-X et envoyer
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

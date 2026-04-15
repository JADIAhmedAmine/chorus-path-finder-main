import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { publicCustomers, publicServices, suppliers } from '@/data/mock-data';
import { Upload, FileText, X, CheckCircle, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { createChorusConnector } from '@/lib/chorus/client';
import { buildInvoiceSubmissionPayload } from '@/lib/chorus/mappers';
import { loadChorusConfig } from '@/lib/chorus/storage';

export default function InvoiceCreate() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [mainFile, setMainFile] = useState<File | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    supplierOrganizationId: '',
    supplierInvoiceNumber: '',
    publicServiceId: '',
    engagementNumber: '',
    marketNumber: '',
    purchaseOrderNumber: '',
  });

  const chorusConfig = loadChorusConfig();
  const services = selectedCustomer ? publicServices.filter(s => s.publicCustomerId === selectedCustomer && s.active) : [];

  const handleMainDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && (file.type === 'application/pdf' || file.type === 'text/xml' || file.name.endsWith('.xml'))) {
      setMainFile(file);
    }
  }, []);

  const handleSubmit = async () => {
    if (!mainFile) {
      toast({ title: 'Erreur', description: 'Veuillez déposer une facture principale.', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      const connector = createChorusConnector(chorusConfig);
      const payload = buildInvoiceSubmissionPayload({
        ...formData,
        publicCustomerId: selectedCustomer,
      });

      const result = await connector.submitInvoice({
        invoiceData: payload,
        mainFile,
        attachments,
      });

      toast({
        title: chorusConfig.mode === 'mock' ? 'Facture mockée' : 'Facture envoyée à Chorus',
        description: result.externalId
          ? `Référence retournée: ${result.externalId}`
          : 'La facture a été transmise.',
      });
      navigate('/invoices');
    } catch (error) {
      toast({
        title: 'Échec de soumission',
        description: error instanceof Error ? error.message : 'Erreur inconnue',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Nouvelle facture</h1>
          <p className="text-sm text-muted-foreground">Déposez une facture et ses pièces jointes complémentaires</p>
        </div>
        <Badge variant={chorusConfig.mode === 'direct' && chorusConfig.enabled ? 'default' : 'secondary'}>
          {chorusConfig.mode === 'direct' && chorusConfig.enabled ? 'Chorus direct' : 'Mode mock'}
        </Badge>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Facture principale</CardTitle></CardHeader>
        <CardContent>
          {mainFile ? (
            <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/30">
              <div className="flex items-center gap-3">
                <FileText className="h-8 w-8 text-accent" />
                <div>
                  <div className="font-medium">{mainFile.name}</div>
                  <div className="text-xs text-muted-foreground">{(mainFile.size / 1024).toFixed(0)} Ko</div>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setMainFile(null)}><X className="h-4 w-4" /></Button>
            </div>
          ) : (
            <div
              className="border-2 border-dashed rounded-lg p-12 text-center cursor-pointer hover:border-accent/50 transition-colors"
              onDragOver={e => e.preventDefault()}
              onDrop={handleMainDrop}
              onClick={() => document.getElementById('main-upload')?.click()}
            >
              <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="font-medium">Glissez-déposez votre facture ici</p>
              <p className="text-sm text-muted-foreground mt-1">PDF, XML ou Factur-X · 50 Mo max</p>
              <input id="main-upload" type="file" className="hidden" accept=".pdf,.xml" onChange={e => { if (e.target.files?.[0]) setMainFile(e.target.files[0]); }} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Pièces jointes complémentaires</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-3">
            {attachments.map((file, i) => (
              <div key={i} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  <span className="text-sm">{file.name}</span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}><X className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button variant="outline" onClick={() => document.getElementById('att-upload')?.click()}>
              <Upload className="mr-2 h-4 w-4" /> Ajouter un fichier
            </Button>
            <input id="att-upload" type="file" className="hidden" multiple onChange={e => {
              if (e.target.files) setAttachments(prev => [...prev, ...Array.from(e.target.files)]);
            }} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Métadonnées initiales (optionnel)</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Fournisseur</Label>
              <Select value={formData.supplierOrganizationId} onValueChange={v => setFormData(p => ({ ...p, supplierOrganizationId: v }))}>
                <SelectTrigger><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
                <SelectContent>
                  {suppliers.filter(s => s.active).map(s => <SelectItem key={s.id} value={s.id}>{s.legalName} ({s.siret})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>N° Facture</Label>
              <Input placeholder="FAC-2024-..." value={formData.supplierInvoiceNumber} onChange={e => setFormData(p => ({ ...p, supplierInvoiceNumber: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Client public</Label>
              <Select value={selectedCustomer} onValueChange={v => { setSelectedCustomer(v); setFormData(p => ({ ...p, publicServiceId: '' })); }}>
                <SelectTrigger><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
                <SelectContent>
                  {publicCustomers.filter(c => c.active).map(c => <SelectItem key={c.id} value={c.id}>{c.legalName} ({c.codeDestinataire})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Service destinataire</Label>
              <Select value={formData.publicServiceId} onValueChange={v => setFormData(p => ({ ...p, publicServiceId: v }))} disabled={!selectedCustomer}>
                <SelectTrigger><SelectValue placeholder={selectedCustomer ? 'Sélectionner...' : 'Choisir un client d\'abord'} /></SelectTrigger>
                <SelectContent>
                  {services.map(s => <SelectItem key={s.id} value={s.id}>{s.codeServiceExecutant} — {s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <Separator className="col-span-full" />

            <div className="space-y-2">
              <Label>N° Engagement</Label>
              <Input placeholder="ENG-..." value={formData.engagementNumber} onChange={e => setFormData(p => ({ ...p, engagementNumber: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>N° Marché</Label>
              <Input placeholder="MA-..." value={formData.marketNumber} onChange={e => setFormData(p => ({ ...p, marketNumber: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>N° Bon de commande</Label>
              <Input placeholder="BC-..." value={formData.purchaseOrderNumber} onChange={e => setFormData(p => ({ ...p, purchaseOrderNumber: e.target.value }))} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={() => navigate('/invoices')}>Annuler</Button>
        <Button onClick={handleSubmit} disabled={submitting}>
          {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
          {chorusConfig.mode === 'direct' && chorusConfig.enabled ? 'Envoyer à Chorus' : 'Déposer la facture'}
        </Button>
      </div>
    </div>
  );
}

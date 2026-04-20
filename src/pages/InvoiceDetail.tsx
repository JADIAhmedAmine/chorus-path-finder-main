import { useParams, Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { StatusBadge } from '@/components/common/StatusBadge';
import { StatusTimeline } from '@/components/common/StatusTimeline';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/status-utils';
import {
  getAuditLogs,
  getCustomer,
  getExtractionResults,
  getInvoice,
  getInvoiceApiLogs,
  getInvoiceAttachments,
  getInvoiceHistory,
  getInvoiceLines,
  getService,
  getSupplier,
} from '@/data/mock-data';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { ArrowLeft, Edit, CheckCircle, Send, RotateCcw, Download, FileText, Paperclip, AlertTriangle } from 'lucide-react';

export default function InvoiceDetail() {
  const { id } = useParams();
  const { data, loading, error } = useAsyncResource(
    async () => {
      if (!id) {
        return {
          invoice: undefined,
          supplier: undefined,
          customer: undefined,
          service: undefined,
          history: [],
          attachments: [],
          lines: [],
          apiLogs: [],
          extraction: undefined,
          invoiceAudit: [],
        };
      }

      const invoice = await getInvoice(id);
      if (!invoice) {
        return {
          invoice: undefined,
          supplier: undefined,
          customer: undefined,
          service: undefined,
          history: [],
          attachments: [],
          lines: [],
          apiLogs: [],
          extraction: undefined,
          invoiceAudit: [],
        };
      }

      const [
        supplier,
        customer,
        service,
        history,
        attachments,
        lines,
        apiLogs,
        extractionResults,
        invoiceAudit,
      ] = await Promise.all([
        getSupplier(invoice.supplierOrganizationId),
        getCustomer(invoice.publicCustomerId),
        invoice.publicServiceId ? getService(invoice.publicServiceId) : Promise.resolve(undefined),
        getInvoiceHistory(invoice.id),
        getInvoiceAttachments(invoice.id),
        getInvoiceLines(invoice.id),
        getInvoiceApiLogs(invoice.id),
        getExtractionResults(invoice.id),
        getAuditLogs(invoice.id),
      ]);

      return {
        invoice,
        supplier,
        customer,
        service,
        history,
        attachments,
        lines,
        apiLogs,
        extraction: extractionResults[0],
        invoiceAudit,
      };
    },
    [id],
    {
      invoice: undefined,
      supplier: undefined,
      customer: undefined,
      service: undefined,
      history: [],
      attachments: [],
      lines: [],
      apiLogs: [],
      extraction: undefined,
      invoiceAudit: [],
    },
  );
  const invoice = data.invoice;

  if (!invoice) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        {loading ? (
          <p className="text-lg text-muted-foreground">Chargement de la facture...</p>
        ) : (
          <p className="text-lg text-muted-foreground">Facture non trouvée</p>
        )}
        {error && (
          <Alert variant="destructive" className="mt-4 max-w-xl">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button asChild className="mt-4"><Link to="/invoices">Retour à la liste</Link></Button>
      </div>
    );
  }

  const supplier = data.supplier;
  const customer = data.customer;
  const service = data.service;
  const history = data.history;
  const attachments = data.attachments;
  const lines = data.lines;
  const apiLogs = data.apiLogs;
  const extraction = data.extraction;
  const invoiceAudit = data.invoiceAudit;
  const isRejected = invoice.statusInternal === 'REJECTED_BUSINESS' || invoice.statusInternal === 'REJECTED_TECHNICAL';

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild><Link to="/invoices"><ArrowLeft className="h-4 w-4" /></Link></Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold">{invoice.supplierInvoiceNumber}</h1>
              <StatusBadge status={invoice.statusInternal} />
            </div>
            <p className="text-sm text-muted-foreground">{supplier?.legalName} → {customer?.legalName}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {['DRAFT_UPLOADED', 'DRAFT_STRUCTURED', 'PENDING_HUMAN_REVIEW'].includes(invoice.statusInternal) && (
            <Button variant="outline"><Edit className="mr-2 h-4 w-4" /> Éditer</Button>
          )}
          {['DRAFT_STRUCTURED', 'PENDING_HUMAN_REVIEW'].includes(invoice.statusInternal) && (
            <Button variant="outline"><CheckCircle className="mr-2 h-4 w-4" /> Valider</Button>
          )}
          {invoice.statusInternal === 'READY_FOR_SUBMISSION' && (
            <Button><Send className="mr-2 h-4 w-4" /> Soumettre</Button>
          )}
          {isRejected && (
            <Button><RotateCcw className="mr-2 h-4 w-4" /> Resoumettre</Button>
          )}
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Rejection Banner */}
      {isRejected && invoice.statusReasonLabel && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="py-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-destructive">Rejet : {invoice.statusReasonCode}</p>
              <p className="text-sm text-muted-foreground">{invoice.statusReasonLabel}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">Résumé</TabsTrigger>
          <TabsTrigger value="lines">Lignes ({lines.length})</TabsTrigger>
          <TabsTrigger value="attachments">Pièces jointes ({attachments.length})</TabsTrigger>
          <TabsTrigger value="history">Historique</TabsTrigger>
          <TabsTrigger value="api">Logs API ({apiLogs.length})</TabsTrigger>
          {extraction && <TabsTrigger value="extraction">Extraction</TabsTrigger>}
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>

        {/* Summary */}
        <TabsContent value="summary" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Informations générales</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <InfoRow label="N° Facture fournisseur" value={invoice.supplierInvoiceNumber} />
                {invoice.chorusInvoiceNumber && <InfoRow label="N° Chorus" value={invoice.chorusInvoiceNumber} />}
                <InfoRow label="Date facture" value={formatDate(invoice.invoiceDate)} />
                {invoice.dueDate && <InfoRow label="Date échéance" value={formatDate(invoice.dueDate)} />}
                <InfoRow label="Format source" value={invoice.sourceFormat} />
                <InfoRow label="Révision" value={String(invoice.currentRevision)} />
                {invoice.submittedAt && <InfoRow label="Soumise le" value={formatDateTime(invoice.submittedAt)} />}
                {invoice.lastStatusSyncAt && <InfoRow label="Dernier sync" value={formatDateTime(invoice.lastStatusSyncAt)} />}
                {invoice.statusChorus && <InfoRow label="Statut Chorus brut" value={invoice.statusChorus} />}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Montants</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <InfoRow label="Montant HT" value={formatCurrency(invoice.totalHt)} />
                <InfoRow label="TVA" value={formatCurrency(invoice.totalVat)} />
                <Separator />
                <InfoRow label="Montant TTC" value={formatCurrency(invoice.totalTtc)} bold />
                <InfoRow label="Devise" value={invoice.currencyCode} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Fournisseur</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <InfoRow label="Raison sociale" value={supplier?.legalName || '-'} />
                <InfoRow label="SIRET" value={supplier?.siret || '-'} />
                <InfoRow label="TVA intra." value={supplier?.vatNumber || '-'} />
                {supplier?.chorusSupplierCode && <InfoRow label="Code Chorus" value={supplier.chorusSupplierCode} />}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Destinataire public</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <InfoRow label="Client public" value={customer?.legalName || '-'} />
                <InfoRow label="Code destinataire" value={customer?.codeDestinataire || '-'} />
                <InfoRow label="SIRET" value={customer?.siret || '-'} />
                {service && <InfoRow label="Service exécutant" value={`${service.codeServiceExecutant} — ${service.label}`} />}
                {invoice.engagementNumber && <InfoRow label="N° Engagement" value={invoice.engagementNumber} />}
                {invoice.purchaseOrderNumber && <InfoRow label="N° Bon de commande" value={invoice.purchaseOrderNumber} />}
                {invoice.marketNumber && <InfoRow label="N° Marché" value={invoice.marketNumber} />}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Lines */}
        <TabsContent value="lines" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left p-3 font-medium">#</th>
                    <th className="text-left p-3 font-medium">Description</th>
                    <th className="text-right p-3 font-medium">Qté</th>
                    <th className="text-left p-3 font-medium">Unité</th>
                    <th className="text-right p-3 font-medium">PU HT</th>
                    <th className="text-right p-3 font-medium">TVA</th>
                    <th className="text-right p-3 font-medium">Total HT</th>
                    <th className="text-right p-3 font-medium">Total TTC</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map(line => (
                    <tr key={line.id} className="border-b">
                      <td className="p-3">{line.lineNumber}</td>
                      <td className="p-3">{line.description}</td>
                      <td className="p-3 text-right">{line.quantity}</td>
                      <td className="p-3">{line.unitCode}</td>
                      <td className="p-3 text-right">{formatCurrency(line.unitPriceHt)}</td>
                      <td className="p-3 text-right">{line.vatRate}%</td>
                      <td className="p-3 text-right">{formatCurrency(line.lineTotalHt)}</td>
                      <td className="p-3 text-right font-medium">{formatCurrency(line.lineTotalTtc)}</td>
                    </tr>
                  ))}
                  {lines.length === 0 && (
                    <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">Aucune ligne de facture</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Attachments */}
        <TabsContent value="attachments" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              {attachments.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">Aucune pièce jointe</p>
              ) : (
                <div className="space-y-3">
                  {attachments.map(att => (
                    <div key={att.id} className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="flex items-center gap-3">
                        {att.attachmentRole === 'MAIN' ? <FileText className="h-5 w-5 text-accent" /> : <Paperclip className="h-5 w-5 text-muted-foreground" />}
                        <div>
                          <div className="font-medium text-sm">{att.filename}</div>
                          <div className="text-xs text-muted-foreground">
                            {att.attachmentRole} · {(att.sizeBytes / 1024).toFixed(0)} Ko · {att.mimeType}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {att.uploadedToChorus && <span className="text-xs px-2 py-0.5 rounded bg-success/10 text-success">Chorus ✓</span>}
                        <Button variant="ghost" size="sm"><Download className="h-4 w-4" /></Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* History */}
        <TabsContent value="history" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              <StatusTimeline events={history} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* API Logs */}
        <TabsContent value="api" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left p-3 font-medium">Opération</th>
                    <th className="text-left p-3 font-medium">Système</th>
                    <th className="text-right p-3 font-medium">HTTP</th>
                    <th className="text-left p-3 font-medium">Résultat</th>
                    <th className="text-right p-3 font-medium">Latence</th>
                    <th className="text-left p-3 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {apiLogs.map(log => (
                    <tr key={log.id} className="border-b">
                      <td className="p-3 font-mono text-xs">{log.operationName}</td>
                      <td className="p-3">{log.targetSystem}</td>
                      <td className="p-3 text-right">
                        <span className={log.success ? 'text-success' : 'text-destructive'}>{log.httpStatus}</span>
                      </td>
                      <td className="p-3">
                        {log.success ? (
                          <span className="text-xs px-2 py-0.5 rounded bg-success/10 text-success">Succès</span>
                        ) : (
                          <span className="text-xs px-2 py-0.5 rounded bg-destructive/10 text-destructive">Échec</span>
                        )}
                      </td>
                      <td className="p-3 text-right text-muted-foreground">{log.latencyMs} ms</td>
                      <td className="p-3 text-xs text-muted-foreground">{formatDateTime(log.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Extraction */}
        {extraction && (
          <TabsContent value="extraction" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between">
                  <span>Résultat d'extraction — {extraction.engineName} v{extraction.engineVersion}</span>
                  <span className={`text-sm ${extraction.confidenceScore >= 0.8 ? 'text-success' : 'text-warning'}`}>
                    Score : {(extraction.confidenceScore * 100).toFixed(0)}%
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {Object.entries(extraction.extractedPayload).map(([key, val]: [string, any]) => {
                    const confidence = typeof val?.confidence === 'number' ? val.confidence : undefined;
                    const displayValue = typeof val?.value !== 'undefined' ? val.value : val;

                    return (
                      <div key={key} className="flex items-center justify-between p-2 rounded border">
                        <span className="text-sm font-medium">{key}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-sm">{String(displayValue)}</span>
                          {typeof confidence === 'number' && (
                            <span className={`text-xs px-2 py-0.5 rounded ${confidence >= 0.8 ? 'bg-success/10 text-success' : confidence >= 0.6 ? 'bg-warning/10 text-warning' : 'bg-destructive/10 text-destructive'}`}>
                              {(confidence * 100).toFixed(0)}%
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Audit */}
        <TabsContent value="audit" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left p-3 font-medium">Action</th>
                    <th className="text-left p-3 font-medium">Acteur</th>
                    <th className="text-left p-3 font-medium">Détail</th>
                    <th className="text-left p-3 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {invoiceAudit.map(log => (
                    <tr key={log.id} className="border-b">
                      <td className="p-3 font-mono text-xs">{log.actionCode}</td>
                      <td className="p-3">{log.actorType} / {log.actorId}</td>
                      <td className="p-3 text-xs text-muted-foreground">{log.diff ? JSON.stringify(log.diff) : '-'}</td>
                      <td className="p-3 text-xs text-muted-foreground">{formatDateTime(log.createdAt)}</td>
                    </tr>
                  ))}
                  {invoiceAudit.length === 0 && (
                    <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">Aucun log d'audit</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function InfoRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={bold ? 'font-semibold text-base' : 'font-medium'}>{value}</span>
    </div>
  );
}

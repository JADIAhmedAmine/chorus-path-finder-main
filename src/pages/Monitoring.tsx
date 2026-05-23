import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authenticatedFetch, loadAuthSession } from '@/lib/auth/session';

interface AuditEvent {
  timestamp?: string;
  action?: string;
  email?: string;
  roleCode?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  amountTtc?: number | string;
  amountToPay?: number | string;
  currency?: string;
  customerCode?: string;
  customerServiceCode?: string;
  supplierId?: number | string;
  supplierServiceId?: number | string;
  chorusId?: string;
  paymentRequestId?: number | string;
  paymentRequestCount?: number;
  rejectionReason?: string;
  comment?: string;
  status?: string;
  httpStatus?: number;
  durationMs?: number;
  errorMessage?: string;
}

function formatDate(value?: string): string {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('fr-FR');
}

function statusVariant(status?: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'success') {
    return 'default';
  }

  if (status === 'failed' || status === 'error') {
    return 'destructive';
  }

  return 'secondary';
}

function actionLabel(action?: string): string {
  if (action === 'invoice.submit') {
    return 'Soumission';
  }
  if (action === 'invoice.recycle') {
    return 'Recycler';
  }
  if (action === 'invoice.rejection.treat') {
    return 'Traiter rejet';
  }
  return action || '-';
}

function actionVariant(action?: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (action === 'invoice.submit') {
    return 'default';
  }
  if (action === 'invoice.recycle') {
    return 'outline';
  }
  if (action === 'invoice.rejection.treat') {
    return 'secondary';
  }
  return 'outline';
}

function invoiceDisplay(event: AuditEvent): string {
  if (event.invoiceNumber) {
    return event.invoiceNumber;
  }
  if (event.action === 'invoice.recycle' && event.chorusId) {
    return `CPP ${event.chorusId}`;
  }
  if (event.action === 'invoice.rejection.treat') {
    const requestId = event.paymentRequestId ?? event.chorusId;
    return requestId ? `Demande ${requestId}` : '-';
  }
  return event.chorusId || '-';
}

function invoiceDetails(event: AuditEvent): string[] {
  const details: string[] = [];
  if (event.invoiceDate) {
    details.push(event.invoiceDate);
  }
  if (event.paymentRequestCount !== undefined && event.paymentRequestCount > 1) {
    details.push(`${event.paymentRequestCount} demandes`);
  }
  return details;
}

function eventDetails(event: AuditEvent): string {
  if (event.errorMessage) {
    return event.errorMessage;
  }
  if (event.rejectionReason) {
    return `Motif : ${event.rejectionReason}`;
  }
  if (event.comment) {
    return event.comment;
  }
  return '-';
}

function formatAmount(value?: number | string, currency?: string): string {
  if (value === undefined || value === null || value === '') {
    return '-';
  }

  const numericValue = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  const safeCurrency = currency?.trim().toUpperCase() || 'EUR';

  if (Number.isFinite(numericValue) && /^[A-Z]{3}$/.test(safeCurrency)) {
    try {
      return new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: safeCurrency,
      }).format(numericValue);
    } catch {
      return `${numericValue} ${safeCurrency}`;
    }
  }

  return `${value}${currency ? ` ${safeCurrency}` : ''}`;
}

function statusDetails(event: AuditEvent): string {
  const parts = [];
  if (event.httpStatus !== undefined) {
    parts.push(`HTTP ${event.httpStatus}`);
  }
  if (event.durationMs !== undefined) {
    parts.push(`${event.durationMs} ms`);
  }
  return parts.join(' · ');
}

export default function Monitoring() {
  const session = useMemo(() => loadAuthSession(), []);
  const isAdmin = session?.roleCode === 'ADMINISTRATEUR';
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [emailFilter, setEmailFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadEvents = useCallback(async () => {
    if (!isAdmin) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (emailFilter.trim()) {
        params.set('email', emailFilter.trim());
      }

      const response = await authenticatedFetch(`/api/auth/audit-log?${params.toString()}`, {
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const detail = typeof body?.detail === 'string' ? body.detail : 'Historique indisponible.';
        throw new Error(detail);
      }

      const body = await response.json() as { items?: AuditEvent[] };
      setEvents(Array.isArray(body.items) ? body.items : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Historique indisponible.');
    } finally {
      setLoading(false);
    }
  }, [emailFilter, isAdmin]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  if (!isAdmin) {
    return (
      <div className="max-w-5xl space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-semibold">Monitoring</h1>
          <p className="text-sm text-muted-foreground">Historique des actions Chorus sur les factures.</p>
        </div>
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Accès réservé</AlertTitle>
          <AlertDescription>Cette page est réservée aux administrateurs.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="max-w-6xl space-y-6 animate-fade-in">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Monitoring</h1>
          <p className="text-sm text-muted-foreground">Historique concis des soumissions, recyclages et traitements de rejet.</p>
        </div>
        <div className="flex flex-col gap-2 md:w-[360px]">
          <Label htmlFor="monitoring-email">Filtrer par email</Label>
          <div className="flex gap-2">
            <Input
              id="monitoring-email"
              type="email"
              value={emailFilter}
              placeholder="utilisateur@gigalis.fr"
              onChange={(event) => setEmailFilter(event.target.value)}
            />
            <Button variant="outline" onClick={() => void loadEvents()} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Historique indisponible</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" />
            Actions factures
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading && events.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Chargement de l’historique...
            </div>
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune action facture enregistrée.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1240px] text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="p-3 font-medium">Date</th>
                    <th className="p-3 font-medium">Action</th>
                    <th className="p-3 font-medium">Utilisateur</th>
                    <th className="p-3 font-medium">Facture</th>
                    <th className="p-3 font-medium">Montant</th>
                    <th className="p-3 font-medium">Destinataire</th>
                    <th className="p-3 font-medium">Fournisseur</th>
                    <th className="p-3 font-medium">Chorus</th>
                    <th className="p-3 font-medium">Statut</th>
                    <th className="p-3 font-medium">Détails</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event, index) => (
                    <tr key={`${event.timestamp}-${event.email}-${index}`} className="border-b">
                      <td className="p-3 whitespace-nowrap">{formatDate(event.timestamp)}</td>
                      <td className="p-3">
                        <Badge variant={actionVariant(event.action)}>{actionLabel(event.action)}</Badge>
                      </td>
                      <td className="p-3">
                        <div>{event.email || '-'}</div>
                        <Badge variant="outline" className="mt-1">{event.roleCode || '-'}</Badge>
                      </td>
                      <td className="p-3">
                        <div className="font-medium">{invoiceDisplay(event)}</div>
                        {invoiceDetails(event).map((detail) => (
                          <div key={detail} className="text-xs text-muted-foreground">{detail}</div>
                        ))}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        {formatAmount(event.amountTtc ?? event.amountToPay, event.currency)}
                      </td>
                      <td className="p-3">
                        <div>{event.customerCode || '-'}</div>
                        {event.customerServiceCode ? (
                          <div className="text-xs text-muted-foreground">{event.customerServiceCode}</div>
                        ) : null}
                      </td>
                      <td className="p-3">
                        <div>{event.supplierId ?? '-'}</div>
                        {event.supplierServiceId !== undefined ? (
                          <div className="text-xs text-muted-foreground">Service {event.supplierServiceId}</div>
                        ) : null}
                      </td>
                      <td className="p-3">{event.chorusId || '-'}</td>
                      <td className="p-3">
                        <Badge variant={statusVariant(event.status)}>{event.status || '-'}</Badge>
                        {statusDetails(event) ? (
                          <div className="mt-1 text-xs text-muted-foreground">{statusDetails(event)}</div>
                        ) : null}
                      </td>
                      <td className="max-w-[280px] whitespace-normal break-words p-3 text-muted-foreground">
                        {eventDetails(event)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

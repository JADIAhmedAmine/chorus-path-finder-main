import { authHeaders } from '@/lib/auth/session';

const BASE = '/api/providers/iopole';

export interface IopoleInvoice {
  id: string;
  reference?: string | null;
  raw?: unknown;
}

export interface IopoleStatusHistoryEntry {
  code: string | null;
  date?: string | null;
}

export interface IopoleStatus {
  id: string;
  lifecycleStatus: string | null;
  history: IopoleStatusHistoryEntry[];
}

export async function iopoleHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`, { headers: authHeaders() });
    if (!res.ok) return false;
    const data = await res.json();
    return data?.ok === true;
  } catch {
    return false;
  }
}

export async function listIopoleInvoices(query?: string, limit = 20): Promise<IopoleInvoice[]> {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  params.set('limit', String(limit));
  const res = await fetch(`${BASE}/invoices?${params.toString()}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Iopole: échec liste (${res.status})`);
  const data = await res.json();
  if (data?.error) throw new Error(data.error);
  return Array.isArray(data?.invoices) ? data.invoices : [];
}

export async function getIopoleStatus(invoiceId: string): Promise<IopoleStatus> {
  const res = await fetch(`${BASE}/invoices/${encodeURIComponent(invoiceId)}/status`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Iopole: échec statut (${res.status})`);
  return res.json();
}

export async function emitIopoleInvoice(file: File): Promise<{ id: string }> {
  const form = new FormData();
  form.append('file', file);
  // Ne pas fixer Content-Type : le navigateur ajoute le boundary multipart.
  const res = await fetch(`${BASE}/emit`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    throw new Error(data?.error || `Iopole: échec émission (${res.status})`);
  }
  return data;
}

// --- Détail, historique, téléchargement (parallèles Chorus) -----------------
export async function getIopoleInvoice(id: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/invoices/${encodeURIComponent(id)}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Iopole: détail (${res.status})`);
  return res.json();
}

export async function getIopoleHistory(id: string): Promise<IopoleStatusHistoryEntry[]> {
  const res = await fetch(`${BASE}/invoices/${encodeURIComponent(id)}/history`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Iopole: historique (${res.status})`);
  const data = await res.json();
  return Array.isArray(data?.history) ? data.history : [];
}

export async function downloadIopoleInvoice(id: string, readable = false): Promise<void> {
  const res = await fetch(`${BASE}/invoices/${encodeURIComponent(id)}/download${readable ? '?readable=1' : ''}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Iopole: téléchargement indisponible (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `iopole-${id}${readable ? '-lisible.pdf' : ''}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// --- Réception (inbound, mode PULL) -----------------------------------------
export async function listIopoleInbox(): Promise<{ notSeen: string[]; count: number }> {
  const res = await fetch(`${BASE}/inbox`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Iopole: réception (${res.status})`);
  return res.json();
}

export async function markIopoleSeen(id: string): Promise<void> {
  const res = await fetch(`${BASE}/invoices/${encodeURIComponent(id)}/seen`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Iopole: markAsSeen (${res.status})`);
}

// --- Annuaire ---------------------------------------------------------------
export async function searchIopoleDirectory(q: string): Promise<unknown> {
  const res = await fetch(`${BASE}/directory/french?q=${encodeURIComponent(q)}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Iopole: annuaire (${res.status})`);
  const data = await res.json();
  return data?.results ?? data;
}

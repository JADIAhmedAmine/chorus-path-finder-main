import { useQuery } from '@tanstack/react-query';
import { authenticatedFetch, clearAuthSession } from '@/lib/auth/session';

export interface DashboardTotals {
  invoiceCount: number;
  totalAmount: number;
  paidAmount: number;
  paidCount: number;
  inProgressAmount: number;
  inProgressCount: number;
  blockedAmount: number;
  blockedCount: number;
  actionRequiredAmount: number;
  actionRequiredCount: number;
  rejectedCount: number;
  draftCount: number;
}

export interface DashboardApiHealth {
  totalCalls: number;
  successCount: number;
  failedCount: number;
  successRate: number | null;
  lastErrorMessage: string | null;
  lastErrorAt: string | null;
}

export type DashboardStatusBucket =
  | 'PAID'
  | 'IN_PROGRESS'
  | 'BLOCKED'
  | 'ACTION_REQUIRED'
  | 'DRAFT'
  | 'UNKNOWN';

export interface DashboardStatusEntry {
  status: string;
  count: number;
  amount: number;
  bucket: DashboardStatusBucket;
}

export interface DashboardAgingBucket {
  label: '0-7' | '8-15' | '16-30' | '30+';
  count: number;
  amount: number;
}

export interface DashboardEntityEntry {
  publicCustomerId: string;
  publicCustomerName: string;
  count: number;
  totalAmount: number;
  blockedAmount: number;
}

export interface DashboardRejectionReason {
  reasonCode: string | null;
  reasonLabel: string | null;
  count: number;
  blockedAmount: number;
}

export interface DashboardRecentIssue {
  invoiceId: string;
  supplierInvoiceNumber: string;
  status: string | null;
  statusReasonCode: string | null;
  statusReasonLabel: string | null;
  publicCustomerId: string | null;
  publicCustomerName: string | null;
  totalTtc: number;
  ageInDays: number | null;
  requiresAction: boolean;
}

export type DashboardInsightSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface DashboardInsight {
  severity: DashboardInsightSeverity;
  title: string;
  message: string;
}

export interface DashboardSummary {
  generatedAt: string;
  periodFrom: string | null;
  periodTo: string | null;
  totals: DashboardTotals;
  apiHealth: DashboardApiHealth;
  statusDistribution: DashboardStatusEntry[];
  aging: DashboardAgingBucket[];
  topEntitiesByAmount: DashboardEntityEntry[];
  topEntitiesByBlocked: DashboardEntityEntry[];
  topRejectionReasons: DashboardRejectionReason[];
  recentIssues: DashboardRecentIssue[];
  insights: DashboardInsight[];
}

const DASHBOARD_API_BASE = '/api/db/dashboard';

export interface DashboardSummaryQueryArgs {
  from?: string;
  to?: string;
}

async function fetchDashboardSummary({ from, to }: DashboardSummaryQueryArgs): Promise<DashboardSummary> {
  const search = new URLSearchParams();
  if (from) search.set('from', from);
  if (to) search.set('to', to);
  const url = search.toString()
    ? `${DASHBOARD_API_BASE}/summary?${search.toString()}`
    : `${DASHBOARD_API_BASE}/summary`;

  const response = await authenticatedFetch(url, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearAuthSession();
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.assign('/login');
      }
    }
    const text = await response.text().catch(() => '');
    throw new Error(`GET ${url} ${response.status}: ${text || response.statusText}`);
  }

  return (await response.json()) as DashboardSummary;
}

export const dashboardQueryKeys = {
  summary: (args: DashboardSummaryQueryArgs) => ['dashboard', 'summary', args] as const,
};

export function useDashboardSummaryQuery(args: DashboardSummaryQueryArgs = {}) {
  return useQuery<DashboardSummary>({
    queryKey: dashboardQueryKeys.summary(args),
    queryFn: () => fetchDashboardSummary(args),
    staleTime: 60_000,
  });
}

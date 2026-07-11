'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Lock, UsersThree } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Card, CenterState, ErrorState, Field, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { formatDateTime } from '@/lib/format';
import { canViewChurn } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { ChurnCustomer, ChurnRiskBand, Depot, Page } from '@/lib/types';

// Depot-service returns the full record; we only need these fields for the picker.
type DepotOption = Depot & Record<string, unknown>;

const BAND_TONE: Record<ChurnRiskBand, 'danger' | 'warning' | 'success'> = {
  HIGH: 'danger',
  MEDIUM: 'warning',
  LOW: 'success',
};

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function ChurnBody() {
  // Empty depotId = all depots (global list).
  const [depotId, setDepotId] = useState('');

  const depots = useAsync<Page<DepotOption>>(() => api.get(endpoints.depots.browse({ limit: 100 }), true));
  const options = depots.data?.items ?? [];

  // Server (forecast-service) enforces CHURN_ROLES on this call; the gate below is UX only.
  const rows = useAsync<{ customers: ChurnCustomer[] }>(
    () => api.get(endpoints.forecast.churn({ depotId: depotId || undefined, limit: 100 }), true),
    [depotId],
  );
  const customers = rows.data?.customers ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <UsersThree size={24} weight="fill" className="text-brand-500" />
          <h1 className="text-2xl font-bold">Customer churn risk</h1>
        </div>
        <Link href="/dashboard/campaigns" className="text-sm font-semibold text-brand-700 hover:underline">
          Campaigns →
        </Link>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Depot" htmlFor="depot">
          <select
            id="depot"
            value={depotId}
            onChange={(e) => setDepotId(e.target.value)}
            className="surface-elevated w-full min-w-56 rounded-lg border border-app px-3.5 py-2.5 text-sm focus:outline focus:outline-2 focus:outline-brand-600"
          >
            <option value="">All depots</option>
            {options.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} · {d.city}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {rows.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.error ? (
        <ErrorState message={rows.error} onRetry={rows.reload} />
      ) : customers.length === 0 ? (
        <CenterState title="No customers at risk" icon={<UsersThree size={40} weight="fill" />}>
          No customers are flagged at risk for this selection.
        </CenterState>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-app text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Last order</th>
                <th className="px-4 py-3 text-right font-medium">Days since</th>
                <th className="px-4 py-3 text-right font-medium">Orders</th>
                <th className="px-4 py-3 font-medium">Risk</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.customerId} className="border-b border-app last:border-0">
                  <td className="px-4 py-3 font-mono text-xs">{shortId(c.customerId)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(c.lastOrderAt)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{c.daysSince}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{c.orderCount}</td>
                  <td className="px-4 py-3">
                    <Badge tone={BAND_TONE[c.riskBand]}>{c.riskBand}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!canViewChurn(customer?.role)) {
    return (
      <CenterState title="Staff access only" icon={<Lock size={40} weight="fill" />}>
        Customer churn insights are staff-only — available to marketing and management staff.
      </CenterState>
    );
  }
  return <ChurnBody />;
}

export default function ChurnPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}

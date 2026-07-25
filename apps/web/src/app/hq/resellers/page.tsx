'use client';

import { useMemo, useState } from 'react';

import { Badge, Card, ErrorState, SectionHeader, Skeleton } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { canViewResellers, isHq } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import {
  evaluateReseller,
  RESELLER_STATUS_LABEL,
  type Reseller,
  type ResellerRollupRow,
} from '@/lib/reseller';
import type { DepotAdmin, Page } from '@/lib/types';

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

const EMPTY_DEPOTS: Page<DepotAdmin> = { items: [], total: 0, page: 1, limit: 100 };

// Reseller (agen) achievement console — joins the reseller registry (target) with the
// order-service rollup (actual volume/growth) for one depot + month. HQ picks the depot
// via a select; a depot manager is pinned to their own (customer.assignedDepotId).
export default function ResellersPage() {
  const { customer } = useAuth();
  const canView = canViewResellers(customer?.role);
  const hq = isHq(customer?.role);
  const month = useMemo(currentMonth, []);

  const [pickedDepotId, setPickedDepotId] = useState('');
  const depotId = hq ? pickedDepotId : (customer?.assignedDepotId ?? '');

  const depotList = useAsync<Page<DepotAdmin>>(
    () => (hq ? api.get<Page<DepotAdmin>>(endpoints.depots.manage({ limit: 100 }), true) : Promise.resolve(EMPTY_DEPOTS)),
    [hq],
  );

  const registry = useAsync<Reseller[]>(
    () => (depotId ? api.get<Reseller[]>(endpoints.resellers.list({ depotId }), true) : Promise.resolve([])),
    [depotId],
  );

  const ids = useMemo(() => (registry.data ?? []).map((r) => r.customerId), [registry.data]);
  const rollup = useAsync<{ rows: ResellerRollupRow[] }>(
    () =>
      ids.length && depotId
        ? api.get(endpoints.reports.resellerRollup({ depotId, month, customerIds: ids }), true)
        : Promise.resolve({ rows: [] }),
    [depotId, month, ids.join(',')],
  );

  if (!canView) {
    return (
      <div className="mx-auto max-w-4xl">
        <ErrorState message="Akses ditolak" />
      </div>
    );
  }

  const byId = new Map((rollup.data?.rows ?? []).map((r) => [r.customerId, r]));

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <SectionHeader title="Reseller (Agen)" subtitle={`Pencapaian ${month}`} />

      {hq && (
        <Card className="p-4">
          <label className="mb-1.5 block text-sm font-medium" htmlFor="reseller-depot">
            Depot
          </label>
          <select
            id="reseller-depot"
            value={pickedDepotId}
            onChange={(e) => setPickedDepotId(e.target.value)}
            className="surface-elevated w-full max-w-xs rounded-lg border border-app px-3.5 py-2.5 text-sm focus:outline focus:outline-2 focus:outline-offset-0 focus:outline-brand-600"
          >
            <option value="">Pilih depot…</option>
            {(depotList.data?.items ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Card>
      )}

      {registry.loading && depotId && <Skeleton className="h-64" />}
      {registry.error && <ErrorState message={registry.error} onRetry={registry.reload} />}
      {!depotId && !registry.loading && (
        <p className="text-sm text-muted">
          {hq ? 'Pilih depot untuk melihat reseller.' : 'Depot belum ditentukan.'}
        </p>
      )}
      {registry.data && registry.data.length === 0 && depotId && (
        <p className="text-sm text-muted">Belum ada reseller di depot ini.</p>
      )}
      {registry.data && registry.data.length > 0 && (
        <Card className="divide-y divide-[color:var(--border)] p-0">
          {registry.data.map((r) => {
            const roll = byId.get(r.customerId);
            const m = evaluateReseller({
              volumeQty: roll?.volumeQty ?? 0,
              prevVolumeQty: roll?.prevVolumeQty ?? 0,
              monthlyTargetQty: r.monthlyTargetQty,
              lastOrderAt: roll?.lastOrderAt ?? null,
            });
            return (
              <div key={r.customerId} className="flex items-center justify-between gap-4 p-4 text-sm">
                <div>
                  {/* MVP shows customerId as the row label — a name lookup is deferred. */}
                  <div className="font-semibold">{r.customerId}</div>
                  <div className="text-muted">
                    {roll?.volumeQty ?? 0} / {r.monthlyTargetQty} galon
                    {m.attainmentPct != null && <> · {m.attainmentPct}%</>}
                    {' · '}pertumbuhan {m.growthPct >= 0 ? '↑' : '↓'} {Math.abs(m.growthPct)}%
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {m.pasif && <Badge tone="danger">Pasif</Badge>}
                  <Badge
                    tone={
                      m.status === 'lampaui' || m.status === 'tercapai'
                        ? 'success'
                        : m.status === 'no-target'
                          ? 'neutral'
                          : 'danger'
                    }
                  >
                    {RESELLER_STATUS_LABEL[m.status]}
                  </Badge>
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}

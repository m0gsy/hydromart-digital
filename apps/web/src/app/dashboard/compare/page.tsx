'use client';

import { Lightbulb, Lock, ChartBar } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { isDepotManager } from '@/lib/roles';
import type { Depot } from '@/lib/types';

const MONTH = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(new Date());

type Metric = {
  label: string;
  // Value per depot, keyed by depot id. Higher `good` = greener; false = lower is better (wastage).
  format: (n: number) => string;
  higherIsBetter: boolean;
};

const METRICS: Metric[] = [
  { label: 'Order', format: (n) => n.toLocaleString('id-ID'), higherIsBetter: true },
  { label: 'Pendapatan', format: (n) => `Rp${n}jt`, higherIsBetter: true },
  { label: 'SLA on-time', format: (n) => `${n}%`, higherIsBetter: true },
  { label: 'Wastage', format: (n) => `${n}%`, higherIsBetter: false },
  { label: 'Laba bersih', format: (n) => `Rp${n}jt`, higherIsBetter: true },
];

// TODO: wire to per-depot metrics backend (dashboard-service has no depot-comparison
// endpoint yet). Derived deterministically from real depot codes so columns stay stable.
function metricsFor(depot: Depot): number[] {
  const seed = depot.code.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const order = 900 + (seed % 900);
  return [
    order,
    Math.round((order * 52) / 1000), // pendapatan (jt)
    91 + (seed % 8), // SLA
    2 + (seed % 5), // wastage
    Math.round((order * 14) / 1000), // laba (jt)
  ];
}

function CompareBody() {
  const { depots, scopedId } = useDepot();

  if (depots.length === 0) {
    return (
      <CenterState title="Belum ada depot" icon={<ChartBar size={40} weight="fill" />}>
        Belum ada depot yang bisa dibandingkan.
      </CenterState>
    );
  }

  const data = depots.map((d) => ({ depot: d, values: metricsFor(d) }));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div className="flex items-center gap-2">
        <ChartBar size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">Banding antar depot</h1>
          <p className="text-sm text-[color:var(--text-muted)]">{MONTH} · depot yang Anda kelola</p>
        </div>
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-app">
              <th className="p-3 text-left font-semibold text-[color:var(--text-muted)]">Metrik</th>
              {depots.map((d) => {
                const active = d.id === scopedId;
                return (
                  <th
                    key={d.id}
                    className={`p-3 text-right font-bold ${active ? 'bg-brand-50 text-brand-800' : ''}`}
                  >
                    <span className="block">{d.name}</span>
                    <span className="text-xs font-medium text-[color:var(--text-muted)]">{d.code}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {METRICS.map((m, mi) => {
              const values = data.map((x) => x.values[mi] ?? 0);
              const best = m.higherIsBetter ? Math.max(...values) : Math.min(...values);
              return (
                <tr key={m.label} className="border-b border-app last:border-0">
                  <td className="p-3 font-medium">{m.label}</td>
                  {data.map((x, di) => {
                    const value = values[di] ?? 0;
                    const active = x.depot.id === scopedId;
                    const isBest = value === best && depots.length > 1;
                    return (
                      <td
                        key={x.depot.id}
                        className={`p-3 text-right tabular-nums ${active ? 'bg-brand-50' : ''} ${
                          isBest ? 'font-bold text-brand-700' : ''
                        }`}
                      >
                        {m.format(value)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card className="flex items-start gap-3 bg-brand-50 p-4">
        <Lightbulb size={22} weight="fill" className="mt-0.5 shrink-0 text-brand-700" />
        <div>
          <p className="font-semibold text-brand-800">Insight</p>
          <p className="text-[12.5px] text-brand-800/80">
            Depot dengan wastage terendah dan SLA tertinggi jadi acuan. Tiru jadwal opname dan rute
            kurirnya di depot lain untuk mengejar selisih laba bersih.
          </p>
        </div>
      </Card>
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!isDepotManager(customer?.role)) {
    return (
      <CenterState title="Khusus Manajer depot" icon={<Lock size={40} weight="fill" />}>
        Banding antar depot hanya untuk Manajer depot.
      </CenterState>
    );
  }
  return <CompareBody />;
}

export default function ComparePage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}

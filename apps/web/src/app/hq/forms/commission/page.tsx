'use client';

import { useState } from 'react';
import { Percent } from '@phosphor-icons/react';

import { Button, Card, ErrorState, Input, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { StubBadge, stubCommissionPct } from '@/lib/hq/stubs';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { DepotAdmin, Page } from '@/lib/types';

// Design 21c — Skema komisi per depot. There is no commission-scheme endpoint, so the
// whole table is a stub: current % is sample data, the "new %" inputs are local, and
// "Apply" persists via a toast only. The depot list itself is real.
export default function HqCommissionFormPage() {
  const { t } = useT();
  const { toast } = useToast();
  const depots = useAsync<Page<DepotAdmin>>(() => api.get(endpoints.depots.manage({ limit: 100 }), true));

  // Local edits: depotId -> new percent string. Undefined = unchanged (shows current).
  const [edits, setEdits] = useState<Record<string, string>>({});

  if (depots.loading) return <Skeleton className="h-96 w-full" />;
  if (depots.error) return <ErrorState message={depots.error} onRetry={depots.reload} />;

  const items = depots.data?.items ?? [];

  function apply() {
    // STUB: no commission-scheme endpoint — Milestone D.
    toast(t('hq.forms.commission.applied'), 'success');
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <Percent size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            {t('hq.forms.commission.title')}
            <StubBadge />
          </h1>
          <p className="text-sm text-muted">{t('hq.forms.commission.subtitle')}</p>
        </div>
      </div>

      <Card className="flex flex-col p-5">
        {items.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">{t('hq.forms.commission.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[360px] text-sm">
              <thead>
                <tr className="border-b border-app text-left text-xs uppercase tracking-wide text-muted">
                  <th className="pb-2 font-medium">{t('hq.forms.commission.depot')}</th>
                  <th className="pb-2 text-right font-medium">{t('hq.forms.commission.current')}</th>
                  <th className="pb-2 text-right font-medium">{t('hq.forms.commission.next')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--border)]">
                {items.map((d) => {
                  const current = stubCommissionPct(d.id);
                  const next = edits[d.id] ?? String(current);
                  return (
                    <tr key={d.id}>
                      <td className="py-2.5">
                        <p className="font-medium">{d.name}</p>
                        <p className="text-xs text-muted">{d.code}</p>
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-muted">{current}%</td>
                      <td className="py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Input
                            type="number"
                            value={next}
                            onChange={(e) => setEdits((s) => ({ ...s, [d.id]: e.target.value }))}
                            className="w-20 text-right"
                          />
                          <span className="text-muted">%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-app pt-3">
          <p className="text-xs font-medium text-muted">{t('hq.forms.commission.effective')}</p>
          <Button onClick={apply}>{t('hq.forms.commission.apply')}</Button>
        </div>
      </Card>
    </div>
  );
}

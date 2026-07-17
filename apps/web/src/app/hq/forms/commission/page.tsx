'use client';

import { useState } from 'react';
import { Percent } from '@phosphor-icons/react';

import { Button, Card, ErrorState, Input, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { CommissionScheme, DepotAdmin, Page } from '@/lib/types';

// Design 21c — Skema komisi per depot (real payout-service track). Current % comes from
// commission-service (latest effective scheme per depot); "Apply" POSTs a new scheme for
// every changed depot with the chosen effective date. The depot list itself is real too.
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function HqCommissionFormPage() {
  const { t } = useT();
  const { toast } = useToast();
  const depots = useAsync<Page<DepotAdmin>>(() => api.get(endpoints.depots.manage({ limit: 100 }), true));
  const schemes = useAsync<CommissionScheme[]>(() => api.get(endpoints.commission.schemes, true));

  // Local edits: depotId -> new percent string. Undefined = unchanged (shows current).
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [effectiveDate, setEffectiveDate] = useState(todayIso());
  const [busy, setBusy] = useState(false);

  if (depots.loading || schemes.loading) return <Skeleton className="h-96 w-full" />;
  if (depots.error) return <ErrorState message={depots.error} onRetry={depots.reload} />;
  if (schemes.error) return <ErrorState message={t('hq.forms.commission.loadError')} onRetry={schemes.reload} />;

  const items = depots.data?.items ?? [];
  // depotId -> current pct (from the latest effective scheme).
  const currentByDepot = new Map((schemes.data ?? []).map((s) => [s.depotId, s.pct]));

  async function apply() {
    // Only depots whose input differs from the current pct are re-applied.
    const changed = items
      .map((d) => {
        const raw = edits[d.id];
        if (raw === undefined) return null;
        const pct = Number(raw);
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null;
        if (pct === currentByDepot.get(d.id)) return null;
        return { depotId: d.id, ownerName: d.name, pct };
      })
      .filter((x): x is { depotId: string; ownerName: string; pct: number } => x !== null);

    if (changed.length === 0) {
      toast(t('hq.forms.commission.applied'), 'success');
      return;
    }
    setBusy(true);
    try {
      await api.post(endpoints.commission.apply, { effectiveDate, items: changed }, true);
      toast(t('hq.forms.commission.applied'), 'success');
      setEdits({});
      schemes.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.forms.commission.applyError'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <Percent size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">{t('hq.forms.commission.title')}</h1>
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
                  const current = currentByDepot.get(d.id);
                  const next = edits[d.id] ?? (current !== undefined ? String(current) : '');
                  return (
                    <tr key={d.id}>
                      <td className="py-2.5">
                        <p className="font-medium">{d.name}</p>
                        <p className="text-xs text-muted">{d.code}</p>
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-muted">
                        {current !== undefined ? `${current}%` : t('hq.forms.commission.noScheme')}
                      </td>
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
          <label className="flex items-center gap-2 text-xs font-medium text-muted">
            {t('hq.forms.commission.effectiveLabel')}
            <Input
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              className="w-40"
            />
          </label>
          <Button onClick={apply} loading={busy}>{t('hq.forms.commission.apply')}</Button>
        </div>
      </Card>
    </div>
  );
}

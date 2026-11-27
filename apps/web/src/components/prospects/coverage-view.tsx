'use client';

import { Card, ErrorState, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { labelKey } from '@/lib/prospect-labels';
import type { ProspectCoverage } from '@/lib/types';
import { useAsync } from '@/lib/use-async';

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card className="p-3.5" elevated={false}>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-lg font-bold tabular-nums">{children}</p>
    </Card>
  );
}

/** Counts only: the coverage DTO has no name, phone or address. */
export function CoverageView({ depotId }: { depotId?: string }) {
  const { t } = useT();
  const cov = useAsync(() => api.get<ProspectCoverage>(endpoints.prospects.coverage(depotId), true), [depotId]);

  if (cov.loading) return <Skeleton className="h-48" />;
  if (cov.error || !cov.data) return <ErrorState message={t('opsFix.prospects.coverage.loadFailed')} onRetry={cov.reload} />;
  const c = cov.data;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={t('opsFix.prospects.coverage.total')}>{c.total}</Stat>
        <Stat label={t('opsFix.prospects.coverage.onMap')}>{c.onMap}</Stat>
        <Stat label={t('opsFix.prospects.coverage.dataAge')}>
          <span className="text-sm font-medium">
            {c.dataAge
              ? `${t('opsFix.prospects.coverage.newest', { d: c.dataAge.newestDays })} / ${t('opsFix.prospects.coverage.median', { d: c.dataAge.medianDays })} / ${t('opsFix.prospects.coverage.oldest', { d: c.dataAge.oldestDays })}`
              : t('opsFix.prospects.coverage.noAge')}
          </span>
        </Stat>
        {c.thirdPartyCostIdr !== null && (
          <Stat label={t('opsFix.prospects.coverage.cost')}>
            <Money amount={c.thirdPartyCostIdr} />
          </Stat>
        )}
      </div>
      <Card className="overflow-x-auto p-3.5" elevated={false}>
        <h3 className="mb-2 text-sm font-semibold">{t('opsFix.prospects.coverage.byCategory')}</h3>
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-muted">
              <th className="py-1 pr-3 font-medium">{t('opsFix.prospects.cols.category')}</th>
              <th className="py-1 pr-3 font-medium">{t('opsFix.prospects.coverage.count')}</th>
              <th className="py-1 font-medium">{t('opsFix.prospects.coverage.withPhone')}</th>
            </tr>
          </thead>
          <tbody>
            {c.byCategory.map((r) => (
              <tr key={r.category}>
                <td className="py-1 pr-3">{t(labelKey('category', r.category))}</td>
                <td className="py-1 pr-3 tabular-nums">{r.total}</td>
                <td className="py-1 tabular-nums">
                  {r.withPhone} ({r.withPhonePct.toFixed(1)}%)
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="p-3.5" elevated={false}>
          <h3 className="mb-2 text-sm font-semibold">{t('opsFix.prospects.coverage.byStatus')}</h3>
          <ul className="flex flex-col gap-1 text-xs">
            {c.byStatus.map((r) => (
              <li key={r.status} className="flex justify-between">
                <span>{t(labelKey('status', r.status))}</span>
                <span className="tabular-nums">{r.total}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-3.5" elevated={false}>
          <h3 className="mb-2 text-sm font-semibold">{t('opsFix.prospects.coverage.bySource')}</h3>
          <ul className="flex flex-col gap-1 text-xs">
            {c.bySource.map((r) => (
              <li key={r.source} className="flex justify-between">
                <span>{t(labelKey('source', r.source))}</span>
                <span className="tabular-nums">{r.total}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

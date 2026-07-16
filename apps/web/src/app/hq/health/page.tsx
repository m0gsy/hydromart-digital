'use client';

import { Heartbeat } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Badge, Card, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { ServiceHealth, SystemHealth } from '@/lib/types';

// Design 13b — aggregate per-service health. Real admin-service track: the roll-up fans out
// to each service's /health server-side and returns a real up/down + latency per service.
const STATUS_TONE: Record<ServiceHealth['status'], 'success' | 'danger'> = {
  up: 'success',
  down: 'danger',
};

export default function HqHealthPage() {
  const { t } = useT();
  const query = useAsync<SystemHealth>(() => api.get(endpoints.admin.health, true));

  if (query.loading) return <Skeleton className="h-96 w-full" />;
  if (query.error) return <ErrorState message={t('hq.health.loadError')} onRetry={query.reload} />;

  const { services, upCount, total } = query.data!;

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={Heartbeat}
        title={t('hq.health.title')}
        subtitle={t('hq.health.subtitle')}
        action={
          <Badge tone={upCount === total ? 'success' : 'warning'}>
            {t('hq.health.summary', { up: upCount, total })}
          </Badge>
        }
      />

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-app text-left text-xs font-medium uppercase tracking-wide text-muted">
              <th className="px-4 py-2.5">{t('hq.health.service')}</th>
              <th className="px-4 py-2.5">{t('hq.health.status')}</th>
              <th className="px-4 py-2.5 text-right">{t('hq.health.latency')}</th>
            </tr>
          </thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.name} className="border-b border-app last:border-0">
                <td className="px-4 py-2.5 font-mono text-[13px] font-semibold">{s.name}</td>
                <td className="px-4 py-2.5">
                  <Badge tone={STATUS_TONE[s.status]}>{t(`hq.health.${s.status}`)}</Badge>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{t('hq.health.ms', { n: s.latencyMs })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

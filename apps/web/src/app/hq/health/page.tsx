'use client';

import { Heartbeat } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Badge, Card } from '@/components/ui';
import { SERVICE_HEALTH_STUB, type ServiceHealthRow } from '@/lib/hq/stubs';
import { useT } from '@/lib/locale-context';

// Design 13b — per-service health. No aggregate health endpoint, so every row is stubbed
// with realistic status / uptime / P95.
const STATUS_TONE: Record<ServiceHealthRow['status'], 'success' | 'warning' | 'danger'> = {
  up: 'success',
  degraded: 'warning',
  down: 'danger',
};

export default function HqHealthPage() {
  const { t } = useT();
  const upCount = SERVICE_HEALTH_STUB.filter((s) => s.status === 'up').length;
  const total = SERVICE_HEALTH_STUB.length;

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={Heartbeat}
        title={t('hq.health.title')}
        subtitle={t('hq.health.subtitle')}
        stub
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
              <th className="px-4 py-2.5 text-right">{t('hq.health.uptime')}</th>
              <th className="px-4 py-2.5 text-right">{t('hq.health.p95')}</th>
            </tr>
          </thead>
          <tbody>
            {SERVICE_HEALTH_STUB.map((s) => (
              <tr key={s.name} className="border-b border-app last:border-0">
                <td className="px-4 py-2.5 font-mono text-[13px] font-semibold">{s.name}</td>
                <td className="px-4 py-2.5">
                  <Badge tone={STATUS_TONE[s.status]}>{t(`hq.health.${s.status}`)}</Badge>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{s.uptime.toFixed(2)}%</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{t('hq.health.ms', { n: s.p95 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

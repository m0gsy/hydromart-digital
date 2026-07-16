'use client';

import { Archive } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Badge, Card } from '@/components/ui';
import { RETENTION_STUB } from '@/lib/hq/stubs';
import { useT } from '@/lib/locale-context';

// Design 19e — retention windows + last backup status per dataset. No retention service,
// so all rows are stubbed.
export default function HqRetentionPage() {
  const { t } = useT();

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader icon={Archive} title={t('hq.retention.title')} subtitle={t('hq.retention.subtitle')} stub />

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-app text-left text-xs font-medium uppercase tracking-wide text-muted">
              <th className="px-4 py-2.5">{t('hq.retention.dataset')}</th>
              <th className="px-4 py-2.5">{t('hq.retention.window')}</th>
              <th className="px-4 py-2.5">{t('hq.retention.lastBackup')}</th>
              <th className="px-4 py-2.5">{t('hq.retention.status')}</th>
            </tr>
          </thead>
          <tbody>
            {RETENTION_STUB.map((r) => (
              <tr key={r.id} className="border-b border-app last:border-0">
                <td className="px-4 py-2.5 font-semibold">{r.dataset}</td>
                <td className="px-4 py-2.5 text-muted">{r.window}</td>
                <td className="px-4 py-2.5 tabular-nums">{r.lastBackup}</td>
                <td className="px-4 py-2.5">
                  <Badge tone={r.status === 'ok' ? 'success' : 'warning'}>
                    {r.status === 'ok' ? t('hq.retention.ok') : t('hq.retention.warn')}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

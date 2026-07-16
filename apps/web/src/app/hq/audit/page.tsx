'use client';

import { ClockCounterClockwise } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Button, Card, ErrorState, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { agoLabel } from '@/lib/hq/stubs';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { AuditEntry, Page } from '@/lib/types';

// Design 8a — immutable audit trail. Real auth-service track: recent privileged actions
// across services, newest first. Actor identity is resolved server-side.
function minutesAgo(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
}

export default function HqAuditPage() {
  const { t } = useT();
  const { toast } = useToast();
  const log = useAsync<Page<AuditEntry>>(() => api.get(endpoints.audit.list({ limit: 100 }), true));

  if (log.loading) return <Skeleton className="h-96 w-full" />;
  if (log.error) return <ErrorState message={t('hq.audit.loadError')} onRetry={log.reload} />;

  const rows = log.data?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={ClockCounterClockwise}
        title={t('hq.audit.title')}
        subtitle={t('hq.audit.subtitle')}
        action={
          <Button variant="secondary" onClick={() => toast(t('hq.audit.exported'), 'info')}>
            {t('hq.common.export')}
          </Button>
        }
      />

      {rows.length === 0 ? (
        <Card className="p-8">
          <p className="text-center text-sm text-muted">{t('hq.audit.empty')}</p>
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-app text-left text-xs font-medium uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5">{t('hq.audit.actor')}</th>
                <th className="px-4 py-2.5">{t('hq.audit.role')}</th>
                <th className="px-4 py-2.5">{t('hq.audit.target')}</th>
                <th className="px-4 py-2.5">{t('hq.audit.action')}</th>
                <th className="px-4 py-2.5 text-right">{t('hq.audit.time')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-app last:border-0">
                  <td className="px-4 py-2.5 font-semibold">
                    {r.actorName || r.actorEmail || t('hq.audit.system')}
                  </td>
                  <td className="px-4 py-2.5 text-muted">{r.actorRole ?? '—'}</td>
                  <td className="px-4 py-2.5">{r.target ?? '—'}</td>
                  <td className="px-4 py-2.5">{r.action}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted">
                    {agoLabel(minutesAgo(r.createdAt), t)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <p className="text-xs text-muted">{t('hq.audit.note')}</p>
    </div>
  );
}

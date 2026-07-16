'use client';

import { ClockCounterClockwise } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Button, Card } from '@/components/ui';
import { useToast } from '@/components/toast';
import { AUDIT_LOG_STUB, agoLabel } from '@/lib/hq/stubs';
import { useT } from '@/lib/locale-context';

// Design 8a — immutable audit trail. No cross-service audit endpoint exists, so the whole
// trail is stubbed; export just toasts.
export default function HqAuditPage() {
  const { t } = useT();
  const { toast } = useToast();

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={ClockCounterClockwise}
        title={t('hq.audit.title')}
        subtitle={t('hq.audit.subtitle')}
        stub
        action={
          <Button variant="secondary" onClick={() => toast(t('hq.audit.exported'), 'info')}>
            {t('hq.common.export')}
          </Button>
        }
      />

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
            {AUDIT_LOG_STUB.map((r) => (
              <tr key={r.id} className="border-b border-app last:border-0">
                <td className="px-4 py-2.5 font-semibold">{r.actor}</td>
                <td className="px-4 py-2.5 text-muted">{r.role}</td>
                <td className="px-4 py-2.5">{r.target}</td>
                <td className="px-4 py-2.5">{r.action}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-muted">{agoLabel(r.agoMin, t)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <p className="text-xs text-muted">{t('hq.audit.note')}</p>
    </div>
  );
}

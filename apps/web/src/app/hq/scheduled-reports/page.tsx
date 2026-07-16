'use client';

import { useState } from 'react';
import { CalendarCheck } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Button, Card, Toggle } from '@/components/ui';
import { useToast } from '@/components/toast';
import { SCHEDULED_REPORTS_STUB, type ScheduledReportRow } from '@/lib/hq/stubs';
import { useT } from '@/lib/locale-context';

// Design 15c — recurring scheduled exports. No scheduler service, so schedules are stubbed;
// toggling on/off and add just mutate local state + toast.
export default function HqScheduledReportsPage() {
  const { t } = useT();
  const { toast } = useToast();
  const [rows, setRows] = useState<ScheduledReportRow[]>(SCHEDULED_REPORTS_STUB);

  function toggle(row: ScheduledReportRow, on: boolean) {
    setRows((prev) => prev.map((x) => (x.id === row.id ? { ...x, on } : x)));
    toast(t('hq.scheduledReports.toggled', { name: row.name }), 'success');
  }

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={CalendarCheck}
        title={t('hq.scheduledReports.title')}
        subtitle={t('hq.scheduledReports.subtitle')}
        stub
        action={<Button onClick={() => toast(t('hq.scheduledReports.added'), 'success')}>{t('hq.scheduledReports.add')}</Button>}
      />

      <div className="flex flex-col gap-3">
        {rows.map((r) => (
          <Card key={r.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-semibold">{r.name}</p>
              <p className="mt-0.5 text-xs text-muted">
                {r.cadence} · {r.recipients}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {t('hq.scheduledReports.nextRun')}: {r.nextRun}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-muted">
                {r.on ? t('hq.scheduledReports.on') : t('hq.scheduledReports.off')}
              </span>
              <Toggle on={r.on} onChange={(v) => toggle(r, v)} label={r.name} />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

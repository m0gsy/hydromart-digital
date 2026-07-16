'use client';

import { WarningOctagon } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Badge, Card, Chip } from '@/components/ui';
import { INCIDENTS_STUB, agoLabel, type IncidentRow } from '@/lib/hq/stubs';
import { useT } from '@/lib/locale-context';

// Design 14c — incident timeline. No incident service, so entries are stubbed. Ordered
// newest first.
const SEV_TONE: Record<IncidentRow['severity'], 'danger' | 'warning' | 'neutral'> = {
  kritis: 'danger',
  peringatan: 'warning',
  info: 'neutral',
};
const STATUS_TONE: Record<IncidentRow['status'], 'warning' | 'brand' | 'success'> = {
  terbuka: 'warning',
  dipantau: 'brand',
  selesai: 'success',
};

export default function HqIncidentsPage() {
  const { t } = useT();
  const rows = [...INCIDENTS_STUB].sort((a, b) => a.agoMin - b.agoMin);

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader icon={WarningOctagon} title={t('hq.incidents.title')} subtitle={t('hq.incidents.subtitle')} stub />

      {rows.length === 0 ? (
        <Card className="p-8">
          <p className="text-center text-sm text-muted">{t('hq.incidents.empty')}</p>
        </Card>
      ) : (
        <ol className="flex flex-col gap-3">
          {rows.map((r) => (
            <Card key={r.id} className="flex items-start gap-3 p-4">
              <span
                className={
                  'mt-1 h-2.5 w-2.5 shrink-0 rounded-full ' +
                  (r.severity === 'kritis' ? 'bg-red-500' : r.severity === 'peringatan' ? 'bg-amber-500' : 'bg-brand-500')
                }
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={SEV_TONE[r.severity]}>{t(`hq.incidents.severity.${r.severity}`)}</Badge>
                  <span className="font-semibold">{r.title}</span>
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Chip tone="outline">{r.service}</Chip>
                  <span>{agoLabel(r.agoMin, t)}</span>
                </p>
              </div>
              <Badge tone={STATUS_TONE[r.status]}>{t(`hq.incidents.status.${r.status}`)}</Badge>
            </Card>
          ))}
        </ol>
      )}
    </div>
  );
}

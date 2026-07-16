'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { FileText } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Badge, Button, Card } from '@/components/ui';
import { APPLICATION_QUEUE_STUB, type ApplicationRow } from '@/lib/hq/stubs';
import { useT } from '@/lib/locale-context';

// Design 5a — franchise-application approvals queue. No franchise-intake backend, so the
// queue is stubbed; rows sort oldest-first (largest SLA age) and open the 5b detail.
const STAGE_TONE: Record<ApplicationRow['stage'], 'neutral' | 'brand' | 'warning' | 'success'> = {
  baru: 'neutral',
  dokumen: 'brand',
  survei: 'warning',
  kontrak: 'success',
};

export default function HqApplicationsPage() {
  const { t } = useT();
  const router = useRouter();
  const queue = useMemo(
    () => [...APPLICATION_QUEUE_STUB].sort((a, b) => b.ageDays - a.ageDays),
    [],
  );

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={FileText}
        title={t('hq.applications.title')}
        subtitle={t('hq.applications.subtitle')}
        stub
        action={<Badge tone="warning">{t('hq.applications.count', { n: queue.length })}</Badge>}
      />

      {queue.length === 0 ? (
        <Card className="p-8">
          <p className="text-center text-sm text-muted">{t('hq.applications.empty')}</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {queue.map((a) => (
            <Card
              key={a.id}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{a.applicant}</span>
                  <Badge tone={STAGE_TONE[a.stage]}>{t(`hq.applications.stage.${a.stage}`)}</Badge>
                  <Badge tone={a.ageDays >= 5 ? 'danger' : 'neutral'}>
                    {t('hq.applications.age', { n: a.ageDays })}
                  </Badge>
                </div>
                <p className="mt-1 text-sm">{a.proposedName}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {a.city} · {a.phone}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => router.push(`/hq/applications/${a.id}`)}>
                  {t('hq.applications.review')}
                </Button>
                <Button onClick={() => router.push(`/hq/applications/${a.id}`)}>
                  {t('hq.applications.approve')}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

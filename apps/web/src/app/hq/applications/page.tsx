'use client';

import { useRouter } from 'next/navigation';
import { FileText } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Badge, Button, Card, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { FranchiseApplication, FranchiseAppStage, Page } from '@/lib/types';

// Design 5a — franchise-application approvals queue (real depot-service track). The list
// endpoint already sorts oldest-first (highest SLA age); rows open the 5b detail.
const STAGE_TONE: Record<FranchiseAppStage, 'neutral' | 'brand' | 'warning' | 'success' | 'danger'> = {
  PENDING: 'neutral',
  DOC_VERIFICATION: 'brand',
  SURVEY: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
};

/** Whole days since submission = SLA age. */
function ageDays(submittedAt: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(submittedAt).getTime()) / 86_400_000));
}

export default function HqApplicationsPage() {
  const { t } = useT();
  const router = useRouter();
  const queue = useAsync<Page<FranchiseApplication>>(
    () => api.get(endpoints.franchiseApps.list({ limit: 100 }), true),
  );

  if (queue.loading) return <Skeleton className="h-96 w-full" />;
  if (queue.error) return <ErrorState message={t('hq.applications.loadError')} onRetry={queue.reload} />;

  const items = queue.data?.items ?? [];
  const pending = items.filter((a) => a.stage !== 'APPROVED' && a.stage !== 'REJECTED').length;

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={FileText}
        title={t('hq.applications.title')}
        subtitle={t('hq.applications.subtitle')}
        action={<Badge tone="warning">{t('hq.applications.count', { n: pending })}</Badge>}
      />

      {items.length === 0 ? (
        <Card className="p-8">
          <p className="text-center text-sm text-muted">{t('hq.applications.empty')}</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((a) => {
            const age = ageDays(a.submittedAt);
            return (
              <Card
                key={a.id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{a.applicantName}</span>
                    <Badge tone={STAGE_TONE[a.stage]}>{t(`hq.applications.stageName.${a.stage}`)}</Badge>
                    <Badge tone={age >= 5 ? 'danger' : 'neutral'}>
                      {t('hq.applications.age', { n: age })}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm">{a.proposedName}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {a.city} · {a.applicantPhone}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => router.push(`/hq/applications/${a.id}`)}>
                    {t('hq.applications.review')}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

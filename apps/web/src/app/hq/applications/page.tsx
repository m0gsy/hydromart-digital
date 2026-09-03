'use client';

import { useRouter } from 'next/navigation';
import { FileText } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Badge, Button, Card, ErrorState, ListFooter, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { usePagedList } from '@/lib/use-paged-list';
import type { FranchiseApplication, FranchiseAppStage } from '@/lib/types';

// Design 5a — franchise-application approvals queue (real depot-service track). The list
// endpoint already sorts oldest-first (highest SLA age); rows open the 5b detail.
const STAGE_TONE: Record<FranchiseAppStage, 'neutral' | 'brand' | 'warning' | 'success' | 'danger'> = {
  PENDING: 'neutral',
  DOC_VERIFICATION: 'brand',
  SURVEY: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
};

/*
 * CA-2-27. This queue is sorted OLDEST-FIRST — deliberately, because the oldest application
 * is the one breaching SLA — and it asked for exactly one page of 100. Put those two facts
 * together and a new applicant does not arrive at the bottom of the screen once the hundredth
 * application exists: they are not on the screen at all, and never will be until somebody
 * decides a hundred older ones. Nothing about the page said so; it looked like a queue with
 * a hundred things in it, which is what it will always look like.
 *
 * The pending badge had the same shape: it counted non-terminal rows within the slice, so it
 * could only ever say at most 100 however many were really waiting. It is now shown only once
 * every page is loaded — a count of part of the queue is not a smaller count, it is a wrong
 * one, and this screen exists to be believed.
 */
const PAGE_SIZE = 100;

/** Whole days since submission = SLA age. */
function ageDays(submittedAt: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(submittedAt).getTime()) / 86_400_000));
}

export default function HqApplicationsPage() {
  const { t } = useT();
  const router = useRouter();
  const queue = usePagedList<FranchiseApplication>(
    (page) => api.get(endpoints.franchiseApps.list({ page, limit: PAGE_SIZE }), true),
  );

  if (queue.loading && queue.rows.length === 0) return <Skeleton className="h-96 w-full" />;
  if (queue.error) return <ErrorState message={t('hq.applications.loadError')} onRetry={queue.reload} />;

  const items = queue.rows;
  const pending = items.filter((a) => a.stage !== 'APPROVED' && a.stage !== 'REJECTED').length;

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={FileText}
        title={t('hq.applications.title')}
        subtitle={t('hq.applications.subtitle')}
        // Only when the whole queue is loaded: a "menunggu" count taken from the first page
        // is not a smaller number, it is the wrong one.
        action={
          queue.hasMore ? undefined : (
            <Badge tone="warning">{t('hq.applications.count', { n: pending })}</Badge>
          )
        }
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
                  <Button variant="secondary" onClick={() => router.push(`/hq/applications/detail?id=${a.id}`)}>
                    {t('hq.applications.review')}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <ListFooter
        shown={items.length}
        total={queue.total}
        hasMore={queue.hasMore}
        onMore={queue.loadMore}
        loading={queue.loading}
      />
    </div>
  );
}

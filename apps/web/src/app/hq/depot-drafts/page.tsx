'use client';

import { useRouter } from 'next/navigation';
import { FileText } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Badge, Button, Card, ErrorState, ListFooter, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import type { DepotDraft, DepotDraftStatus } from '@/lib/depot-drafts';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { usePagedList } from '@/lib/use-paged-list';

// HD-21b: the depot drafts the CRM calon mitra made. The server sorts DRAFT first, newest first;
// a row opens the detail where HQ decides.
const TONE: Record<DepotDraftStatus, 'warning' | 'success' | 'danger'> = {
  DRAFT: 'warning',
  ACTIVATED: 'success',
  REJECTED: 'danger',
};
const PAGE_SIZE = 50;

export default function HqDepotDraftsPage() {
  const { t } = useT();
  const router = useRouter();
  const queue = usePagedList<DepotDraft>((page) =>
    api.get(endpoints.depotDrafts.list({ page, limit: PAGE_SIZE }), true),
  );

  if (queue.loading && queue.rows.length === 0) return <Skeleton className="h-96 w-full" />;
  if (queue.error) return <ErrorState message={t('hq.depotDrafts.loadError')} onRetry={queue.reload} />;

  const waiting = queue.rows.filter((d) => d.status === 'DRAFT').length;

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={FileText}
        title={t('hq.depotDrafts.title')}
        subtitle={t('hq.depotDrafts.subtitle')}
        // A count of the first page is the wrong number, so it only shows once every page is loaded.
        action={queue.hasMore ? undefined : <Badge tone="warning">{t('hq.depotDrafts.count', { n: waiting })}</Badge>}
      />

      {queue.rows.length === 0 ? (
        <Card className="p-8">
          <p className="text-center text-sm text-muted">{t('hq.depotDrafts.empty')}</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {queue.rows.map((d) => (
            <Card key={d.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{d.proposedName}</span>
                  <Badge tone={TONE[d.status]}>{t(`hq.depotDrafts.status.${d.status}`)}</Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  {d.city}, {d.province} · {t('hq.depotDrafts.createdOn', { d: d.createdAt.slice(0, 10) })}
                </p>
              </div>
              <Button variant="secondary" onClick={() => router.push(`/hq/depot-drafts/detail?id=${d.id}`)}>
                {t('hq.depotDrafts.review')}
              </Button>
            </Card>
          ))}
        </div>
      )}
      <ListFooter
        shown={queue.rows.length}
        total={queue.total}
        hasMore={queue.hasMore}
        onMore={queue.loadMore}
        loading={queue.loading}
      />
    </div>
  );
}

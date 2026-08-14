'use client';

import { Sheet } from '@/components/overlay';
import { useT } from '@/lib/locale-context';
import { Badge, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import type { CampaignDetail, RecipientStatus } from '@/lib/types';

const STATUS_TONE: Record<RecipientStatus, 'neutral' | 'success' | 'danger'> = {
  PENDING: 'neutral',
  SENT: 'success',
  FAILED: 'danger',
};
// Dictionary KEYS — module scope, so t() runs at the call site.
const STATUS_LABEL: Record<RecipientStatus, string> = {
  PENDING: 'hrFix.campaignReport.pending',
  SENT: 'hrFix.campaignReport.sent',
  FAILED: 'hrFix.campaignReport.failed',
};

/** Per-recipient delivery report for one campaign (10c). */
export function CampaignReport({ campaignId, onClose }: { campaignId: string; onClose: () => void }) {
  const { t } = useT();
  const detail = useAsync<CampaignDetail>(() => api.get(endpoints.crm.campaign(campaignId), true), [campaignId]);

  return (
    <Sheet open onClose={onClose} title={t('hrFix.campaignReport.title')}>
      {detail.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : detail.error ? (
        <ErrorState message={detail.error} onRetry={detail.reload} />
      ) : detail.data ? (
        <div className="flex flex-col gap-4">
          <div>
            <p className="font-semibold">{detail.data.name}</p>
            <p className="whitespace-pre-wrap text-sm text-muted">{detail.data.messageTemplate}</p>
          </div>

          <dl className="grid grid-cols-3 gap-2 text-center text-sm">
            <div className="rounded-2xl border border-app p-2.5">
              <dt className="text-xs text-muted">{t('hrFix.campaignReport.total')}</dt>
              <dd className="text-lg font-bold tabular-nums">{detail.data.totalRecipients}</dd>
            </div>
            <div className="rounded-2xl border border-app p-2.5">
              <dt className="text-xs text-muted">{t('hrFix.campaignReport.sent')}</dt>
              <dd className="text-lg font-bold tabular-nums text-emerald-700">{detail.data.sentCount}</dd>
            </div>
            <div className="rounded-2xl border border-app p-2.5">
              <dt className="text-xs text-muted">{t('hrFix.campaignReport.failed')}</dt>
              <dd className={`text-lg font-bold tabular-nums ${detail.data.failedCount > 0 ? 'text-red-600' : ''}`}>
                {detail.data.failedCount}
              </dd>
            </div>
          </dl>

          <div>
            <p className="mb-1.5 text-sm font-semibold">{t('hrFix.campaignReport.recipients')}</p>
            <ul className="flex flex-col gap-1.5">
              {detail.data.recipients.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{r.name || r.phone}</p>
                    <p className="truncate text-xs text-muted">
                      {r.phone}
                      {r.error ? ` · ${r.error}` : r.sentAt ? ` · ${formatDateTime(r.sentAt)}` : ''}
                    </p>
                  </div>
                  <Badge tone={STATUS_TONE[r.status]}>{t(STATUS_LABEL[r.status])}</Badge>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}

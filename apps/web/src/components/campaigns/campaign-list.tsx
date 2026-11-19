'use client';

import { useState } from 'react';
import { ChatCircleText, PaperPlaneTilt } from '@phosphor-icons/react';

import { useConfirm } from '@/components/confirm';
import { CampaignReport } from '@/components/dashboard/campaign-report';
import { Badge, Button, Card, CenterState, ErrorState, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { Campaign, CampaignStatus, Page } from '@/lib/types';

/**
 * Flow plan 5c: the campaign list — the only place a campaign is sent, cancelled or read back —
 * as one component. /dashboard/campaigns always had it; /hq/campaigns sent a campaign straight
 * from its builder and then had no way to see it again, let alone stop it.
 */
const STATUS_TONE: Record<CampaignStatus, 'neutral' | 'brand' | 'success' | 'warning'> = {
  DRAFT: 'neutral',
  SENDING: 'brand',
  SENT: 'success',
  COMPLETED_WITH_FAILURES: 'warning',
  CANCELLED: 'neutral',
};

function CampaignCard({
  campaign,
  canManage,
  onReport,
  onChanged,
}: {
  campaign: Campaign;
  canManage: boolean;
  onReport: () => void;
  onChanged: () => void;
}) {
  const { t } = useT();
  const { confirm } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const ok = await confirm({
      title: t('dashboard.campaigns.sendNow'),
      message: t('dashboard.campaigns.sendConfirm', {
        name: campaign.name,
        n: campaign.totalRecipients,
      }),
      confirmLabel: t('dashboard.campaigns.sendNow'),
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(endpoints.crm.sendCampaign(campaign.id), undefined, true);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('dashboard.campaigns.sendError'));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    const ok = await confirm({
      title: t('dashboard.campaigns.cancelCampaign'),
      message: t('dashboard.campaigns.cancelConfirm', { name: campaign.name }),
      confirmLabel: t('dashboard.campaigns.cancelCampaign'),
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(endpoints.crm.cancelCampaign(campaign.id), undefined, true);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('dashboard.campaigns.cancelError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{campaign.name}</p>
          <p className="text-xs text-muted">
            {campaign.channel} · {new Date(campaign.createdAt).toLocaleDateString('id-ID')}
            {/* A claimed scheduled campaign reads SENDING like one going out now; its time tells them apart. */}
            {campaign.scheduledFor &&
              ` · ${t('dashboard.campaigns.scheduledFor', { at: formatDateTime(campaign.scheduledFor) })}`}
          </p>
        </div>
        <Badge tone={STATUS_TONE[campaign.status]}>{campaign.status}</Badge>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-center text-sm">
        <div>
          <dt className="text-xs text-muted">{t('dashboard.campaigns.recipientsCol')}</dt>
          <dd className="font-semibold tabular-nums">{campaign.totalRecipients}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t('dashboard.campaigns.sent')}</dt>
          <dd className="font-semibold tabular-nums text-[color:var(--success)]">{campaign.sentCount}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t('dashboard.campaigns.failed')}</dt>
          <dd className={`font-semibold tabular-nums ${campaign.failedCount > 0 ? 'text-[color:var(--danger)]' : ''}`}>
            {campaign.failedCount}
          </dd>
        </div>
      </dl>
      {error && (
        <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 border-t border-app pt-2">
        <Button variant="ghost" onClick={onReport} disabled={busy}>
          {t('dashboard.campaigns.viewReport')}
        </Button>
        {canManage && (campaign.status === 'DRAFT' || campaign.status === 'SENDING') && (
          <Button variant="ghost" onClick={cancel} disabled={busy}>
            {t('dashboard.campaigns.cancelCampaign')}
          </Button>
        )}
        {canManage && campaign.status === 'DRAFT' && (
          <Button onClick={send} loading={busy}>
            <PaperPlaneTilt size={16} weight="fill" />
            {t('dashboard.campaigns.sendNow')}
          </Button>
        )}
      </div>
    </Card>
  );
}

export function CampaignList({
  canManage,
  emptyHint,
  refresh = 0,
}: {
  canManage: boolean;
  /** What the empty state says; it differs for a reader who may create campaigns. */
  emptyHint: string;
  /** Bump to read the list again (a campaign was just created or sent elsewhere on the page). */
  refresh?: number;
}) {
  const { t } = useT();
  const [reportId, setReportId] = useState<string | null>(null);
  const list = useAsync<Page<Campaign>>(
    () => api.get(endpoints.crm.campaigns({ limit: 50 }), true),
    [refresh],
  );
  const items = list.data?.items ?? [];

  return (
    <>
      {list.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : items.length === 0 ? (
        <CenterState title={t('dashboard.campaigns.noCampaigns')} icon={<ChatCircleText size={40} weight="fill" />}>
          {emptyHint}
        </CenterState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((c) => (
            <CampaignCard
              key={c.id}
              campaign={c}
              canManage={canManage}
              onReport={() => setReportId(c.id)}
              onChanged={list.reload}
            />
          ))}
        </div>
      )}
      {reportId && <CampaignReport campaignId={reportId} onClose={() => setReportId(null)} />}
    </>
  );
}

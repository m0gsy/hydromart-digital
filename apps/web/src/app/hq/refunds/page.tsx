'use client';

import { useState } from 'react';
import { Receipt } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Badge, Card, Chip, ErrorState, Money, Skeleton } from '@/components/ui';
import { useConfirm } from '@/components/confirm';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatIDR } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { Page, RefundQueueItem } from '@/lib/types';

// Design 14a — Persetujuan refund. Real payment-service track: cross-depot refunds above
// the HQ threshold awaiting approval. That threshold is read, not written here: it is
// REFUND_HQ_THRESHOLD, and the queue's own subtitle is the sentence that must move with it. Depot & order-number enrichment is not
// owned by payment-service (residual gap noted below); amount/method/reason/decision are real.
function hoursAgo(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000));
}

export default function HqRefundsPage() {
  const { t } = useT();
  const { toast } = useToast();
  const { askReason } = useConfirm();
  const queue = useAsync<Page<RefundQueueItem>>(() =>
    api.get(endpoints.refunds.queue({ limit: 100 }), true),
  );
  const rules = useAsync<{ hqApprovalThresholdIdr: number }>(() =>
    api.getCached(endpoints.refunds.rules, true),
  );
  const [busyId, setBusyId] = useState<string | null>(null);

  /*
   * CA-2-34. A refusal spends nobody's money but it ends somebody's claim, so it has to
   * say why — and the reason has to be the REJECTOR's. The screen sent `{}`, so the server
   * fell back to the requester's words and the audit read as though the person refusing
   * had written them.
   */
  async function decide(r: RefundQueueItem, approved: boolean) {
    let reason: string | null = null;
    if (!approved) {
      reason = await askReason({
        title: t('hq.refunds.rejectTitle'),
        message: t('hq.refunds.rejectMessage', {
          order: r.orderNumber ?? r.orderId.slice(0, 8),
        }),
        label: t('hq.refunds.rejectReason'),
        placeholder: t('hq.refunds.rejectReasonHint'),
        confirmLabel: t('hq.refunds.reject'),
      });
      if (!reason) return;
    }
    setBusyId(r.id);
    const ref = r.orderNumber ?? r.orderId.slice(0, 8);
    try {
      await api.post(
        approved ? endpoints.refunds.approve(r.id) : endpoints.refunds.reject(r.id),
        approved ? {} : { reason },
        true,
      );
      toast(
        approved
          ? t('hq.refunds.approved', { order: ref })
          : t('hq.refunds.rejected', { order: ref }),
        approved ? 'success' : 'info',
      );
      queue.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.refunds.approveError'), 'error');
    } finally {
      setBusyId(null);
    }
  }

  if (queue.loading) return <Skeleton className="h-96 w-full" />;
  if (queue.error) return <ErrorState message={t('hq.refunds.loadError')} onRetry={queue.reload} />;

  const items = queue.data?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={Receipt}
        title={t('hq.refunds.title')}
        // The threshold is REFUND_HQ_THRESHOLD, an env var — the subtitle said "Rp 100rb"
        // as a literal, so raising it left this screen quoting the old rule at HQ.
        subtitle={
          rules.data
            ? t('hq.refunds.subtitle', { amount: formatIDR(rules.data.hqApprovalThresholdIdr) })
            : undefined
        }
        action={
          <>
            <Badge tone="warning">{t('hq.refunds.count', { n: items.length })}</Badge>
          </>
        }
      />

      {items.length === 0 ? (
        <Card className="p-8">
          <p className="text-center text-sm text-muted">{t('hq.refunds.empty')}</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((r) => (
            <Card
              key={r.id}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">
                    {t('hq.refunds.order')} {r.orderNumber ?? r.orderId.slice(0, 8)}
                  </span>
                  <Chip tone="outline">{r.method}</Chip>
                </div>
                <p className="mt-1 text-sm">{r.refundReason ?? '—'}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {t('hq.refunds.age', { n: hoursAgo(r.updatedAt) })}
                </p>
              </div>
              <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-2">
                <Money amount={r.amount} className="text-lg font-bold text-brand-700" />
                <div className="flex gap-2">
                  {/*
                   * CA-2-34: a cancelled order that was paid gets its money back, so there
                   * is nothing to refuse. `null` is treated the same way — order-service
                   * could not be read, so this row cannot be PROVEN not to be cancelled,
                   * and the server refuses on exactly that basis. Saying why beats drawing
                   * a button whose only possible outcome is a 422.
                   */}
                  {r.orderStatus && r.orderStatus !== 'CANCELLED' ? (
                    <button
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => decide(r, false)}
                      className="rounded-lg px-3 py-1.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                    >
                      {t('hq.refunds.reject')}
                    </button>
                  ) : (
                    <span className="self-center text-xs text-muted">
                      {t(
                        r.orderStatus === 'CANCELLED'
                          ? 'hq.refunds.cannotRejectCancelled'
                          : 'hq.refunds.cannotRejectUnknown',
                      )}
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => decide(r, true)}
                    className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-700 disabled:opacity-50"
                  >
                    {t('hq.refunds.approve')}
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-muted">{t('hq.refunds.enrichNote')}</p>
    </div>
  );
}

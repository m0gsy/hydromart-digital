'use client';

import { useRouter } from 'next/navigation';
import { ClipboardText } from '@phosphor-icons/react';

import { Badge, Card, ErrorState, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { statusLabel, tone } from '@/lib/order-status';
import { useAsync } from '@/lib/use-async';
import type { Order, Page } from '@/lib/types';

const TONE_BADGE = { active: 'brand', done: 'success', cancelled: 'danger' } as const;

// Network order queue → drill-down at /hq/orders/[id]. Real: orders.manage (all depots).
export default function HqOrdersPage() {
  const { t } = useT();
  const router = useRouter();
  const list = useAsync<Page<Order>>(() => api.get(endpoints.orders.manage({ limit: 50 }), true));
  const items = list.data?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <ClipboardText size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">{t('hq.orders.title')}</h1>
          <p className="text-sm text-muted">{t('hq.orders.subtitle')}</p>
        </div>
      </div>

      {list.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : items.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">{t('hq.orders.empty')}</p>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[440px] text-sm">
            <thead>
              <tr className="border-b border-app text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-medium">{t('hq.orders.number')}</th>
                <th className="px-4 py-3 font-medium">{t('hq.orders.status')}</th>
                <th className="px-4 py-3 text-right font-medium">{t('hq.orders.total')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--border)]">
              {items.map((o) => (
                <tr
                  key={o.id}
                  className="cursor-pointer transition-colors hover:bg-[color:var(--surface-soft)]"
                  onClick={() => router.push(`/hq/orders/${o.id}`)}
                >
                  <td className="px-4 py-3">
                    <span className="block font-mono text-xs">{o.orderNumber}</span>
                    <span className="block text-xs text-muted">{formatDateTime(o.createdAt)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={TONE_BADGE[tone(o.status)]}>{statusLabel(o.status)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Money amount={o.total} className="font-medium" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

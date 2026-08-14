'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ClipboardText } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Badge, Card, ErrorState, LoadError, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { statusLabel, tone } from '@/lib/order-status';
import { useAsync } from '@/lib/use-async';
import type { Depot, Order, Page } from '@/lib/types';

const TONE_BADGE = { active: 'brand', done: 'success', cancelled: 'danger' } as const;

// Same pill the staff directory uses for its role filter.
function TrayTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        'rounded-full px-3 py-1.5 text-xs font-bold transition-colors ' +
        (active ? 'bg-brand-600 text-on-brand' : 'border border-app text-muted hover:bg-brand-50')
      }
    >
      {children}
    </button>
  );
}

// Network order queue → drill-down at /hq/orders/[id]. Real: orders.manage (all depots).
// The "unrouted" tray lists orders that reached no depot at all — legacy rows from when
// checkout failed open. They match no depot filter, so this is the only place they surface.
export default function HqOrdersPage() {
  const { t } = useT();
  const router = useRouter();
  const [tray, setTray] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);

  const list = useAsync<Page<Order>>(
    () => api.get(endpoints.orders.manage({ limit: 50, unrouted: tray || undefined }), true),
    [tray],
  );
  // Only needed for the tray's assign control; the public active list is enough.
  const depots = useAsync<Page<Depot>>(() => api.get(endpoints.depots.browse({ limit: 100 })));
  const items = list.data?.items ?? [];

  async function assign(orderId: string, depotId: string) {
    if (!depotId) return;
    setAssigning(orderId);
    setAssignError(null);
    try {
      await api.patch(endpoints.orders.assignDepot(orderId), { depotId }, true);
      list.reload();
    } catch (e) {
      setAssignError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setAssigning(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader icon={ClipboardText} title={t('hq.orders.title')} subtitle={t('hq.orders.subtitle')} />

      <div className="flex flex-wrap gap-2">
        <TrayTab active={!tray} onClick={() => setTray(false)}>
          {t('hq.orders.tabAll')}
        </TrayTab>
        <TrayTab active={tray} onClick={() => setTray(true)}>
          {t('hq.orders.tabUnrouted')}
        </TrayTab>
      </div>

      {tray && <p className="text-sm text-muted">{t('hq.orders.unroutedHint')}</p>}
      {assignError && (
        <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
          {assignError}
        </p>
      )}

      {list.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : items.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">
          {tray ? t('hq.orders.emptyUnrouted') : t('hq.orders.empty')}
        </p>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-app text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-medium">{t('hq.orders.number')}</th>
                <th className="px-4 py-3 font-medium">{t('hq.orders.customer')}</th>
                <th className="px-4 py-3 font-medium">{t('hq.orders.status')}</th>
                <th className="px-4 py-3 text-right font-medium">{t('hq.orders.total')}</th>
                {tray && <th className="px-4 py-3 font-medium">{t('hq.orders.assign')}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--border)]">
              {items.map((o) => (
                <tr
                  key={o.id}
                  className="cursor-pointer transition-colors hover:bg-[color:var(--surface-soft)]"
                  onClick={() => router.push(`/hq/orders/detail?id=${o.id}`)}
                >
                  <td className="px-4 py-3">
                    <span className="block font-mono text-xs">{o.orderNumber}</span>
                    <span className="block text-xs text-muted">{formatDateTime(o.createdAt)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="block font-medium">{o.recipientName}</span>
                    <span className="block text-xs text-muted">{o.phone}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={TONE_BADGE[tone(o.status)]}>{statusLabel(o.status)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Money amount={o.total} className="font-medium" />
                  </td>
                  {tray && (
                    // Row click navigates, so the assign control stops the bubble itself.
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <select
                        aria-label={t('hq.orders.assign')}
                        disabled={assigning === o.id}
                        defaultValue=""
                        onChange={(e) => assign(o.id, e.target.value)}
                        className="rounded-lg border border-app bg-transparent px-2 py-1 text-xs"
                      >
                        <option value="">{t('hq.orders.assignPlaceholder')}</option>
                        {(depots.data?.items ?? []).map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name} · {d.city}
                          </option>
                        ))}
                      </select>
                      {/* An empty picker looks like a network with no depot to assign to. */}
                      {depots.error && <LoadError onRetry={depots.reload} />}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

'use client';

import { Bell, Warning } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Badge, Button, Card, ErrorState, Skeleton } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { useOpsNotifications } from '@/lib/ops-notifications';

// Design 16e — ops notification stream.
//
// "Mark read" used to be a local Set and a toast: the receipt never left the browser, so
// the same alert came back unread on the next visit and on every other device. The read
// state is server-owned (`notifications/ops/:id/read`), and this screen now uses the same
// hook `dashboard/notifications` does rather than a second, weaker copy of the idea.
export default function HqNotificationsPage() {
  const { t } = useT();
  const { feed, all: items, isRead, markRead, markAllRead } = useOpsNotifications();

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={Bell}
        title={t('hq.notifications.title')}
        subtitle={t('hq.notifications.subtitle')}
        action={
          <>
            {items.length > 0 && (
              <Button variant="secondary" onClick={markAllRead}>
                {t('hq.notifications.markAll')}
              </Button>
            )}
          </>
        }
      />

      {feed.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : feed.error ? (
        <ErrorState message={feed.error} onRetry={feed.reload} />
      ) : items.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">{t('hq.notifications.empty')}</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.map((n) => {
            const read = isRead(n);
            return (
              <Card key={n.id} className={`flex items-start gap-3 p-3.5 ${read ? 'opacity-60' : ''}`}>
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[color:var(--warning-bg)]">
                  <Warning size={16} weight="fill" className="text-[color:var(--warning)]" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">{n.event}</p>
                    {n.status === 'FAILED' && <Badge tone="danger">{t('hq.notifications.failed')}</Badge>}
                  </div>
                  <p className="mt-0.5 text-sm text-muted">{n.message}</p>
                  <p className="mt-1 text-xs text-muted">{formatDateTime(n.createdAt)}</p>
                </div>
                {!read && (
                  <button
                    type="button"
                    onClick={() => markRead(n)}
                    className="shrink-0 text-xs font-semibold text-brand-700 hover:underline"
                  >
                    {t('hq.notifications.markRead')}
                  </button>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

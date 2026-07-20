'use client';

import { Bell, Lock, Warning } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Card, CenterState, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { canViewOpsNotifications } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { OpsNotification } from '@/lib/types';

const EVENT_LABELS: Record<string, string> = {
  STOCK_LOW: 'dashB.notifications.stockLow',
};

function NotifRow({ n }: { n: OpsNotification }) {
  const { t } = useT();
  const eventKey = EVENT_LABELS[n.event];
  const failed = n.status === 'FAILED';
  return (
    <Card className="flex items-start gap-3 p-3.5">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100">
        <Warning size={16} weight="fill" className="text-amber-700" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold">{eventKey ? t(eventKey) : n.event}</p>
          {failed && <Badge tone="danger">{t('dashB.notifications.sendFailed')}</Badge>}
        </div>
        <p className="mt-0.5 text-sm text-muted">{n.message}</p>
        <p className="mt-1 text-xs text-muted">{new Date(n.createdAt).toLocaleString('id-ID')}</p>
      </div>
    </Card>
  );
}

function NotificationsBody() {
  const { t } = useT();
  const feed = useAsync<OpsNotification[]>(() => api.get(endpoints.notifications.ops, true), []);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <Bell size={24} weight="fill" className="text-brand-500" />
        <h1 className="text-2xl font-bold">{t('dashB.notifications.title')}</h1>
      </div>
      <p className="text-[12.5px] text-muted">{t('dashB.notifications.subtitle')}</p>

      {feed.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : feed.error ? (
        <ErrorState message={feed.error} onRetry={feed.reload} />
      ) : !feed.data || feed.data.length === 0 ? (
        <CenterState title={t('dashB.notifications.empty')} icon={<Bell size={40} weight="fill" />}>
          {t('dashB.notifications.emptyBody')}
        </CenterState>
      ) : (
        <div className="flex flex-col gap-2.5">
          {feed.data.map((n) => (
            <NotifRow key={n.id} n={n} />
          ))}
        </div>
      )}
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!canViewOpsNotifications(customer?.role)) {
    return (
      <CenterState title={t('dashB.notifications.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('dashB.notifications.gateBody')}
      </CenterState>
    );
  }
  return <NotificationsBody />;
}

export default function OpsNotificationsPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}

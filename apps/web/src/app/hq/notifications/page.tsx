'use client';

import { useState } from 'react';
import { Bell, Warning } from '@phosphor-icons/react';

import { Badge, Button, Card, ErrorState, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { OpsNotification } from '@/lib/types';

// Design 16e — ops notification stream. Real feed: notifications.ops. "Mark read" is
// client-only (no read-state endpoint) — tracked in a local set, not a fabricated value.
export default function HqNotificationsPage() {
  const { t } = useT();
  const { toast } = useToast();
  const feed = useAsync<OpsNotification[]>(() => api.get(endpoints.notifications.ops, true));
  const [read, setRead] = useState<Set<string>>(new Set());

  const items = feed.data ?? [];

  function markAll() {
    setRead(new Set(items.map((n) => n.id)));
    toast(t('hq.notifications.markedAll'), 'success');
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Bell size={24} weight="fill" className="text-brand-500" />
          <div>
            <h1 className="text-2xl font-bold">{t('hq.notifications.title')}</h1>
            <p className="text-sm text-muted">{t('hq.notifications.subtitle')}</p>
          </div>
        </div>
        {items.length > 0 && (
          <Button variant="secondary" onClick={markAll}>
            {t('hq.notifications.markAll')}
          </Button>
        )}
      </div>

      {feed.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : feed.error ? (
        <ErrorState message={feed.error} onRetry={feed.reload} />
      ) : items.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">{t('hq.notifications.empty')}</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.map((n) => {
            const isRead = read.has(n.id);
            return (
              <Card key={n.id} className={`flex items-start gap-3 p-3.5 ${isRead ? 'opacity-60' : ''}`}>
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
                {!isRead && (
                  <button
                    type="button"
                    onClick={() => setRead((s) => new Set(s).add(n.id))}
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

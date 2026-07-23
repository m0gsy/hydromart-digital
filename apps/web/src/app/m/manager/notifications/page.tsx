'use client';

import { useMemo } from 'react';
import { Bell, Siren, WarningOctagon, type Icon } from '@phosphor-icons/react';

import { Badge, CenterState, ErrorState, Skeleton } from '@/components/ui';
import { useT } from '@/lib/locale-context';
import { OPS_FILTERS, groupOpsFeedByDay, useOpsNotifications } from '@/lib/ops-notifications';
import type { OpsNotification } from '@/lib/types';

// Per-event styling for the two real ops events (crm NotificationEvent OPS_EVENTS).
// Labels come from the dict; unknown events fall back to the raw event + neutral bell.
const EVENT_STYLE: Record<string, { icon: Icon; wrap: string; fg: string }> = {
  STOCK_LOW: { icon: WarningOctagon, wrap: 'bg-red-100', fg: 'text-[color:var(--danger)]' },
  COURIER_INCIDENT: { icon: Siren, wrap: 'bg-amber-100', fg: 'text-amber-700' },
};

function dayBucket(iso: string, today: string, yesterday: string): string {
  const d = new Date(iso);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(new Date()) - startOf(d)) / 86_400_000);
  if (diffDays <= 0) return today;
  if (diffDays === 1) return yesterday;
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

function NotifRow({ n, read, onRead }: { n: OpsNotification; read: boolean; onRead: () => void }) {
  const { t } = useT();
  const style = EVENT_STYLE[n.event] ?? { icon: Bell, wrap: 'bg-brand-50', fg: 'text-brand-700' };
  const Glyph = style.icon;
  const label = t(`mgrFix.mMgr.events.${n.event}`);
  return (
    // Plain button, not <Card>: a Card renders a <div>, which a <button> may not contain.
    <button
      type="button"
      onClick={onRead}
      className={`surface flex w-full items-start gap-3 rounded-2xl border border-app p-3.5 text-left shadow-card transition-opacity ${read ? 'opacity-65' : ''}`}
    >
      <span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg ${style.wrap}`}>
        <Glyph size={16} weight="fill" className={style.fg} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold">{label.startsWith('mgrFix.') ? n.event : label}</p>
          {n.status === 'FAILED' && <Badge tone="danger">{t('dashB.notifications.sendFailed')}</Badge>}
        </div>
        <p className="mt-0.5 text-sm text-[color:var(--text-muted)]">{n.message}</p>
        <p className="mt-1 text-xs tabular-nums text-[color:var(--text-muted)]">
          {new Date(n.createdAt).toLocaleString('id-ID')}
        </p>
      </div>
      {!read && <span className="mt-2 size-2 shrink-0 rounded-full bg-[color:var(--danger)]" aria-hidden />}
    </button>
  );
}

export default function ManagerNotificationsPage() {
  const { t } = useT();
  // Same feed, filters, grouping and read receipts as the desktop ops centre — only the
  // presentation is mobile-first (design 11a parity).
  const { feed, all, visible, filter, setFilter, isRead, unreadCount, markRead, markAllRead } =
    useOpsNotifications();

  const groups = useMemo(
    () => groupOpsFeedByDay(visible, (iso) => dayBucket(iso, t('opsFix.notif.today'), t('opsFix.notif.yesterday'))),
    [visible, t],
  );

  return (
    <div className="space-y-3 px-4 py-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight">{t('mgrFix.mMgr.notifTitle')}</h1>
          <p className="mt-0.5 text-[12.5px] text-[color:var(--text-muted)]">{t('mgrFix.mMgr.notifSubtitle')}</p>
        </div>
        {unreadCount > 0 && (
          <button type="button" onClick={markAllRead} className="shrink-0 text-xs font-semibold text-brand-700">
            {t('opsFix.notif.markAllRead')}
          </button>
        )}
      </header>

      <div className="flex flex-wrap gap-2">
        {OPS_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              filter === f.key ? 'bg-brand-800 text-on-brand' : 'border border-app text-[color:var(--text-muted)]'
            }`}
          >
            {t(f.labelKey)}
            {f.key === 'unread' && unreadCount > 0 && <span className="tabular-nums">· {unreadCount}</span>}
          </button>
        ))}
      </div>

      {feed.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : feed.error ? (
        <ErrorState message={feed.error} onRetry={feed.reload} />
      ) : all.length === 0 ? (
        <CenterState icon={<Bell size={32} />} title={t('dashB.notifications.empty')}>
          {t('dashB.notifications.emptyBody')}
        </CenterState>
      ) : visible.length === 0 ? (
        <CenterState icon={<Bell size={32} />} title={t('opsFix.notif.noUnread')}>
          {t('opsFix.notif.readNote')}
        </CenterState>
      ) : (
        <div className="space-y-2.5">
          {groups.map((g) => (
            <div key={g.label} className="space-y-2.5">
              <p className="pt-1 text-[10.5px] font-bold uppercase tracking-wide text-[color:var(--text-muted)]">
                {g.label}
              </p>
              {g.items.map((n) => (
                <NotifRow key={n.id} n={n} read={isRead(n)} onRead={() => markRead(n)} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

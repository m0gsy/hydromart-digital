'use client';

import { useMemo, useState } from 'react';
import { Bell, Lock, Package, Siren, Warning, type Icon } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Card, CenterState, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useT, type TVars } from '@/lib/locale-context';
import { canViewOpsNotifications } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { OpsNotification } from '@/lib/types';

type T = (key: string, vars?: TVars) => string;

// Per-event presentation. The ops feed only emits STOCK_LOW + COURIER_INCIDENT today
// (crm-service OPS_EVENTS); anything new falls back to the neutral bell style.
const EVENT_STYLE: Record<string, { icon: Icon; iconClass: string; bgClass: string; labelKey: string; group: 'stock' | 'courier' }> = {
  STOCK_LOW: { icon: Warning, iconClass: 'text-[color:var(--danger)]', bgClass: 'bg-[color:var(--danger-bg)]', labelKey: 'opsFix.notif.stockLow', group: 'stock' },
  COURIER_INCIDENT: { icon: Siren, iconClass: 'text-red-700', bgClass: 'bg-red-50', labelKey: 'opsFix.notif.courierIncident', group: 'courier' },
};
const FALLBACK_STYLE = { icon: Package, iconClass: 'text-brand-700', bgClass: 'bg-brand-50' };

type Filter = 'all' | 'unread' | 'stock' | 'courier';

function dayBucket(iso: string, t: T): string {
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (diffDays <= 0) return t('opsFix.notif.today');
  if (diffDays === 1) return t('opsFix.notif.yesterday');
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

function NotifRow({ n, read, onToggle }: { n: OpsNotification; read: boolean; onToggle: () => void }) {
  const { t } = useT();
  const style = EVENT_STYLE[n.event];
  const RIcon = style?.icon ?? FALLBACK_STYLE.icon;
  const failed = n.status === 'FAILED';
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-[color:var(--surface-soft)] ${read ? 'opacity-65' : ''}`}
    >
      <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${style?.bgClass ?? FALLBACK_STYLE.bgClass}`}>
        <RIcon size={17} weight="fill" className={style?.iconClass ?? FALLBACK_STYLE.iconClass} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold">{style ? t(style.labelKey) : n.event}</p>
          {failed && <Badge tone="danger">{t('dashB.notifications.sendFailed')}</Badge>}
        </div>
        <p className="mt-0.5 text-sm text-muted">{n.message}</p>
        <p className="mt-1 text-xs tabular-nums text-muted">{new Date(n.createdAt).toLocaleString('id-ID')}</p>
      </div>
      {!read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[color:var(--danger)]" aria-hidden />}
    </button>
  );
}

function FilterChip({ active, count, onClick, children }: { active: boolean; count?: number; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
        active ? 'bg-brand-800 text-on-brand' : 'border border-app text-[color:var(--text-muted)] hover:bg-brand-50'
      }`}
    >
      {children}
      {count != null && count > 0 && <span className="tabular-nums">· {count}</span>}
    </button>
  );
}

function NotificationsBody() {
  const { t } = useT();
  const feed = useAsync<OpsNotification[]>(() => api.get(endpoints.notifications.ops, true), []);
  const [filter, setFilter] = useState<Filter>('all');
  // ponytail: read-state is per-session only — crm-service exposes no ops mark-read
  // endpoint (GET-only feed). Persist server-side when one lands.
  const [readIds, setReadIds] = useState<Set<string>>(new Set());

  const all = feed.data ?? [];
  const unreadCount = all.filter((n) => !readIds.has(n.id)).length;

  const visible = useMemo(
    () =>
      all.filter((n) => {
        if (filter === 'unread') return !readIds.has(n.id);
        if (filter === 'stock') return EVENT_STYLE[n.event]?.group === 'stock';
        if (filter === 'courier') return EVENT_STYLE[n.event]?.group === 'courier';
        return true;
      }),
    [all, filter, readIds],
  );

  // Group the filtered feed by day bucket, preserving the newest-first order.
  const groups = useMemo(() => {
    const out: { label: string; items: OpsNotification[] }[] = [];
    for (const n of visible) {
      const label = dayBucket(n.createdAt, t);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(n);
      else out.push({ label, items: [n] });
    }
    return out;
  }, [visible, t]);

  function toggleRead(id: string) {
    setReadIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Bell size={24} weight="fill" className="text-brand-500" />
          <h1 className="text-2xl font-bold">{t('opsFix.notif.title')}</h1>
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={() => setReadIds(new Set(all.map((n) => n.id)))}
            className="text-sm font-semibold text-brand-700 hover:underline"
          >
            {t('opsFix.notif.markAllRead')}
          </button>
        )}
      </div>
      <p className="text-[12.5px] text-muted">{t('dashB.notifications.subtitle')}</p>

      <div className="flex flex-wrap gap-2">
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>{t('opsFix.notif.filterAll')}</FilterChip>
        <FilterChip active={filter === 'unread'} count={unreadCount} onClick={() => setFilter('unread')}>{t('opsFix.notif.filterUnread')}</FilterChip>
        <FilterChip active={filter === 'stock'} onClick={() => setFilter('stock')}>{t('opsFix.notif.filterStock')}</FilterChip>
        <FilterChip active={filter === 'courier'} onClick={() => setFilter('courier')}>{t('opsFix.notif.filterCourier')}</FilterChip>
      </div>

      {feed.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : feed.error ? (
        <ErrorState message={feed.error} onRetry={feed.reload} />
      ) : all.length === 0 ? (
        <CenterState title={t('dashB.notifications.empty')} icon={<Bell size={40} weight="fill" />}>
          {t('dashB.notifications.emptyBody')}
        </CenterState>
      ) : visible.length === 0 ? (
        <CenterState title={t('opsFix.notif.noUnread')} icon={<Bell size={40} weight="fill" />}>
          {t('opsFix.notif.localNote')}
        </CenterState>
      ) : (
        <Card className="flex flex-col gap-1 p-2">
          {groups.map((g) => (
            <div key={g.label}>
              <p className="px-3 pb-1 pt-2 text-[10.5px] font-bold uppercase tracking-wide text-[color:var(--text-muted)]">{g.label}</p>
              {g.items.map((n) => (
                <NotifRow key={n.id} n={n} read={readIds.has(n.id)} onToggle={() => toggleRead(n.id)} />
              ))}
            </div>
          ))}
          <p className="px-3 pb-1 pt-2 text-[11px] text-muted">{t('opsFix.notif.localNote')}</p>
        </Card>
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

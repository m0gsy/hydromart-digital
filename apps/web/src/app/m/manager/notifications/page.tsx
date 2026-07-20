'use client';

import { Bell, Siren, WarningOctagon, type Icon } from '@phosphor-icons/react';

import { Badge, Card, CenterState, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { OpsNotification } from '@/lib/types';

// Per-event styling for the two real ops events (crm NotificationEvent OPS_EVENTS).
// Labels come from the dict; unknown events fall back to the raw event + neutral bell.
const EVENT_STYLE: Record<string, { icon: Icon; wrap: string; fg: string }> = {
  STOCK_LOW: { icon: WarningOctagon, wrap: 'bg-red-100', fg: 'text-[color:var(--danger)]' },
  COURIER_INCIDENT: { icon: Siren, wrap: 'bg-amber-100', fg: 'text-amber-700' },
};

function NotifRow({ n }: { n: OpsNotification }) {
  const { t } = useT();
  const style = EVENT_STYLE[n.event] ?? { icon: Bell, wrap: 'bg-brand-50', fg: 'text-brand-700' };
  const Glyph = style.icon;
  const label = t(`mgrFix.mMgr.events.${n.event}`);
  return (
    <Card className="flex items-start gap-3 p-3.5">
      <span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg ${style.wrap}`}>
        <Glyph size={16} weight="fill" className={style.fg} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold">{label.startsWith('mgrFix.') ? n.event : label}</p>
          {n.status === 'FAILED' && <Badge tone="danger">Gagal kirim</Badge>}
        </div>
        <p className="mt-0.5 text-sm text-[color:var(--text-muted)]">{n.message}</p>
        <p className="mt-1 text-xs text-[color:var(--text-muted)]">
          {new Date(n.createdAt).toLocaleString('id-ID')}
        </p>
      </div>
    </Card>
  );
}

export default function ManagerNotificationsPage() {
  const feed = useAsync<OpsNotification[]>(() => api.get(endpoints.notifications.ops, true), []);

  return (
    <div className="space-y-3 px-4 py-6">
      <header>
        <h1 className="text-xl font-extrabold tracking-tight">Notifikasi ops</h1>
        <p className="mt-0.5 text-[12.5px] text-[color:var(--text-muted)]">
          Peringatan operasional terbaru.
        </p>
      </header>

      {feed.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : feed.error ? (
        <ErrorState message={feed.error} onRetry={feed.reload} />
      ) : !feed.data || feed.data.length === 0 ? (
        <CenterState icon={<Bell size={32} />} title="Tidak ada peringatan">
          Peringatan seperti stok menipis akan muncul di sini.
        </CenterState>
      ) : (
        <div className="space-y-2.5">
          {feed.data.map((n) => (
            <NotifRow key={n.id} n={n} />
          ))}
        </div>
      )}
    </div>
  );
}

'use client';

import { useEffect, useRef } from 'react';
import { useT } from '@/lib/locale-context';
import { CalendarBlank, Megaphone, Warning } from '@phosphor-icons/react';

import { DriverShell } from '@/components/driver/driver-shell';
import { CenterState, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import type { Broadcast } from '@/lib/types';

const WHEN = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

// 3 tiers (design 8a): Mendesak (URGENT) / Terjadwal (SCHEDULED) / Info (INFO).
// Dictionary KEYS — module scope, so t() runs where the tier is rendered.
const TIERS = {
  URGENT: { label: 'hrFix.driverAnnouncements.urgent', icon: Warning, iconClass: 'text-red-600', card: 'border-red-200 bg-red-50', pill: 'bg-red-100 text-red-700' },
  SCHEDULED: { label: 'hrFix.driverAnnouncements.scheduled', icon: CalendarBlank, iconClass: 'text-amber-600', card: 'border-amber-200 bg-amber-50', pill: 'bg-amber-100 text-amber-700' },
  INFO: { label: 'hrFix.driverAnnouncements.info', icon: Megaphone, iconClass: 'text-brand-700', card: 'border-[color:var(--border)] bg-[color:var(--surface)]', pill: 'bg-brand-50 text-brand-700' },
} as const;

function Announcements({ depotId }: { depotId: string }) {
  const { t } = useT();
  const feed = useAsync<Broadcast[]>(() => api.get(endpoints.broadcasts.forDepot(depotId), true), [depotId]);
  // Mark everything read once on open — the inbox has no per-item read UI (design 8a).
  // ponytail: mark-all-on-view; add per-item read receipts only if the design later needs them.
  const markedRef = useRef(false);

  useEffect(() => {
    if (markedRef.current || !feed.data) return;
    markedRef.current = true;
    const unread = feed.data.filter((b) => !b.read);
    // Fire-and-forget; a failed receipt just leaves the dot for next open.
    for (const b of unread) void api.post(endpoints.broadcasts.read(b.id), {}, true).catch(() => {});
  }, [feed.data]);

  if (feed.loading) return <div className="p-5"><Skeleton className="h-64 w-full" /></div>;
  if (feed.error) return <div className="p-5"><ErrorState message={feed.error} onRetry={feed.reload} /></div>;

  const items = feed.data ?? [];

  return (
    <div className="space-y-4 px-4 py-6">
      <h1 className="text-lg font-extrabold tracking-tight">{t('hrFix.driverAnnouncements.title')}</h1>
      {items.length === 0 ? (
        <CenterState icon={<Megaphone size={32} />} title={t('hrFix.driverAnnouncements.empty')}>
          {t('hrFix.driverAnnouncements.emptyBody2')}
        </CenterState>
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.map((b) => {
            const tier = TIERS[b.level] ?? TIERS.INFO;
            const Icon = tier.icon;
            return (
              <div
                key={b.id}
                className={`rounded-2xl border p-4 ${tier.card}`}
              >
                <div className="flex items-center gap-2">
                  <Icon size={16} weight="fill" className={tier.iconClass} />
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${tier.pill}`}>
                    {t(tier.label)}
                  </span>
                  <div className="flex-1 text-sm font-extrabold">{b.title}</div>
                  {!b.read && <span className="size-2 rounded-full bg-brand-600" aria-label={t('hrFix.driverAnnouncements.unreadAria')} />}
                </div>
                <p className="mt-1.5 whitespace-pre-line text-[13px] text-black/70">{b.body}</p>
                <div className="mt-2 text-[11px] tabular-nums text-[color:var(--muted)]">
                  {WHEN.format(new Date(b.createdAt))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AnnouncementsPage() {
  const { t } = useT();
  const { customer } = useAuth();
  const depotId = customer?.assignedDepotId ?? null;
  return (
    <DriverShell nav={false}>
      {depotId ? (
        <Announcements depotId={depotId} />
      ) : (
        <div className="px-4 py-6">
          <h1 className="text-lg font-extrabold tracking-tight">{t('hrFix.driverAnnouncements.title')}</h1>
          <CenterState icon={<Megaphone size={32} />} title={t('hrFix.driverAnnouncements.noDepot')}>
            {t('hrFix.driverAnnouncements.noDepotBody')}
          </CenterState>
        </div>
      )}
    </DriverShell>
  );
}

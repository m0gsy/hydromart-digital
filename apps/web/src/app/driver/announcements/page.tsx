'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/locale-context';
import { CalendarBlank, Megaphone, Warning } from '@phosphor-icons/react';

import { DriverShell } from '@/components/driver/driver-shell';
import { Button, CenterState, ErrorState, LoadError, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { myAnnouncements, type MyAnnouncement } from '@/lib/hr-announcements';
import { useAsync } from '@/lib/use-async';
import type { Broadcast } from '@/lib/types';

const WHEN = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

// Depot broadcasts come in 3 tiers (design 8a: Mendesak / Terjadwal / Info), HR announcements
// in Info / Peringatan / Mendesak. Dictionary KEYS — module scope, so t() runs where rendered.
const TIERS = {
  URGENT: { label: 'hrFix.driverAnnouncements.urgent', icon: Warning, iconClass: 'text-red-600', card: 'border-red-200 bg-red-50', pill: 'bg-red-100 text-red-700' },
  SCHEDULED: { label: 'hrFix.driverAnnouncements.scheduled', icon: CalendarBlank, iconClass: 'text-amber-600', card: 'border-amber-200 bg-amber-50', pill: 'bg-amber-100 text-amber-700' },
  WARNING: { label: 'hrFix.map.announceLevel.WARNING', icon: Warning, iconClass: 'text-amber-600', card: 'border-amber-200 bg-amber-50', pill: 'bg-amber-100 text-amber-700' },
  INFO: { label: 'hrFix.driverAnnouncements.info', icon: Megaphone, iconClass: 'text-brand-700', card: 'border-[color:var(--border)] bg-[color:var(--surface)]', pill: 'bg-brand-50 text-brand-700' },
} as const;

/** One row of the inbox, whichever service sent it. */
interface Item {
  key: string;
  from: 'depot' | 'hr';
  id: string;
  level: keyof typeof TIERS;
  title: string;
  body: string;
  at: string;
  read: boolean;
}

/**
 * Flow plan 5d: ONE inbox for the courier. Depot broadcasts (crm) and HR's announcements used
 * to live on two screens, and the courier app only had a door to the first — what HR sent a
 * courier sat on /hr/me/announcements, which nothing in the courier app opened.
 */
function Inbox({ depotId }: { depotId: string | null }) {
  const { t } = useT();
  const depot = useAsync<Broadcast[]>(
    () => (depotId ? api.get(endpoints.broadcasts.forDepot(depotId), true) : Promise.resolve([])),
    [depotId],
  );
  const hr = useAsync<MyAnnouncement[]>(myAnnouncements);
  const [markError, setMarkError] = useState<string | null>(null);
  const [marking, setMarking] = useState<string | null>(null);

  // Depot broadcasts: every unread one marked read once it is on screen — that inbox never had
  // per-item read UI (design 8a). Remembered per id, so one that arrives with a re-read (the
  // app back from the background) is marked too. ponytail: mark-on-view; per-item receipts
  // only if the design asks.
  const marked = useRef(new Set<string>());
  useEffect(() => {
    for (const b of (depot.data ?? []).filter((x) => !x.read && !marked.current.has(x.id))) {
      marked.current.add(b.id);
      // Fire-and-forget; a failed receipt just leaves the dot for next open.
      void api.post(endpoints.broadcasts.read(b.id), {}, true).catch(() => {});
    }
  }, [depot.data]);

  // HR's receipts stay per item, as on /hr/me/announcements: HR reads them as "this person has
  // read it", which opening a list does not prove.
  async function markHrRead(id: string) {
    setMarkError(null);
    setMarking(id);
    try {
      await api.post(endpoints.hr.readAnnouncement(id), {}, true);
      hr.reload();
    } catch (err) {
      setMarkError(err instanceof ApiError ? err.message : t('hrFix.myAnnouncements.markFailed'));
    } finally {
      setMarking(null);
    }
  }

  if (depot.loading && hr.loading) return <div className="p-5"><Skeleton className="h-64 w-full" /></div>;
  if (depot.error && hr.error)
    return <div className="p-5"><ErrorState message={depot.error} onRetry={() => { depot.reload(); hr.reload(); }} /></div>;

  const items: Item[] = [
    ...(depot.data ?? []).map((b): Item => ({
      key: `d-${b.id}`,
      from: 'depot',
      id: b.id,
      level: b.level,
      title: b.title,
      body: b.body,
      at: b.createdAt,
      read: b.read,
    })),
    ...(hr.data ?? []).map((a): Item => ({
      key: `h-${a.id}`,
      from: 'hr',
      id: a.id,
      level: a.level,
      title: a.title,
      body: a.body,
      at: a.publishedAt ?? a.createdAt,
      read: a.read,
    })),
  ].sort((x, y) => y.at.localeCompare(x.at));

  return (
    <div className="space-y-4 px-4 py-6">
      <h1 className="text-lg font-extrabold tracking-tight">{t('hrFix.driverAnnouncements.title')}</h1>
      {/* One source down must not blank the other: what was read is still shown. */}
      {depot.error && <LoadError onRetry={depot.reload} />}
      {hr.error && <LoadError onRetry={hr.reload} />}
      {markError && (
        <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
          {markError}
        </p>
      )}
      {!depotId && <p className="text-xs text-[color:var(--text-muted)]">{t('hrFix.driverAnnouncements.noDepotBody')}</p>}
      {items.length === 0 && !depot.loading && !hr.loading ? (
        <CenterState icon={<Megaphone size={32} />} title={t('hrFix.driverAnnouncements.empty')}>
          {t('hrFix.driverAnnouncements.emptyBody2')}
        </CenterState>
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.map((it) => {
            const tier = TIERS[it.level] ?? TIERS.INFO;
            const Icon = tier.icon;
            return (
              <div key={it.key} className={`rounded-2xl border p-4 ${tier.card}`}>
                <div className="flex items-center gap-2">
                  <Icon size={16} weight="fill" className={tier.iconClass} />
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${tier.pill}`}>
                    {t(tier.label)}
                  </span>
                  <div className="flex-1 text-sm font-extrabold">{it.title}</div>
                  {!it.read && <span className="size-2 rounded-full bg-brand-600" aria-label={t('hrFix.driverAnnouncements.unreadAria')} />}
                </div>
                <p className="mt-1.5 whitespace-pre-line text-[13px] text-black/70">{it.body}</p>
                <div className="mt-2 flex items-center justify-between gap-2 text-[11px] tabular-nums text-[color:var(--text-muted)]">
                  <span>
                    {t(it.from === 'hr' ? 'hrFix.driverAnnouncements.fromHr' : 'hrFix.driverAnnouncements.fromDepot')} ·{' '}
                    {WHEN.format(new Date(it.at))}
                  </span>
                  {it.from === 'hr' && !it.read && (
                    <Button
                      variant="secondary"
                      onClick={() => markHrRead(it.id)}
                      loading={marking === it.id}
                    >
                      {t('hrFix.myAnnouncements.markRead2')}
                    </Button>
                  )}
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
  const { customer } = useAuth();
  return (
    <DriverShell nav={false}>
      <Inbox depotId={customer?.assignedDepotId ?? null} />
    </DriverShell>
  );
}

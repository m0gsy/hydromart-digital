'use client';

import { useEffect, useRef } from 'react';
import { Megaphone, Warning } from '@phosphor-icons/react';

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

function Announcements({ depotId }: { depotId: string }) {
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
      <h1 className="text-lg font-extrabold tracking-tight">Pengumuman</h1>
      {items.length === 0 ? (
        <CenterState icon={<Megaphone size={32} />} title="Belum ada pengumuman">
          Info operasional dari depot akan muncul di sini.
        </CenterState>
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.map((b) => {
            // Backend enum is INFO | URGENT only. The spec's third "Terjadwal" tier needs a
            // SCHEDULED enum on broadcast-service — ponytail: map the two real levels for now.
            const urgent = b.level === 'URGENT';
            return (
              <div
                key={b.id}
                className={`rounded-2xl border p-4 ${
                  urgent
                    ? 'border-red-200 bg-red-50'
                    : 'border-[color:var(--border)] bg-[color:var(--surface)]'
                }`}
              >
                <div className="flex items-center gap-2">
                  {urgent ? (
                    <Warning size={16} weight="fill" className="text-red-600" />
                  ) : (
                    <Megaphone size={16} weight="fill" className="text-brand-700" />
                  )}
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${
                      urgent ? 'bg-red-100 text-red-700' : 'bg-brand-100 text-brand-800'
                    }`}
                  >
                    {urgent ? 'Mendesak' : 'Info'}
                  </span>
                  <div className="flex-1 text-sm font-extrabold">{b.title}</div>
                  {!b.read && <span className="size-2 rounded-full bg-brand-600" aria-label="Belum dibaca" />}
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
  const { customer } = useAuth();
  const depotId = customer?.assignedDepotId ?? null;
  return (
    <DriverShell nav={false}>
      {depotId ? (
        <Announcements depotId={depotId} />
      ) : (
        <div className="px-4 py-6">
          <h1 className="text-lg font-extrabold tracking-tight">Pengumuman</h1>
          <CenterState icon={<Megaphone size={32} />} title="Belum ada depot penempatan">
            Pengumuman muncul setelah kamu ditempatkan di depot.
          </CenterState>
        </div>
      )}
    </DriverShell>
  );
}

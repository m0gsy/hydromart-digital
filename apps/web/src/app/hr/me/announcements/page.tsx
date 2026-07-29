'use client';

import { Badge, Button, Card, ErrorState, SectionHeader, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import {
  ANNOUNCEMENT_LEVEL_LABEL,
  fmtDate,
  type Announcement,
  type AnnouncementLevel,
} from '@/lib/hr';
import { useAsync } from '@/lib/use-async';

const LEVEL_TONE: Record<AnnouncementLevel, 'neutral' | 'warning' | 'danger'> = {
  INFO: 'neutral',
  WARNING: 'warning',
  URGENT: 'danger',
};

/** What HR sent to me. The server decides membership; nothing here filters. */
export default function MyAnnouncementsPage() {
  const feed = useAsync<(Announcement & { read: boolean })[]>(
    () => api.get<(Announcement & { read: boolean })[]>(endpoints.hr.announcementsMe, true),
    [],
  );

  async function markRead(id: string) {
    await api.post(endpoints.hr.readAnnouncement(id), {}, true);
    feed.reload();
  }

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-6">
      <SectionHeader title="Pengumuman" subtitle="Kabar dari HR untuk Anda" />
      {feed.loading && <Skeleton className="h-32" />}
      {feed.error && <ErrorState message={feed.error} onRetry={feed.reload} />}
      {feed.data?.length === 0 && (
        <Card className="p-5 text-sm text-muted">Belum ada pengumuman untuk Anda.</Card>
      )}
      {(feed.data ?? []).map((a) => (
        <Card key={a.id} className="space-y-2 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <b>{a.title}</b>
            <Badge tone={LEVEL_TONE[a.level]}>{ANNOUNCEMENT_LEVEL_LABEL[a.level]}</Badge>
            {!a.read && <Badge tone="success">Baru</Badge>}
          </div>
          <p className="whitespace-pre-line text-sm">{a.body}</p>
          <p className="text-xs text-muted">{fmtDate(a.publishedAt)}</p>
          {!a.read && (
            <Button variant="secondary" onClick={() => markRead(a.id)}>
              Tandai sudah dibaca
            </Button>
          )}
        </Card>
      ))}
    </div>
  );
}

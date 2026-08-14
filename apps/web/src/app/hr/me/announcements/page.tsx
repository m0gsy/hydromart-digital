'use client';

import { Badge, Button, Card, ErrorState, SectionHeader, Skeleton } from '@/components/ui';
import { useT } from '@/lib/locale-context';
import { useState } from 'react';

import { api, ApiError } from '@/lib/api';
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
  const { t } = useT();
  const feed = useAsync<(Announcement & { read: boolean })[]>(
    () => api.get<(Announcement & { read: boolean })[]>(endpoints.hr.announcementsMe, true),
    [],
  );

  const [error, setError] = useState<string | null>(null);

  async function markRead(id: string) {
    setError(null);
    try {
      await api.post(endpoints.hr.readAnnouncement(id), {}, true);
      feed.reload();
    } catch (err) {
      // No catch at all before this: a failed receipt threw into the void, the reload never
      // ran, and the announcement stayed unread with no sign anything had gone wrong.
      setError(err instanceof ApiError ? err.message : t('hrFix.myAnnouncements.markFailed'));
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-6">
      <SectionHeader title={t('hrFix.myAnnouncements.title')} subtitle={t('hrFix.myAnnouncements.subtitle')} />
      {feed.loading && <Skeleton className="h-32" />}
      {feed.error && <ErrorState message={feed.error} onRetry={feed.reload} />}
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      {feed.data?.length === 0 && (
        <Card className="p-5 text-sm text-muted">{t('hrFix.myAnnouncements.empty')}</Card>
      )}
      {(feed.data ?? []).map((a) => (
        <Card key={a.id} className="space-y-2 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <b>{a.title}</b>
            <Badge tone={LEVEL_TONE[a.level]}>{t(ANNOUNCEMENT_LEVEL_LABEL[a.level])}</Badge>
            {!a.read && <Badge tone="success">{t('hrFix.myAnnouncements.new')}</Badge>}
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

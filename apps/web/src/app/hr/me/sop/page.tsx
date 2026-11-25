'use client';

import Link from 'next/link';

import { Badge, Card, ErrorState, SectionHeader, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDate } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import type { SopMine } from '@/lib/sop';
import { useAsync } from '@/lib/use-async';

/**
 * HD-16 — the SOPs that bind me today. The server decides which (my depot, or the one I am lent
 * from); an account with no employee record (404) has none, which is an answer, not a failure.
 */
export default function MySopPage() {
  const { t } = useT();
  const list = useAsync<SopMine[]>(
    () =>
      api.get<SopMine[]>(endpoints.hr.sopsMe, true).catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 404) return [];
        throw e;
      }),
    [],
  );
  const rows = list.data ?? [];
  const unread = rows.filter((r) => !r.acked).length;

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-6">
      <SectionHeader title={t('hrFix.mySop.title')} subtitle={t('hrFix.mySop.subtitle')} />
      {list.loading && <Skeleton className="h-32" />}
      {list.error && <ErrorState message={t('hrFix.mySop.loadError')} onRetry={list.reload} />}
      {!list.loading && !list.error && rows.length === 0 && (
        <Card className="p-5 text-sm text-muted">{t('hrFix.mySop.empty')}</Card>
      )}
      {rows.length > 0 && (
        <p>
          <Badge tone={unread > 0 ? 'warning' : 'success'}>
            {unread > 0 ? t('hrFix.mySop.unreadCount', { n: unread }) : t('hrFix.mySop.allRead')}
          </Badge>
        </p>
      )}
      {rows.map((r) => (
        <Link key={r.versionId} href={`/hr/me/sop/detail?id=${r.versionId}`} className="block">
          <Card className="space-y-1 p-5 transition-colors hover:bg-brand-50">
            <div className="flex flex-wrap items-center gap-2">
              <b>{r.sopTitle}</b>
              <Badge tone={r.acked ? 'success' : 'warning'}>{r.acked ? t('hrFix.mySop.read') : t('hrFix.mySop.unread')}</Badge>
            </div>
            <p className="text-xs text-muted">
              {t('hrFix.mySop.versionLabel', { n: r.versionNo })} · {t('hrFix.mySop.since', { date: formatDate(r.effectiveFrom) })}
              {r.hasFile ? ` · ${t('hrFix.mySop.hasFile')}` : ''}
            </p>
          </Card>
        </Link>
      ))}
    </div>
  );
}

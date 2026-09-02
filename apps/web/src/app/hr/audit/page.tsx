'use client';

import { useState } from 'react';
import { useT } from '@/lib/locale-context';

import { Badge, Card, ErrorState, Input, ListFooter, SectionHeader, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { fmtDate, fmtTime, type AuditLog, type HrPage } from '@/lib/hr';
import { usePagedList } from '@/lib/use-paged-list';

/*
 * CA-1-18. The heading here reads "{total} entri" — the real size of the HR audit trail —
 * over its newest 100 rows. An audit trail whose older half is unreachable from the only
 * screen that renders it is not an audit trail; it is a recent-activity feed with the wrong
 * heading. 100 is the DTO's `@Max`.
 */
const PAGE_SIZE = 100;

const ACTION_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  POST: 'success', PATCH: 'warning', PUT: 'warning', DELETE: 'danger',
};

export default function AuditPage() {
  const { t } = useT();
  const [entity, setEntity] = useState('');

  const list = usePagedList<AuditLog>(
    (page) =>
      api
        .get<HrPage<AuditLog>>(
          endpoints.hr.audit({ entity: entity || undefined, page, pageSize: PAGE_SIZE }),
          true,
        )
        .then((p) => ({ items: p.rows, total: p.total })),
    [entity],
  );
  const { error, loading, reload } = list;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <SectionHeader title={t('hrFix.audit.title')} subtitle={list.rows.length > 0 ? `${list.total} entri` : undefined} />
      <Input placeholder={t('hrFix.audit.filterHint')} value={entity} onChange={(e) => setEntity(e.target.value)} className="max-w-xs" />

      {loading && list.rows.length === 0 && <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>}
      {error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && list.rows.length === 0 && <Card className="p-8 text-center text-sm text-muted">{t('hrFix.audit.empty')}</Card>}
      {list.rows.length > 0 && (
        <Card className="divide-y divide-[color:var(--border)]">
          {list.rows.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-3 p-3 text-sm">
              <Badge tone={ACTION_TONE[l.action] ?? 'neutral'}>{l.action}</Badge>
              <span className="min-w-0 flex-1 truncate"><b>{l.entity}</b>{l.entityId ? ` · ${l.entityId.slice(0, 8)}…` : ''}</span>
              <span className="whitespace-nowrap text-xs text-muted">{fmtDate(l.at)} {fmtTime(l.at)}</span>
            </div>
          ))}
        </Card>
      )}
      <ListFooter
        shown={list.rows.length}
        total={list.total}
        hasMore={list.hasMore}
        onMore={list.loadMore}
        loading={loading}
      />
    </div>
  );
}

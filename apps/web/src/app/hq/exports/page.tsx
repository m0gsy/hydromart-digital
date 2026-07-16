'use client';

import { useState } from 'react';
import { FileArrowDown } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Badge, Card, ErrorState, Skeleton } from '@/components/ui';
import { agoLabel } from '@/lib/hq/stubs';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { ExportLogEntry, ExportStatus, Page } from '@/lib/types';

// Design 13c — data-export audit log. Real admin-service track: HEAD_OFFICE + SUPER_ADMIN
// read, paginated newest-first, filterable by status. Entries are written by export jobs
// via the internal-key ingest endpoint.
type Filter = 'all' | ExportStatus;

const STATUS_TONE: Record<ExportStatus, 'success' | 'warning' | 'danger'> = {
  DONE: 'success',
  PENDING: 'warning',
  FAILED: 'danger',
};
const STATUS_KEY: Record<ExportStatus, string> = {
  DONE: 'done',
  PENDING: 'processing',
  FAILED: 'failed',
};

function minutesAgo(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
}

export default function HqExportsPage() {
  const { t } = useT();
  const [filter, setFilter] = useState<Filter>('all');
  const query = useAsync<Page<ExportLogEntry>>(
    () => api.get(endpoints.admin.exportLogs({ limit: 100, status: filter === 'all' ? undefined : filter }), true),
    [filter],
  );

  const chips: Filter[] = ['all', 'DONE', 'PENDING', 'FAILED'];
  const label = (f: Filter) => (f === 'all' ? t('hq.exportsLog.all') : t(`hq.exportsLog.${STATUS_KEY[f]}`));
  const rows = query.data?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader icon={FileArrowDown} title={t('hq.exportsLog.title')} subtitle={t('hq.exportsLog.subtitle')} />

      <div className="flex flex-wrap gap-2">
        {chips.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-bold transition-colors ${
              filter === f ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-app text-muted hover:bg-[color:var(--surface-soft)]'
            }`}
          >
            {label(f)}
          </button>
        ))}
      </div>

      {query.loading ? (
        <Skeleton className="h-80 w-full" />
      ) : query.error ? (
        <ErrorState message={t('hq.exportsLog.loadError')} onRetry={query.reload} />
      ) : rows.length === 0 ? (
        <Card className="p-8">
          <p className="text-center text-sm text-muted">{t('hq.exportsLog.empty')}</p>
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-app text-left text-xs font-medium uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5">{t('hq.exportsLog.dataset')}</th>
                <th className="px-4 py-2.5">{t('hq.exportsLog.by')}</th>
                <th className="px-4 py-2.5">{t('hq.exportsLog.format')}</th>
                <th className="px-4 py-2.5 text-right">{t('hq.exportsLog.rows')}</th>
                <th className="px-4 py-2.5">{t('hq.exportsLog.status')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-app last:border-0">
                  <td className="px-4 py-2.5">
                    <span className="font-semibold">{r.dataset}</span>
                    <span className="ml-2 text-xs text-muted">{agoLabel(minutesAgo(r.createdAt), t)}</span>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{r.requestedByEmail}</td>
                  <td className="px-4 py-2.5">{r.format}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {r.rowCount === null ? '—' : r.rowCount.toLocaleString('id-ID')}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={STATUS_TONE[r.status]}>{t(`hq.exportsLog.${STATUS_KEY[r.status]}`)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { FileArrowDown } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Badge, Button, Card, ErrorState, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { agoLabel } from '@/lib/hq/stubs';
import { api, ApiError, getBlob } from '@/lib/api';
import { downloadBlob } from '@/lib/csv';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { ExportLogEntry, ExportStatus, Page } from '@/lib/types';

// Design 13c — data-export audit log. HEAD_OFFICE + SUPER_ADMIN read, paginated
// newest-first, filterable by status.
//
// This screen used to be permanently empty, and the reason was one layer down: nothing
// wrote an export log because nothing produced an export. The scheduled-report sweep now
// does both — it stores the file on the row, so a DONE entry is a download rather than a
// claim that something happened somewhere.
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
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const query = useAsync<Page<ExportLogEntry>>(
    () => api.get(endpoints.admin.exportLogs({ limit: 100, status: filter === 'all' ? undefined : filter }), true),
    [filter],
  );

  async function download(id: string, fileName: string) {
    setBusyId(id);
    try {
      downloadBlob(fileName, await getBlob(endpoints.admin.exportLogDownload(id)));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.exportsLog.downloadError'), 'error');
    } finally {
      setBusyId(null);
    }
  }

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
            className={`min-h-11 rounded-full border px-3.5 py-1.5 text-xs font-bold transition-colors ${
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
                <th className="px-4 py-2.5 text-right">{t('hq.exportsLog.file')}</th>
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
                  <td className="px-4 py-2.5 text-right">
                    {r.hasFile && r.fileName ? (
                      <Button
                        variant="secondary"
                        loading={busyId === r.id}
                        onClick={() => download(r.id, r.fileName as string)}
                      >
                        {t('hq.exportsLog.download')}
                      </Button>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
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

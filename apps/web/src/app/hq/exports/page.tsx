'use client';

import { useState } from 'react';
import { FileArrowDown } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Badge, Card } from '@/components/ui';
import { EXPORT_LOG_STUB, agoLabel, type ExportLogRow } from '@/lib/hq/stubs';
import { useT } from '@/lib/locale-context';

// Design 13c — data-export audit log. No export-log service, so the whole log is stubbed.
type Filter = 'all' | ExportLogRow['status'];

const STATUS_TONE: Record<ExportLogRow['status'], 'success' | 'warning' | 'danger'> = {
  selesai: 'success',
  proses: 'warning',
  gagal: 'danger',
};
const STATUS_KEY: Record<ExportLogRow['status'], string> = {
  selesai: 'done',
  proses: 'processing',
  gagal: 'failed',
};

export default function HqExportsPage() {
  const { t } = useT();
  const [filter, setFilter] = useState<Filter>('all');
  const rows = filter === 'all' ? EXPORT_LOG_STUB : EXPORT_LOG_STUB.filter((r) => r.status === filter);

  const chips: Filter[] = ['all', 'selesai', 'proses', 'gagal'];
  const label = (f: Filter) => (f === 'all' ? t('hq.exportsLog.all') : t(`hq.exportsLog.${STATUS_KEY[f]}`));

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader icon={FileArrowDown} title={t('hq.exportsLog.title')} subtitle={t('hq.exportsLog.subtitle')} stub />

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

      {rows.length === 0 ? (
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
                    <span className="ml-2 text-xs text-muted">{agoLabel(r.agoMin, t)}</span>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{r.by}</td>
                  <td className="px-4 py-2.5">{r.format}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.rows.toLocaleString('id-ID')}</td>
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

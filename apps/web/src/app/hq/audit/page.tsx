'use client';

import { useState } from 'react';
import { ClockCounterClockwise } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Button, Card, ErrorState, ListFooter, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/api';
import { downloadXlsx } from '@/lib/xlsx';
import type { CsvCell } from '@/lib/csv';
import { endpoints } from '@/lib/endpoints';
import { agoLabel } from '@/lib/hq/stubs';
import { actionLabel } from '@/lib/audit-action';
import { useT } from '@/lib/locale-context';
import { fetchAllPages, TooManyPagesError } from '@/lib/fetch-all-pages';
import { usePagedList } from '@/lib/use-paged-list';
import type { AuditEntry, Page } from '@/lib/types';

// Design 8a — immutable audit trail. Real auth-service track: recent privileged actions
// across services, newest first. Actor identity is resolved server-side.
/*
 * CA-2-28, and it is two defects wearing one number.
 *
 * The screen asked for `{ limit: 100 }` and rendered the answer as the trail. That alone is
 * a display list that stops — bad, but visible to anyone who scrolls to the bottom and
 * wonders. The export was the serious half: it built the workbook from `rows`, the same 100,
 * and handed it over with no marking of any kind. Somebody investigating an incident three
 * weeks old opens that file, searches it, finds nothing, and concludes nothing happened —
 * from a file that never contained the day they were looking for.
 *
 * So the two halves are answered differently, and deliberately. The TABLE pages on demand,
 * because a person reading an audit trail reads the top of it. The EXPORT walks every page
 * through `fetchAllPages`, because a file is read away from the screen that could have
 * warned it was partial — and if the trail is too large to read in full, `fetchAllPages`
 * refuses and the export fails loudly rather than writing a plausible fraction.
 */
const PAGE_SIZE = 100;

function minutesAgo(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
}

export default function HqAuditPage() {
  const { t } = useT();
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);
  const [action, setAction] = useState('');
  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');
  const [outcome, setOutcome] = useState<'' | 'ok' | 'failed'>('');
  // Local calendar days, sent as instants: `to` is the START of the day after the one picked,
  // so choosing 8 Oct includes everything that happened on the 8th.
  const filter = {
    action: action.trim() || undefined,
    from: fromDay ? new Date(`${fromDay}T00:00:00`).toISOString() : undefined,
    to: toDay ? new Date(new Date(`${toDay}T00:00:00`).getTime() + 86_400_000).toISOString() : undefined,
    success: outcome === '' ? undefined : outcome === 'ok',
  };
  const filtered = Object.values(filter).some((v) => v !== undefined);
  const log = usePagedList<AuditEntry>(
    (page) => api.get<Page<AuditEntry>>(endpoints.audit.list({ page, limit: PAGE_SIZE, ...filter }), true),
    [filter.action, filter.from, filter.to, filter.success],
  );

  const rows = log.rows;

  async function runExport() {
    // An export of nothing is a file the reader has to open to discover is empty.
    if (log.total === 0) return toast(t('hq.audit.empty'), 'error');
    setExporting(true);
    let all: AuditEntry[];
    try {
      // Every page, not the ones on screen. The file leaves this building.
      all = await fetchAllPages<AuditEntry>(({ page, limit }) =>
        api.get<Page<AuditEntry>>(endpoints.audit.list({ page, limit, ...filter }), true),
      );
    } catch (e) {
      setExporting(false);
      // A trail past the paginator's ceiling has no honest whole-file answer here, and a
      // truncated audit export is the exact thing this row is about. Refuse and say so.
      return toast(
        e instanceof TooManyPagesError ? t('hqFix.audit.tooLarge') : t('hq.audit.exportError'),
        'error',
      );
    }
    setExporting(false);
    const headers = [
      t('hq.audit.actor'),
      t('hq.audit.role'),
      t('hq.audit.target'),
      t('hq.audit.action'),
      t('hq.audit.time'),
    ];
    // The raw timestamp, not the "3 jam lalu" the table shows: a relative label is read
    // against the moment the file is opened, which is never the moment it was written.
    const body: CsvCell[][] = all.map((r) => [
      r.actorName || r.actorEmail || t('hq.audit.system'),
      r.actorRole ?? '',
      r.target ?? '',
      r.action,
      r.createdAt,
    ]);
    try {
      await downloadXlsx(`audit-${new Date().toISOString().slice(0, 10)}.xlsx`, headers, body, 'Audit');
    } catch {
      toast(t('hq.audit.exportError'), 'error');
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={ClockCounterClockwise}
        title={t('hq.audit.title')}
        subtitle={t('hq.audit.subtitle')}
        action={
          <Button variant="secondary" onClick={runExport} loading={exporting}>
            {t('hq.common.export')}
          </Button>
        }
      />

      {/* Filters narrow the list AND the export: a file that ignored them would hand over a
          different trail from the one on screen. */}
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-xs font-medium text-muted">
          {t('hq.audit.filterAction')}
          <input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="rounded-xl border border-app bg-transparent px-3 py-2 text-sm text-[color:var(--text)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          {t('hq.audit.filterFrom')}
          <input
            type="date"
            value={fromDay}
            max={toDay || undefined}
            onChange={(e) => setFromDay(e.target.value)}
            className="rounded-xl border border-app bg-transparent px-3 py-2 text-sm text-[color:var(--text)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          {t('hq.audit.filterTo')}
          <input
            type="date"
            value={toDay}
            min={fromDay || undefined}
            onChange={(e) => setToDay(e.target.value)}
            className="rounded-xl border border-app bg-transparent px-3 py-2 text-sm text-[color:var(--text)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          {t('hq.audit.filterOutcome')}
          <select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as '' | 'ok' | 'failed')}
            className="rounded-xl border border-app bg-transparent px-3 py-2 text-sm text-[color:var(--text)]"
          >
            <option value="">{t('hq.audit.outcomeAll')}</option>
            <option value="ok">{t('hq.audit.outcomeOk')}</option>
            <option value="failed">{t('hq.audit.outcomeFailed')}</option>
          </select>
        </label>
        {filtered && (
          <Button
            variant="ghost"
            onClick={() => {
              setAction('');
              setFromDay('');
              setToDay('');
              setOutcome('');
            }}
          >
            {t('hq.audit.filterReset')}
          </Button>
        )}
      </Card>

      {log.loading && rows.length === 0 ? (
        <Skeleton className="h-96 w-full" />
      ) : log.error ? (
        <ErrorState message={t('hq.audit.loadError')} onRetry={log.reload} />
      ) : rows.length === 0 ? (
        <Card className="p-8">
          <p className="text-center text-sm text-muted">
            {filtered ? t('hq.audit.noMatch') : t('hq.audit.empty')}
          </p>
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-app text-left text-xs font-medium uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5">{t('hq.audit.actor')}</th>
                <th className="px-4 py-2.5">{t('hq.audit.role')}</th>
                <th className="px-4 py-2.5">{t('hq.audit.target')}</th>
                <th className="px-4 py-2.5">{t('hq.audit.action')}</th>
                <th className="px-4 py-2.5 text-right">{t('hq.audit.time')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-app last:border-0">
                  <td className="px-4 py-2.5 font-semibold">
                    {r.actorName || r.actorEmail || t('hq.audit.system')}
                  </td>
                  <td className="px-4 py-2.5 text-muted">{r.actorRole ?? '—'}</td>
                  <td className="px-4 py-2.5">{r.target ?? '—'}</td>
                  <td className="px-4 py-2.5" title={r.action}>
                    {actionLabel(r.action, t)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted">
                    {agoLabel(minutesAgo(r.createdAt), t)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <ListFooter
        shown={rows.length}
        total={log.total}
        hasMore={log.hasMore}
        onMore={log.loadMore}
        loading={log.loading}
      />

      <p className="text-xs text-muted">{t('hq.audit.note')}</p>
    </div>
  );
}

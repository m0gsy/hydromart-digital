'use client';

import { DownloadSimple, UploadSimple } from '@phosphor-icons/react';
import { IMPORT_COLUMNS } from '@hydromart/access';
import { useState } from 'react';

import { MAX_IMPORT_ROWS } from '@/components/csv-import';
import { Badge, Button, Card, Chip, FormError } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { downloadBlob, parseCsvRecords, type CsvRecord } from '@/lib/csv';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import {
  missingColumns,
  REFUSAL_REASONS,
  REQUIRED_COLUMNS,
  rowsHash,
  templateColumns,
  toImportRows,
  type ImportRow,
  type ImportRowResult,
  type ImportSummary,
} from '@/lib/prospect-import';
import type { ProspectCoverage } from '@/lib/types';
import { buildTemplateXlsx, classifyImportFile, parseXlsxRecords, toXlsxBlob } from '@/lib/xlsx';

const PAGE = 50;
type Filter = 'all' | 'created' | 'skipped' | 'failed';
const FILTERS: Filter[] = ['all', 'created', 'skipped', 'failed'];

const coverageNow = () =>
  api.get<ProspectCoverage>(endpoints.prospects.coverage(), true).catch(() => null);

/** Pick, check (dry run), commit. A commit is only offered for the exact file that was checked. */
export function ProspectImport({ onForbidden }: { onForbidden: () => void }) {
  const { t } = useT();
  const [name, setName] = useState('');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dry, setDry] = useState<{ hash: string; summary: ImportSummary } | null>(null);
  const [done, setDone] = useState<{ summary: ImportSummary; delta: number | null; cost: number | null } | null>(null);
  const [before, setBefore] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [shown, setShown] = useState(PAGE);

  const hash = rowsHash(rows);
  const summary = done?.summary ?? dry?.summary ?? null;
  const canCommit = dry !== null && dry.hash === hash && !done && !busy;

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file after a fix
    if (!file) return;
    setRows([]);
    setDry(null);
    setDone(null);
    setError(null);
    setFileError(null);
    setFilter('all');
    setShown(PAGE);

    const kind = classifyImportFile(file.name);
    if (kind === 'legacy') return setFileError(t('opsFix.import.legacyFormat'));
    if (kind === 'unsupported') return setFileError(t('opsFix.import.wrongFileType', { name: file.name }));
    let records: CsvRecord[];
    try {
      records = kind === 'spreadsheet' ? await parseXlsxRecords(file) : parseCsvRecords(await file.text());
    } catch {
      return setFileError(t('opsFix.import.unreadableFile'));
    }
    const first = records[0];
    if (!first) return setFileError(t('opsFix.import.emptyFile'));
    if (records.length > MAX_IMPORT_ROWS) {
      return setFileError(t('opsFix.import.tooManyRows', { max: MAX_IMPORT_ROWS, count: records.length }));
    }
    const missing = missingColumns(first);
    if (missing.length > 0) return setFileError(t('opsFix.import.missingColumns', { columns: missing.join(', ') }));
    setName(file.name);
    setRows(toImportRows(records));
  }

  function fail(err: unknown) {
    if (err instanceof ApiError && err.status === 403) return onForbidden();
    if (err instanceof ApiError && err.status === 503) return setError(t('opsFix.prospectsIo.import.unavailable'));
    setError(err instanceof ApiError ? err.message : t('opsFix.prospectsIo.import.failed'));
  }

  async function check() {
    setBusy(true);
    setError(null);
    try {
      setBefore((await coverageNow())?.onMap ?? null);
      const result = await api.post<ImportSummary>(endpoints.prospects.import, { dryRun: true, rows }, true);
      setDry({ hash, summary: result });
      setFilter('all');
      setShown(PAGE);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<ImportSummary>(endpoints.prospects.import, { dryRun: false, rows }, true);
      const after = await coverageNow();
      setDone({
        summary: result,
        delta: before !== null && after ? after.onMap - before : null,
        cost: after?.thirdPartyCostIdr ?? null,
      });
      setFilter('all');
      setShown(PAGE);
    } catch (err) {
      fail(err); // a 503 leaves the button on: a retry is safe, duplicates are refused, not created twice
    } finally {
      setBusy(false);
    }
  }

  const verdict = (r: ImportRowResult) =>
    r.status === 'skipped' && r.reason
      ? t(`opsFix.prospectsIo.import.reasons.${r.reason}`)
      : t(
          r.status === 'failed'
            ? 'opsFix.prospectsIo.import.unreadable'
            : r.status === 'skipped'
              ? 'opsFix.prospectsIo.import.refused'
              : done
                ? 'opsFix.prospectsIo.import.created'
                : 'opsFix.prospectsIo.import.willCreate',
        );

  async function downloadRefused() {
    const bad = (summary?.results ?? []).filter((r) => r.status === 'skipped' || r.status === 'failed');
    const headers = [...IMPORT_COLUMNS, t('opsFix.prospectsIo.import.verdictCol'), t('opsFix.prospectsIo.import.messageCol')];
    const body = bad.map((r) => [...IMPORT_COLUMNS.map((k) => rows[r.row - 1]?.[k] ?? ''), verdict(r), r.message ?? '']);
    downloadBlob(`${t('opsFix.prospectsIo.import.refusedFile')}.xlsx`, await toXlsxBlob(headers, body, 'prospek'));
  }

  const list = (summary?.results ?? []).filter((r) => filter === 'all' || r.status === filter);
  const stage = done ? 'created' : 'willCreate';

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3 p-5">
        <p className="text-sm text-muted">{t('opsFix.prospectsIo.import.hint', { max: MAX_IMPORT_ROWS })}</p>
        <p className="text-xs text-muted">{t('opsFix.prospectsIo.import.required', { columns: REQUIRED_COLUMNS.join(', ') })}</p>
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            variant="secondary"
            onClick={async () => downloadBlob('prospek-template.xlsx', await buildTemplateXlsx(templateColumns, 'prospek'))}
          >
            <DownloadSimple size={16} weight="bold" />
            {t('opsFix.prospectsIo.import.template')}
          </Button>
          {/* sr-only, not hidden: display:none takes the picker out of the tab order. */}
          <label className="inline-flex rounded-lg focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-600">
            <input type="file" accept=".xlsx,.xlsm,.csv,text/csv" onChange={onPick} className="sr-only" />
            <span className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-bold text-white">
              <UploadSimple size={16} weight="bold" />
              {t('opsFix.prospectsIo.import.pick')}
            </span>
          </label>
        </div>
        <FormError message={fileError} />
        {rows.length > 0 && (
          <p className="text-sm font-medium">{t('opsFix.prospectsIo.import.fileName', { name, count: rows.length })}</p>
        )}
      </Card>

      {rows.length > 0 && (
        <Card className="flex flex-col gap-2 p-5">
          {!done && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={check} disabled={busy}>
                {t('opsFix.prospectsIo.import.check')}
              </Button>
              <Button onClick={commit} disabled={!canCommit}>
                {t('opsFix.prospectsIo.import.commit')}
              </Button>
            </div>
          )}
          {!done && !canCommit && !busy && <p className="text-xs text-muted">{t('opsFix.prospectsIo.import.commitNeedsCheck')}</p>}
          <FormError message={error} />
        </Card>
      )}

      {summary && (
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="text-base font-bold">
            {done ? t('opsFix.prospectsIo.import.resultTitle') : t('opsFix.prospectsIo.import.checkTitle')}
          </h2>
          <div className="flex flex-wrap gap-2">
            <Badge tone="success">{`${t(`opsFix.prospectsIo.import.${stage}`)}: ${summary.created}`}</Badge>
            <Badge tone="warning">{`${t('opsFix.prospectsIo.import.refused')}: ${summary.skipped}`}</Badge>
            <Badge tone="danger">{`${t('opsFix.prospectsIo.import.unreadable')}: ${summary.failed}`}</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {REFUSAL_REASONS.map((r) => (
              <Chip key={r} tone="outline">{`${t(`opsFix.prospectsIo.import.reasons.${r}`)}: ${summary.reasons[r] ?? 0}`}</Chip>
            ))}
          </div>
          {done && (
            <div className="text-sm">
              <p>
                {done.delta === null
                  ? t('opsFix.prospectsIo.import.onMapUnknown')
                  : t('opsFix.prospectsIo.import.onMap', { count: done.delta })}
              </p>
              <p>{t('opsFix.prospectsIo.import.cost', { amount: (done.cost ?? 0).toLocaleString('id-ID') })}</p>
            </div>
          )}

          <div role="group" className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <Button
                key={f}
                variant={filter === f ? 'primary' : 'secondary'}
                aria-pressed={filter === f}
                onClick={() => {
                  setFilter(f);
                  setShown(PAGE);
                }}
              >
                {t(`opsFix.prospectsIo.import.filter.${f}`)}
              </Button>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-[13px]">
              <thead>
                <tr className="text-left text-muted">
                  <th className="py-1.5 pr-3 font-semibold">{t('opsFix.prospectsIo.import.cols.row')}</th>
                  <th className="py-1.5 pr-3 font-semibold">{t('opsFix.prospectsIo.import.cols.name')}</th>
                  <th className="py-1.5 pr-3 font-semibold">{t('opsFix.prospectsIo.import.cols.verdict')}</th>
                  <th className="py-1.5 font-semibold">{t('opsFix.prospectsIo.import.cols.message')}</th>
                </tr>
              </thead>
              <tbody>
                {list.slice(0, shown).map((r) => (
                  <tr key={r.row} className="border-t border-app align-top">
                    <td className="py-1.5 pr-3 text-muted">{r.row}</td>
                    <td className="py-1.5 pr-3">{rows[r.row - 1]?.name}</td>
                    <td className="py-1.5 pr-3">{verdict(r)}</td>
                    <td className="py-1.5">{r.message ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">
            {t('opsFix.prospectsIo.import.rowsOf', { shown: Math.min(shown, list.length), total: list.length })}
          </p>
          {list.length > shown && (
            <Button variant="secondary" onClick={() => setShown((n) => n + PAGE)}>
              {t('common.loadMore')}
            </Button>
          )}
          {(summary.skipped > 0 || summary.failed > 0) && (
            <Button variant="secondary" onClick={downloadRefused}>
              <DownloadSimple size={16} weight="bold" />
              {t('opsFix.prospectsIo.import.downloadRefused')}
            </Button>
          )}
        </Card>
      )}
    </div>
  );
}

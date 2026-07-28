'use client';

import { useState } from 'react';
import { CheckCircle, DownloadSimple, UploadSimple, Warning } from '@phosphor-icons/react';

import { Badge, Button, Card } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { downloadCsv, parseCsvRecords, toCsv, type CsvRecord } from '@/lib/csv';

/** Server-side row cap — mirrors @ArrayMaxSize(500) on every import DTO. */
export const MAX_IMPORT_ROWS = 500;

export interface ImportColumn {
  /** CSV header AND the JSON key posted to the API. */
  key: string;
  required?: boolean;
  /** Sample value written into the downloadable template. */
  example: string;
  hint?: string;
  /**
   * Convert a raw cell into the value sent to the API. Throw an Error to reject
   * the row with that message. Omitted = send the trimmed string as-is.
   */
  parse?: (raw: string) => unknown;
}

type RowStatus = 'created' | 'skipped' | 'failed';

export interface ImportResultRow {
  row: number;
  status: RowStatus;
  message?: string;
}

export interface ImportResponse {
  created: number;
  skipped: number;
  failed: number;
  results: ImportResultRow[];
}

export interface PreparedRow {
  /** 1-based data row number, matching what the server echoes back. */
  row: number;
  raw: CsvRecord;
  payload?: Record<string, unknown>;
  error?: string;
}

/**
 * Whole-number cell (money, quantity). Accepts Indonesian thousand separators
 * ("150.000" / "150,000") and rejects anything else — Number('150.000') is 150,
 * so a silent coercion here would quietly underpay someone by 1000x.
 */
export function intCell(raw: string): number {
  const s = raw.replace(/\s/g, '');
  if (!/^-?\d{1,3}([.,]\d{3})*$/.test(s) && !/^-?\d+$/.test(s)) {
    throw new Error(`"${raw}" bukan angka bulat`);
  }
  return Number(s.replace(/[.,]/g, ''));
}

/** Decimal cell (percentage). Dot is the decimal point; no thousand separators. */
export function numberCell(raw: string): number {
  const n = Number(raw.replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || raw.trim() === '') throw new Error(`"${raw}" bukan angka`);
  return n;
}

/** Enum cell factory: upper-cases and checks membership. */
export function enumCell(allowed: readonly string[]) {
  return (raw: string): string => {
    const value = raw.toUpperCase();
    if (!allowed.includes(value)) throw new Error(`harus salah satu dari ${allowed.join('/')}`);
    return value;
  };
}

/** Validate + shape each record into the JSON payload; a rejected row carries its reason. */
export function prepareRows(records: CsvRecord[], columns: ImportColumn[]): PreparedRow[] {
  return records.map((raw, i) => {
    const row = i + 1;
    const payload: Record<string, unknown> = {};
    for (const col of columns) {
      const cell = raw[col.key] ?? '';
      if (cell === '') {
        if (col.required) return { row, raw, error: `kolom "${col.key}" wajib diisi` };
        continue;
      }
      try {
        payload[col.key] = col.parse ? col.parse(cell) : cell;
      } catch (err) {
        return { row, raw, error: `${col.key}: ${err instanceof Error ? err.message : 'tidak valid'}` };
      }
    }
    return { row, raw, payload };
  });
}

/**
 * Bulk-import wizard: download template → pick CSV → preview → POST JSON rows →
 * per-row summary → re-download the rows that failed. Parsing happens here so no
 * service needs a CSV parser or a multipart route.
 */
export function CsvImport({
  title,
  description,
  columns,
  endpoint,
  templateName,
  body,
  onDone,
}: {
  title: string;
  description?: string;
  columns: ImportColumn[];
  endpoint: string;
  templateName: string;
  /** Extra top-level body fields sent alongside `rows` (e.g. the selected depot). */
  body?: Record<string, unknown>;
  onDone?: () => void;
}) {
  const [rows, setRows] = useState<PreparedRow[] | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ImportResponse | null>(null);

  const headers = columns.map((c) => c.key);
  const valid = rows?.filter((r) => r.payload) ?? [];
  const invalid = rows?.filter((r) => r.error) ?? [];

  function downloadTemplate() {
    downloadCsv(templateName, toCsv(headers, [columns.map((c) => c.example)]));
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file after a fix
    if (!file) return;
    setResult(null);
    setFileError(null);
    setRows(null);

    const records = parseCsvRecords(await file.text());
    const first = records[0];
    if (!first) {
      setFileError('File kosong atau tidak punya baris data.');
      return;
    }
    if (records.length > MAX_IMPORT_ROWS) {
      setFileError(`Maksimal ${MAX_IMPORT_ROWS} baris per file (file ini ${records.length}).`);
      return;
    }
    const missing = columns.filter((c) => c.required && !(c.key in first));
    if (missing.length > 0) {
      setFileError(`Kolom wajib hilang: ${missing.map((c) => c.key).join(', ')}.`);
      return;
    }
    setRows(prepareRows(records, columns));
  }

  async function submit() {
    if (valid.length === 0) return;
    setSubmitting(true);
    try {
      const payload = { ...body, rows: valid.map((r) => r.payload) };
      setResult(await api.post<ImportResponse>(endpoint, payload, true));
      onDone?.();
    } catch (err) {
      setFileError(err instanceof ApiError ? err.message : 'Import gagal, coba lagi.');
    } finally {
      setSubmitting(false);
    }
  }

  /** Rebuild a CSV of every row the user still has to fix (client- or server-rejected). */
  function downloadFailed() {
    // The server numbers rows within the submitted (valid) subset, not the file.
    const failed = [
      ...invalid.map((r) => ({ raw: r.raw, reason: r.error ?? '' })),
      ...(result?.results ?? [])
        .filter((r) => r.status === 'failed')
        .map((r) => ({ raw: valid[r.row - 1]?.raw ?? {}, reason: r.message ?? '' })),
    ];
    downloadCsv(
      `gagal-${templateName}`,
      toCsv(
        [...headers, 'alasan_gagal'],
        failed.map(({ raw, reason }) => [...headers.map((h) => raw[h] ?? ''), reason]),
      ),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[22px] font-extrabold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-[13.5px] text-muted">{description}</p>}
      </div>

      <Card className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <Button variant="secondary" onClick={downloadTemplate}>
            <DownloadSimple size={16} weight="bold" /> Unduh template CSV
          </Button>
          <label className="inline-flex">
            <input type="file" accept=".csv,text/csv" onChange={onPick} className="hidden" />
            <span className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-bold text-white">
              <UploadSimple size={16} weight="bold" /> Pilih file CSV
            </span>
          </label>
        </div>
        <p className="text-[12.5px] text-muted">
          Maksimal {MAX_IMPORT_ROWS} baris. Kolom wajib:{' '}
          {columns
            .filter((c) => c.required)
            .map((c) => c.key)
            .join(', ')}
          .
        </p>
        {fileError && (
          <p className="text-[13px] font-medium text-[color:var(--danger)]" role="alert">
            {fileError}
          </p>
        )}
      </Card>

      {rows && !result && (
        <Card className="flex flex-col gap-3 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="success">{valid.length} baris siap</Badge>
            {invalid.length > 0 && <Badge tone="danger">{invalid.length} baris bermasalah</Badge>}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[13px]">
              <thead>
                <tr className="text-left text-muted">
                  <th className="py-1.5 pr-3 font-semibold">#</th>
                  {headers.map((h) => (
                    <th key={h} className="py-1.5 pr-3 font-semibold">
                      {h}
                    </th>
                  ))}
                  <th className="py-1.5 font-semibold">status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.row} className="border-t border-app">
                    <td className="py-1.5 pr-3 text-muted">{r.row}</td>
                    {headers.map((h) => (
                      <td key={h} className="py-1.5 pr-3">
                        {r.raw[h] ?? ''}
                      </td>
                    ))}
                    <td className="py-1.5">
                      {r.error ? (
                        <span className="inline-flex items-center gap-1 text-[color:var(--danger)]">
                          <Warning size={14} weight="fill" /> {r.error}
                        </span>
                      ) : (
                        <CheckCircle
                          size={15}
                          weight="fill"
                          className="text-[color:var(--success)]"
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap gap-2.5">
            <Button onClick={submit} loading={submitting} disabled={valid.length === 0}>
              Import {valid.length} baris
            </Button>
            {invalid.length > 0 && (
              <Button variant="secondary" onClick={downloadFailed}>
                <DownloadSimple size={16} weight="bold" /> Unduh baris bermasalah
              </Button>
            )}
          </div>
        </Card>
      )}

      {result && (
        <Card className="flex flex-col gap-3 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="success">{result.created} dibuat</Badge>
            <Badge tone="neutral">{result.skipped} dilewati</Badge>
            {result.failed > 0 && <Badge tone="danger">{result.failed} gagal</Badge>}
          </div>
          <ul className="flex flex-col gap-1 text-[13px]">
            {result.results
              .filter((r) => r.status !== 'created')
              .map((r) => (
                <li key={r.row} className="text-muted">
                  Baris {r.row} — <span className="font-semibold">{r.status}</span>
                  {r.message ? `: ${r.message}` : ''}
                </li>
              ))}
          </ul>
          {(result.failed > 0 || invalid.length > 0) && (
            <Button variant="secondary" onClick={downloadFailed} className="self-start">
              <DownloadSimple size={16} weight="bold" /> Unduh baris gagal
            </Button>
          )}
        </Card>
      )}
    </div>
  );
}

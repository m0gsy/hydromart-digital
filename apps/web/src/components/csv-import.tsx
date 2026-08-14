'use client';

import { useState } from 'react';
import { useT, type TVars } from '@/lib/locale-context';

/** The `t` a pure parser is handed. Mirrors `lib/hr.ts`'s Translate, for the same reason. */
type Translate = (key: string, vars?: TVars) => string;
import { CheckCircle, DownloadSimple, UploadSimple, Warning } from '@phosphor-icons/react';

import { Badge, Button, Card } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { downloadBlob, downloadCsv, parseCsvRecords, toCsv, type CsvRecord } from '@/lib/csv';
import { buildTemplateXlsx, classifyImportFile, parseXlsxRecords, toXlsxBlob } from '@/lib/xlsx';

/** Server-side row cap — mirrors @ArrayMaxSize(500) on every import DTO. */
export const MAX_IMPORT_ROWS = 500;

/**
 * The translator, or the identity when a parser is called outside a component (a test, a
 * script). Returning the KEY is deliberate: a raw key in an error column is a visible
 * "nobody translated this", which is easier to notice than an English sentence.
 */
const passthrough: Translate = (key) => key;

export interface ImportColumn {
  /** Column header in the file — what the person filling it in reads. */
  key: string;
  /** JSON key posted to the API. Defaults to `key`; set it when the human-facing
   *  header differs from the field (e.g. `depotCode` in, `depotId` out). */
  field?: string;
  required?: boolean;
  /** Sample value written into the downloadable template. */
  example: string;
  /** Allowed values — becomes a dropdown in the template and the default parser. */
  options?: readonly string[];
  /** Format the template column as Text so Excel keeps it verbatim (phones, codes). */
  text?: boolean;
  /**
   * Convert a raw cell into the value sent to the API. Throw an Error to reject
   * the row with that message. Defaults to the `options` check, else the trimmed string.
   */
  /**
   * `t` is passed so a rejection reason is copy, not a hardcoded Indonesian sentence. A
   * parser that needs no words simply ignores it — TypeScript allows the shorter signature.
   */
  parse?: (raw: string, t: Translate) => unknown;
}

type RowStatus = 'created' | 'updated' | 'skipped' | 'failed';

export interface ImportResultRow {
  row: number;
  status: RowStatus;
  message?: string;
  /** Id of the record the row created or matched (customer import uses it). */
  id?: string;
}

export interface ImportResponse {
  created: number;
  /** Rows that overwrote an existing record (upsert imports only). */
  updated: number;
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
export function intCell(raw: string, t: Translate = passthrough): number {
  const s = raw.replace(/\s/g, '');
  if (!/^-?\d{1,3}([.,]\d{3})*$/.test(s) && !/^-?\d+$/.test(s)) {
    throw new Error(t('opsFix.import.notAnInteger', { value: raw }));
  }
  return Number(s.replace(/[.,]/g, ''));
}

/** Decimal cell (percentage). Dot is the decimal point; no thousand separators. */
export function numberCell(raw: string, t: Translate = passthrough): number {
  const n = Number(raw.replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || raw.trim() === '')
    throw new Error(t('opsFix.import.notANumber', { value: raw }));
  return n;
}

/**
 * Date cell → the ISO string every DTO validates with @IsISO8601. Excel hands a real date
 * cell back as YYYY-MM-DD (see xlsx.ts cellText), and anything else is a typist's format
 * we refuse to guess at: 03/04 is two different days depending on who typed it.
 */
export function dateCell(raw: string, t: Translate = passthrough): string {
  const value = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(t('opsFix.import.dateFormat', { value: raw }));
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(t('opsFix.import.dateInvalid', { value: raw }));
  return parsed.toISOString();
}

/** Payroll period cell, "YYYY-MM" — the same shape the server's PERIOD regex accepts. */
export function periodCell(raw: string, t: Translate = passthrough): string {
  const value = raw.trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error(t('opsFix.import.periodFormat', { value: raw }));
  return value;
}

/** Enum cell factory: upper-cases and checks membership. */
export function enumCell(allowed: readonly string[]) {
  return (raw: string, t: Translate = passthrough): string => {
    const value = raw.toUpperCase();
    if (!allowed.includes(value)) throw new Error(t('opsFix.import.oneOf', { allowed: allowed.join('/') }));
    return value;
  };
}

/**
 * Indonesian mobile number, canonicalized to the +628… form the server stores.
 *
 * Excel is the real adversary here. A phone typed into a General cell becomes a
 * number: losing the leading 0 is harmless (the server reads a bare 8… as +628…),
 * but a long one flips to scientific notation and genuinely loses digits. That case
 * is rejected loudly rather than guessed at — the fix belongs in the spreadsheet.
 */
export function phoneCell(raw: string, t: Translate = passthrough): string {
  const cleaned = raw.replace(/[\s\-().]/g, '');
  if (/e[+-]?\d+$/i.test(cleaned)) {
    throw new Error(
      `"${raw}" rusak jadi notasi ilmiah oleh Excel — format kolom telepon sebagai Teks lalu ketik ulang`,
    );
  }
  const e164 = cleaned.startsWith('+62')
    ? cleaned
    : cleaned.startsWith('62')
      ? `+${cleaned}`
      : cleaned.startsWith('0')
        ? `+62${cleaned.slice(1)}`
        : cleaned.startsWith('8')
          ? `+62${cleaned}`
          : cleaned;
  if (!/^\+628\d{7,11}$/.test(e164)) {
    throw new Error(t('opsFix.import.phoneInvalid', { value: raw }));
  }
  return e164;
}

/** The parser a column uses: explicit `parse`, else its `options`, else raw text. */
function parserFor(column: ImportColumn): (raw: string, t: Translate) => unknown {
  if (column.parse) return column.parse;
  if (column.options) return enumCell(column.options);
  return (raw) => raw;
}

/** Validate + shape each record into the JSON payload; a rejected row carries its reason. */
export function prepareRows(
  records: CsvRecord[],
  columns: ImportColumn[],
  t: Translate = passthrough,
): PreparedRow[] {
  return records.map((raw, i) => {
    const row = i + 1;
    const payload: Record<string, unknown> = {};
    for (const col of columns) {
      const cell = raw[col.key] ?? '';
      if (cell === '') {
        if (col.required) return { row, raw, error: t('opsFix.import.columnRequired', { column: col.key }) };
        continue;
      }
      try {
        payload[col.field ?? col.key] = parserFor(col)(cell, t);
      } catch (err) {
        return {
          row,
          raw,
          error: `${col.key}: ${err instanceof Error ? err.message : 'tidak valid'}`,
        };
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
  /** Dictionary KEY, resolved here — a caller may be a server component (audit F-6). */
  title: string;
  description?: string;
  columns: ImportColumn[];
  endpoint: string;
  templateName: string;
  /** Extra top-level body fields sent alongside `rows` (e.g. the selected depot). */
  body?: Record<string, unknown>;
  onDone?: () => void;
}) {
  const { t } = useT();
  const [rows, setRows] = useState<PreparedRow[] | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ImportResponse | null>(null);

  const headers = columns.map((c) => c.key);
  const valid = rows?.filter((r) => r.payload) ?? [];
  const invalid = rows?.filter((r) => r.error) ?? [];

  async function downloadTemplate() {
    // The template is .xlsx on purpose: only a spreadsheet can carry the Text format
    // on the phone column and the dropdowns on the enum columns. A CSV template can't.
    setFileError(null);
    try {
      downloadBlob(`${templateName}.xlsx`, await buildTemplateXlsx(columns, templateName));
    } catch {
      // Excel writer unavailable (offline chunk) — the CSV template still gets them going.
      downloadCsv(`${templateName}.csv`, toCsv(headers, [columns.map((c) => c.example)]));
    }
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file after a fix
    if (!file) return;
    setResult(null);
    setFileError(null);
    setRows(null);

    const kind = classifyImportFile(file.name);
    if (kind === 'legacy') {
      setFileError(
        'Format lama (.xls / .ods) tidak bisa dibaca. Buka filenya, lalu "Save As" → Excel Workbook (.xlsx).',
      );
      return;
    }
    if (kind === 'unsupported') {
      setFileError(t('opsFix.import.wrongFileType', { name: file.name }));
      return;
    }

    let records: CsvRecord[];
    try {
      records =
        kind === 'spreadsheet' ? await parseXlsxRecords(file) : parseCsvRecords(await file.text());
    } catch {
      // A file with the right extension can still be corrupt or password-protected.
      setFileError('File tidak bisa dibaca. Pastikan tidak rusak atau terkunci password.');
      return;
    }

    const first = records[0];
    if (!first) {
      setFileError(t('opsFix.import.emptyFile'));
      return;
    }
    if (records.length > MAX_IMPORT_ROWS) {
      setFileError(t('opsFix.import.tooManyRows', { max: MAX_IMPORT_ROWS, count: records.length }));
      return;
    }
    const missing = columns.filter((c) => c.required && !(c.key in first));
    if (missing.length > 0) {
      setFileError(t('opsFix.import.missingColumns', { columns: missing.map((c) => c.key).join(', ') }));
      return;
    }
    setRows(prepareRows(records, columns, t));
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

  /**
   * Rebuild a file of every row the user still has to fix (client- or server-rejected).
   *
   * .xlsx like the template, and for the same reason: this file exists to be corrected
   * and re-uploaded, so it has to survive the round trip. A CSV of it would hand Excel
   * a phone column to renumber before the user has even typed anything.
   */
  async function downloadFailed() {
    // The server numbers rows within the submitted (valid) subset, not the file.
    const failed = [
      ...invalid.map((r) => ({ raw: r.raw, reason: r.error ?? '' })),
      ...(result?.results ?? [])
        .filter((r) => r.status === 'failed')
        .map((r) => ({ raw: valid[r.row - 1]?.raw ?? {}, reason: r.message ?? '' })),
    ];
    const failedHeaders = [...headers, 'alasan_gagal'];
    const failedRows = failed.map(({ raw, reason }) => [
      ...headers.map((h) => raw[h] ?? ''),
      reason,
    ]);
    try {
      downloadBlob(
        // i18n-ok: download filename — what lands in the user's Downloads folder.
        `gagal-${templateName}.xlsx`,
        await toXlsxBlob(failedHeaders, failedRows, templateName),
      );
    } catch {
      // Excel writer unavailable (offline chunk) — CSV still gets the rows back to them.
      // i18n-ok: download filename.
      downloadCsv(`gagal-${templateName}.csv`, toCsv(failedHeaders, failedRows));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[22px] font-extrabold tracking-tight">{t(title)}</h1>
        {description && <p className="mt-1 text-[13.5px] text-muted">{description}</p>}
      </div>

      <Card className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <Button variant="secondary" onClick={downloadTemplate}>
            <DownloadSimple size={16} weight="bold" /> Unduh template Excel
          </Button>
          <label className="inline-flex">
            <input
              type="file"
              accept=".xlsx,.xlsm,.csv,text/csv"
              onChange={onPick}
              className="hidden"
            />
            <span className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-bold text-white">
              <UploadSimple size={16} weight="bold" /> Pilih file
            </span>
          </label>
        </div>
        <p className="text-[12.5px] text-muted">
          Terima .xlsx dan .csv. Maksimal {MAX_IMPORT_ROWS} baris. Kolom wajib:{' '}
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
              <Button variant="secondary" onClick={() => void downloadFailed()}>
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
            {result.updated > 0 && <Badge tone="brand">{result.updated} diperbarui</Badge>}
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
            <Button variant="secondary" onClick={() => void downloadFailed()} className="self-start">
              <DownloadSimple size={16} weight="bold" /> Unduh baris gagal
            </Button>
          )}
        </Card>
      )}
    </div>
  );
}

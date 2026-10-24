import type { CsvCell } from '@/lib/csv';

export type ExportTable = { headers: string[]; rows: CsvCell[][] };

const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A cell a spreadsheet can hold; anything nested is left out rather than printed as [object Object]. */
const cell = (v: unknown): CsvCell | undefined =>
  v == null || typeof v === 'string' || typeof v === 'number'
    ? (v as CsvCell)
    : typeof v === 'boolean'
      ? String(v)
      : undefined;

/**
 * The rows a widget's answer can honestly be exported as: the answer itself when it is a list of
 * records, or else its first list of records. Anything else (a single total, a chart series of
 * bare numbers) has no table in it, so it returns null and the menu offers no export.
 */
export function exportTable(data: unknown): ExportTable | null {
  const list = Array.isArray(data)
    ? data
    : isPlain(data)
      ? Object.values(data).find((v) => Array.isArray(v) && v.length > 0 && v.every(isPlain))
      : undefined;
  if (!Array.isArray(list) || list.length === 0 || !list.every(isPlain)) return null;
  const headers = [
    ...new Set(list.flatMap((r) => Object.keys(r).filter((k) => cell(r[k]) !== undefined))),
  ];
  if (headers.length === 0) return null;
  return { headers, rows: list.map((r) => headers.map((h) => cell(r[h]) ?? null)) };
}

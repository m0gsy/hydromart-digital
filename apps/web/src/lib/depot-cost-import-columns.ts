import { intCell, type ImportColumn } from '@/components/csv-import';

/**
 * Month cell, `YYYY-MM`. Excel turns "2026-11" into a date on its own, so the template column is
 * Text and a cell that arrives as a date (2026-11-01) is read as its month instead of refused:
 * the person plainly meant November.
 */
export function monthCell(raw: string, t: (key: string, vars?: Record<string, string | number>) => string = (k) => k): string {
  const value = raw.trim();
  const m = /^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?$/.exec(value);
  if (!m) throw new Error(t('hq.depotCosts.import.notAMonth', { value: raw }));
  return `${m[1]}-${m[2]}`;
}

// HD-16 (D22): one row per depot, month and category. A blank amount never reaches the server
// (required), so "no rent this month" is written as 0 on purpose.
export const DEPOT_COST_IMPORT_COLUMNS: ImportColumn[] = [
  // i18n-ok: sample cell values in the column guide, shown verbatim as the file must contain them.
  { key: 'depotCode', required: true, example: 'JKT-01', text: true },
  { key: 'month', required: true, example: '2026-11', text: true, parse: monthCell },
  { key: 'category', required: true, example: 'sewa' },
  { key: 'amountIdr', required: true, example: '3500000', parse: intCell },
  { key: 'note', example: 'kontrak sampai Des 2027' },
];

// The B2B prospect import file (AREA-2b): the columns, the template and the row shaping. The 19 columns are
// the AREA-T contract and live in @hydromart/access, the same array the server reads.
import { B2B_CATEGORIES, IMPORT_COLUMNS } from '@hydromart/access';

import type { CsvRecord } from './csv';
import type { TemplateColumn } from './xlsx';

/** Only these must be present in the header; every other column is optional and extras are ignored. */
export const REQUIRED_COLUMNS = ['name', 'category', 'lat', 'lng', 'source', 'license'] as const;

const SOURCES = ['overture', 'osm', 'foursquare_os', 'internal'];
/** Kept as text so Excel does not strip leading zeros or turn a code into a number. */
const TEXT_COLUMNS = ['phone', 'kecamatanCode', 'kelurahanCode', 'gridCell', 'sourceId', 'ownerDepotCode'];
const EXAMPLES: Record<string, string> = {
  name: 'Kos Melati',
  category: 'kos',
  address: 'Jl. Melati No. 3',
  phone: '+6281234567890',
  lat: '-6.2',
  lng: '106.8',
  source: 'osm',
  license: 'ODbL-1.0',
  sourceId: 'node/123',
  sourceUpdated: '2026-11-01',
};

export const templateColumns: TemplateColumn[] = IMPORT_COLUMNS.map((key) => ({
  key,
  example: EXAMPLES[key] ?? '',
  text: TEXT_COLUMNS.includes(key),
  options:
    key === 'category' ? B2B_CATEGORIES.map((c) => c.toLowerCase()) : key === 'source' ? SOURCES : undefined,
}));

export type ImportRow = Record<(typeof IMPORT_COLUMNS)[number], string>;

/** The required columns the header lacks (read from the first record: records are keyed by header). */
export function missingColumns(first: CsvRecord): string[] {
  return REQUIRED_COLUMNS.filter((c) => !(c in first));
}

/** A record as the 19 candidate columns, every value a string (the server reads '' as absent). */
export function toImportRows(records: readonly CsvRecord[]): ImportRow[] {
  return records.map((r) => Object.fromEntries(IMPORT_COLUMNS.map((k) => [k, String(r[k] ?? '')])) as ImportRow);
}

/** Cheap identity of a parsed file: a commit is only offered for the file that was checked. */
export function rowsHash(rows: readonly ImportRow[]): string {
  const s = JSON.stringify(rows);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return `${rows.length}:${h}`;
}

export interface ImportRowResult {
  row: number;
  status: 'created' | 'updated' | 'skipped' | 'failed';
  reason?: string;
  message?: string;
  id?: string;
}

export interface ImportSummary {
  dryRun: boolean;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  reasons: Record<string, number>;
  results: ImportRowResult[];
}

export const REFUSAL_REASONS = ['LICENCE', 'DO_NOT_CONTACT', 'ALREADY_CUSTOMER', 'DUPLICATE'] as const;

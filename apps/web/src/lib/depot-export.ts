import { api } from './api';
import type { CsvCell } from './csv';
import { DEPOT_IMPORT_COLUMNS } from './depot-import-columns';
import type { ImportColumn } from '@/components/csv-import';
import { endpoints } from './endpoints';

/** Every depot as import rows (depotAdmin: the rows carry bank accounts), capped by the server. */
export function fetchDepotExport() {
  return api.get<{ rows: Record<string, unknown>[]; total: number }>(endpoints.depots.exportRows, true);
}

/** The inverse of `areaCell`: `lat,lng|lat,lng#…`. */
const areaText = (rings: { lat: number; lng: number }[][]): string =>
  rings.map((ring) => ring.map((p) => `${p.lat},${p.lng}`).join('|')).join('#');

/** The inverse of `holidaysCell`: `2026-08-17:Hari Kemerdekaan|2026-12-25`. */
const holidaysText = (items: { date: string; label?: string }[]): string =>
  items.map((h) => (h.label ? `${h.date}:${h.label}` : h.date)).join('|');

function pick(row: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((node, key) => (node as Record<string, unknown> | null)?.[key], row);
}

/**
 * One server export row as the cells of the import sheet, in the sheet's own column order
 * and spelling, so the file it makes goes back through the import untouched. An empty list
 * or area is a blank cell: blank never clears anything on import.
 */
export function depotExportCells(
  row: Record<string, unknown>,
  columns: readonly ImportColumn[] = DEPOT_IMPORT_COLUMNS,
): CsvCell[] {
  return columns.map((col) => {
    const value = pick(row, col.field ?? col.key);
    if (value === null || value === undefined) return '';
    if (col.key === 'areaLayanan') return areaText(value as never);
    if (col.key === 'hariLibur') return holidaysText(value as never);
    return value as CsvCell;
  });
}

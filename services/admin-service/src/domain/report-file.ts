import { ExportFormat } from './export';
import { ReportRow } from '../application/ports/report-source.port';

// exceljs is a runtime dependency loaded lazily, the same way hr-service loads it: typecheck
// and dev do not need it installed, `npm ci` provides it in CI and prod, and a missing
// package raises a clear error rather than writing a fake file.
interface ExcelWorksheet {
  addRow(values: (string | number)[]): void;
  getRow(n: number): { font: { bold: boolean } };
}
interface ExcelWorkbook {
  addWorksheet(name: string): ExcelWorksheet;
  xlsx: { writeBuffer(): Promise<ArrayBuffer | Buffer> };
}
interface ExcelModule {
  Workbook: new () => ExcelWorkbook;
}

const HEADERS = ['Label', 'Pesanan', 'Pendapatan'] as const;

/** RFC 4180 quoting. A depot called `Depot "Baru", Cibubur` must not split into two columns. */
function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Render report rows as the requested file.
 *
 * PDF is refused rather than silently downgraded: there is no PDF renderer anywhere in this
 * repo, and handing back an .xlsx under a .pdf name is how a format option survives for
 * years without anyone noticing it never worked.
 */
export async function renderReport(
  rows: ReportRow[],
  format: ExportFormat,
  sheetName: string,
): Promise<Buffer> {
  const values = rows.map((r) => [r.label, r.orders, r.revenue] as (string | number)[]);

  if (format === ExportFormat.CSV) {
    const lines = [HEADERS.join(','), ...values.map((row) => row.map(csvCell).join(','))];
    // BOM so Excel opens a UTF-8 file as UTF-8 rather than as the system codepage.
    return Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8');
  }
  if (format !== ExportFormat.XLSX) {
    throw new Error(`Format ${format} belum didukung — tidak ada renderer-nya di repo ini.`);
  }

  let ExcelJS: ExcelModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ExcelJS = require('exceljs') as ExcelModule;
  } catch {
    throw new Error('Ekspor Excel butuh paket "exceljs" (jalankan npm ci di server).');
  }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName.slice(0, 31)); // Excel sheet-name limit
  ws.addRow([...HEADERS]);
  ws.getRow(1).font = { bold: true };
  for (const row of values) ws.addRow(row);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
}

/** `laporan-harian-2026-08-12.xlsx` — the window, not the run time, so reruns collide by name. */
export function reportFileName(name: string, from: Date, format: ExportFormat): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'laporan';
  // tz-ok: `from` is a period boundary this service built with Date.UTC in reportWindow(),
  // so it is already a day key sitting at UTC midnight — slicing it re-reads the same day
  // it was constructed as. Passing it through localDayKey would SHIFT it into WIB and name
  // the file after the day before.
  return `${slug}-${from.toISOString().slice(0, 10)}.${format.toLowerCase()}`;
}

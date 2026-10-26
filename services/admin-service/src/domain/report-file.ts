import { BUSINESS_TIME_ZONE, localDayKey } from '@hydromart/platform';

import { ExportFormat } from './export';
import { ReportRow } from '../application/ports/report-source.port';
import { ReportCell, ReportColumnType, ReportTable, revenueTable } from './report-table';

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

// pdfkit is a plain dependency (as in order-service/hr-service) but typed by hand below:
// those two renderers do the same, and only a handful of calls are used.
interface PdfDoc {
  page: { height: number; width: number };
  font(name: string): PdfDoc;
  fontSize(n: number): PdfDoc;
  text(s: string, x?: number, y?: number, opts?: Record<string, unknown>): PdfDoc;
  moveTo(x: number, y: number): PdfDoc;
  lineTo(x: number, y: number): PdfDoc;
  strokeColor(c: string): PdfDoc;
  stroke(): PdfDoc;
  addPage(): PdfDoc;
  on(event: string, cb: (chunk?: Buffer) => void): PdfDoc;
  end(): void;
}
type PdfModule = new (opts?: Record<string, unknown>) => PdfDoc;

const PDF_MARGIN = 40;
const PDF_LINE = 14;
const PDF_GAP = 6;

/**
 * RFC 4180 quoting, plus ADM-9: a cell is data, never a formula.
 *
 * A depot called `Depot "Baru", Cibubur` must not split into two columns — that part was
 * already handled. What was not: Excel and Sheets treat a cell starting `=`, `+`, `-` or
 * `@` as a formula, and these rows are labels typed by staff into product and depot names.
 * `=HYPERLINK(...)` exfiltrating the row to a URL, or `=WEBSERVICE(...)` fetching one, runs
 * when head office opens the scheduled report. Neither needs macros enabled.
 *
 * A leading apostrophe is the neutraliser every spreadsheet agrees on: the cell shows what
 * was typed and evaluates nothing. Tab and CR get it too — a reader that trims leading
 * whitespace turns "\t=CMD" back into a formula.
 */
export function csvCell(value: string | number): string {
  const text = String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** A cell as a spreadsheet/CSV value: dates read on the business calendar, never as raw UTC. */
function cellValue(type: ReportColumnType, v: ReportCell): string | number {
  if (v === null || v === undefined) return '';
  if (type === 'date' && typeof v === 'string') {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return v;
    // sv-SE reads "2026-10-26 07:00" — sortable, and unambiguous in every locale.
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: BUSINESS_TIME_ZONE,
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(d);
  }
  return v;
}

/** The PDF's version of a cell: money and counts get Indonesian grouping. */
function pdfValue(type: ReportColumnType, v: ReportCell): string {
  const raw = cellValue(type, v);
  if (typeof raw === 'string') return raw;
  if (type === 'money') return `Rp${Math.round(raw).toLocaleString('id-ID')}`;
  if (type === 'percent') return `${raw.toLocaleString('id-ID')}%`;
  return raw.toLocaleString('id-ID');
}

const isNumeric = (t: ReportColumnType): boolean => t === 'int' || t === 'money' || t === 'percent';

function renderPdf(table: ReportTable, title: string, compress: boolean): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const PDFDocument = require('pdfkit') as PdfModule;
  // Wide tables (an order list has a dozen columns) get a landscape page and a smaller face;
  // squeezing them onto portrait A4 made every cell an ellipsis.
  const wide = table.columns.length > 6;
  const doc = new PDFDocument({
    size: 'A4',
    layout: wide ? 'landscape' : 'portrait',
    margin: PDF_MARGIN,
    compress,
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve) => {
    doc.on('data', (c) => c && chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  const left = PDF_MARGIN;
  const width = doc.page.width - PDF_MARGIN * 2;
  const bottom = doc.page.height - PDF_MARGIN;
  const fontSize = wide ? 7 : 9;
  let y = PDF_MARGIN;

  const room = (h: number, repeat?: () => void): void => {
    if (y + h <= bottom) return;
    doc.addPage();
    y = PDF_MARGIN;
    repeat?.();
  };

  // Text columns take twice the share of a numeric one — names are the long cells.
  const weights = table.columns.map((c) => (isNumeric(c.type) ? 1 : 2));
  const unit = (width - PDF_GAP * (table.columns.length - 1)) / weights.reduce((a, b) => a + b, 0);
  let x = left;
  const cols = table.columns.map((c, i) => {
    const w = weights[i] * unit;
    const col = { x, w, right: isNumeric(c.type) };
    x += w + PDF_GAP;
    return col;
  });
  const rowOf = (values: string[], bold = false): void => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
    cols.forEach((c, i) =>
      doc.text(values[i] ?? '', c.x, y, {
        width: c.w,
        align: c.right ? 'right' : 'left',
        lineBreak: false,
        ellipsis: true,
      }),
    );
    y += PDF_LINE;
  };
  const rule = (): void => {
    doc
      .strokeColor('#999999')
      .moveTo(left, y)
      .lineTo(left + width, y)
      .stroke();
    y += 4;
  };
  const head = (): void => {
    rowOf(
      table.columns.map((c) => c.label),
      true,
    );
    rule();
  };

  doc.font('Helvetica-Bold').fontSize(16).text(title, left, y, { width, align: 'center' });
  y += 26;
  rule();
  y += 8;

  room(PDF_LINE * 2);
  head();
  if (table.rows.length === 0) {
    room(PDF_LINE);
    rowOf(['Tidak ada data pada periode ini.']);
  } else {
    for (const r of table.rows) {
      room(PDF_LINE, head);
      rowOf(table.columns.map((c, i) => pdfValue(c.type, r[i] ?? null)));
    }
    if (table.totals) {
      room(PDF_LINE * 2);
      y += 6;
      const totals = table.totals;
      rowOf(
        table.columns.map((c, i) => (totals[i] == null ? '' : pdfValue(c.type, totals[i]))),
        true,
      );
    }
  }

  doc.end();
  return done;
}

/**
 * Render a table as the requested file. One table, three renderers, so the formats can never
 * disagree — see revenue-export-pdf.ts in order-service for the identical reasoning.
 */
export async function renderTable(
  table: ReportTable,
  format: ExportFormat,
  sheetName: string,
  opts: { pdfCompress?: boolean } = {},
): Promise<Buffer> {
  const headers = table.columns.map((c) => c.label);
  const values = table.rows.map((r) =>
    table.columns.map((c, i) => cellValue(c.type, r[i] ?? null)),
  );

  if (format === ExportFormat.CSV) {
    const lines = [headers.join(','), ...values.map((row) => row.map(csvCell).join(','))];
    // BOM so Excel opens a UTF-8 file as UTF-8 rather than as the system codepage.
    return Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8');
  }
  if (format === ExportFormat.PDF) {
    return renderPdf(table, sheetName.slice(0, 80), opts.pdfCompress ?? true);
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
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };
  for (const row of values) ws.addRow(row);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
}

/** The three-column revenue rows, rendered. Kept for callers that still hold plain rows. */
export function renderReport(
  rows: ReportRow[],
  format: ExportFormat,
  sheetName: string,
  opts: { pdfCompress?: boolean } = {},
): Promise<Buffer> {
  return renderTable(revenueTable(rows), format, sheetName, opts);
}

/** `laporan-harian-2026-08-12.xlsx` — the window, not the run time, so reruns collide by name. */
export function reportFileName(name: string, from: Date, format: ExportFormat): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'laporan';
  // `from` is a WIB-midnight boundary built by reportWindow(), i.e. 17:00 UTC the day BEFORE. The UTC
  // slice would name the file after that previous day, so the name is read on the WIB calendar.
  return `${slug}-${localDayKey(from)}.${format.toLowerCase()}`;
}

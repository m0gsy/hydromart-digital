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

const HEADERS = ['Label', 'Pesanan', 'Pendapatan'] as const;

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

/** The same rows as the CSV/XLSX siblings, as a one-table printable PDF sheet. */
function renderPdf(rows: ReportRow[], title: string, compress: boolean): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const PDFDocument = require('pdfkit') as PdfModule;
  const doc = new PDFDocument({ size: 'A4', margin: PDF_MARGIN, compress });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve) => {
    doc.on('data', (c) => c && chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  const left = PDF_MARGIN;
  const width = doc.page.width - PDF_MARGIN * 2;
  const bottom = doc.page.height - PDF_MARGIN;
  let y = PDF_MARGIN;

  const room = (h: number, repeat?: () => void): void => {
    if (y + h <= bottom) return;
    doc.addPage();
    y = PDF_MARGIN;
    repeat?.();
  };

  const cols = [
    { x: left, w: 300 },
    { x: left + 310, w: 80, right: true },
    { x: left + 400, w: 115, right: true },
  ];
  const rowOf = (values: string[], bold = false): void => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    cols.forEach((c, i) =>
      doc.text(values[i] ?? '', c.x, y, {
        width: c.w,
        align: c.right ? 'right' : 'left',
        lineBreak: false,
      }),
    );
    y += PDF_LINE;
  };
  const rule = (): void => {
    doc.strokeColor('#999999').moveTo(left, y).lineTo(left + width, y).stroke();
    y += 4;
  };
  const head = (): void => {
    rowOf([...HEADERS], true);
    rule();
  };

  doc.font('Helvetica-Bold').fontSize(16).text(title, left, y, { width, align: 'center' });
  y += 26;
  rule();
  y += 8;

  room(PDF_LINE * 2);
  head();
  if (rows.length === 0) {
    room(PDF_LINE);
    rowOf(['Tidak ada data pada periode ini.', '', '']);
  } else {
    for (const r of rows) {
      room(PDF_LINE, head);
      rowOf([r.label, String(r.orders), `Rp${Math.round(r.revenue).toLocaleString('id-ID')}`]);
    }
    room(PDF_LINE * 2);
    y += 6;
    const totalOrders = rows.reduce((s, r) => s + r.orders, 0);
    const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
    rowOf(['Total', String(totalOrders), `Rp${Math.round(totalRevenue).toLocaleString('id-ID')}`], true);
  }

  doc.end();
  return done;
}

/**
 * Render report rows as the requested file. The SAME rows the XLSX/CSV siblings write, so
 * the three formats can never disagree — see revenue-export-pdf.ts in order-service for the
 * identical reasoning.
 */
export async function renderReport(
  rows: ReportRow[],
  format: ExportFormat,
  sheetName: string,
  opts: { pdfCompress?: boolean } = {},
): Promise<Buffer> {
  const values = rows.map((r) => [r.label, r.orders, r.revenue] as (string | number)[]);

  if (format === ExportFormat.CSV) {
    const lines = [HEADERS.join(','), ...values.map((row) => row.map(csvCell).join(','))];
    // BOM so Excel opens a UTF-8 file as UTF-8 rather than as the system codepage.
    return Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8');
  }
  if (format === ExportFormat.PDF) {
    return renderPdf(rows, sheetName.slice(0, 80), opts.pdfCompress ?? true);
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
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'laporan';
  // tz-ok: `from` is a period boundary this service built with Date.UTC in reportWindow(),
  // so it is already a day key sitting at UTC midnight — slicing it re-reads the same day
  // it was constructed as. Passing it through localDayKey would SHIFT it into WIB and name
  // the file after the day before.
  return `${slug}-${from.toISOString().slice(0, 10)}.${format.toLowerCase()}`;
}

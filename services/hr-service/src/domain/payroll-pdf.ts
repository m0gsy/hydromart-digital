// pdfkit is a runtime dependency loaded lazily (see xlsx.ts rationale).
interface PdfDoc {
  fontSize(n: number): PdfDoc;
  text(s: string, opts?: Record<string, unknown>): PdfDoc;
  moveDown(n?: number): PdfDoc;
  on(event: string, cb: (chunk?: Buffer) => void): PdfDoc;
  end(): void;
}
interface PdfModule {
  new (opts?: Record<string, unknown>): PdfDoc;
}

/** A started document plus the promise of its finished bytes. */
interface StartedPdf {
  doc: PdfDoc;
  done: Promise<Buffer>;
}

/**
 * Load pdfkit and open a document, or reject with something an operator can act on.
 * Shared by the payslip and the generic table export so there is one place that knows
 * pdfkit is optional at runtime.
 */
function startPdf(): StartedPdf | { error: Error } {
  let PDFDocument: PdfModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    PDFDocument = require('pdfkit') as PdfModule;
  } catch {
    return { error: new Error('Ekspor PDF butuh paket "pdfkit" (jalankan npm ci di server).') };
  }
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve) => {
    doc.on('data', (c) => c && chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });
  return { doc, done };
}

export interface SlipData {
  employeeName: string;
  employeeCode: string;
  periodMonth: string;
  status: string;
  lines: { label: string; amount: number; deduction: boolean }[];
  net: number;
}

const idr = (n: number): string => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

/** Render a one-page salary-slip PDF. Resolves to the finished PDF bytes. */
export function payrollSlipPdf(data: SlipData): Promise<Buffer> {
  const started = startPdf();
  if ('error' in started) return Promise.reject(started.error);
  const { doc, done } = started;

  doc.fontSize(18).text('Slip Gaji — Hydromart', { align: 'center' });
  doc.moveDown();
  doc.fontSize(11).text(`Karyawan : ${data.employeeName} (${data.employeeCode})`);
  doc.text(`Periode  : ${data.periodMonth}`);
  doc.text(`Status   : ${data.status}`);
  doc.moveDown();
  for (const line of data.lines) {
    doc.text(`${line.deduction ? '−' : ' '} ${line.label}`, { continued: true });
    doc.text(idr(line.amount), { align: 'right' });
  }
  doc.moveDown();
  doc.fontSize(13).text('Gaji Bersih (Net)', { continued: true });
  doc.text(idr(data.net), { align: 'right' });
  doc.end();
  return done;
}

/** How many data rows one PDF export will render before it stops. */
export const PDF_ROW_LIMIT = 500;

export interface TableReport {
  title: string;
  /** Free-text line under the title: the period, the depot, whatever scopes the numbers. */
  subtitle?: string;
  headers: string[];
  rows: (string | number | null | undefined)[][];
}

/**
 * Any report as a PDF. Deliberately plain — pdfkit has no table primitive, so columns are
 * tab-joined text. CSV and XLSX remain the formats for analysis; this one is for printing
 * and attaching.
 *
 * Long reports are truncated at PDF_ROW_LIMIT and SAY SO on the page. A silently short PDF
 * is worse than no PDF: it reads as the complete picture.
 */
export function tableReportPdf(report: TableReport): Promise<Buffer> {
  const started = startPdf();
  if ('error' in started) return Promise.reject(started.error);
  const { doc, done } = started;

  doc.fontSize(16).text(report.title, { align: 'center' });
  if (report.subtitle) doc.fontSize(10).text(report.subtitle, { align: 'center' });
  doc.moveDown();

  const line = (cells: (string | number | null | undefined)[]): string =>
    cells.map((c) => (c == null ? '' : String(c))).join('  |  ');

  doc.fontSize(9).text(line(report.headers));
  doc.moveDown(0.3);
  for (const row of report.rows.slice(0, PDF_ROW_LIMIT)) doc.text(line(row));

  if (report.rows.length > PDF_ROW_LIMIT) {
    doc.moveDown();
    doc
      .fontSize(10)
      .text(
        `Menampilkan ${PDF_ROW_LIMIT} dari ${report.rows.length} baris. ` +
          'Unduh format CSV atau XLSX untuk data lengkap.',
      );
  }
  doc.end();
  return done;
}

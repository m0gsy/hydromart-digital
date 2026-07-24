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
  let PDFDocument: PdfModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    PDFDocument = require('pdfkit') as PdfModule;
  } catch {
    return Promise.reject(new Error('Ekspor PDF butuh paket "pdfkit" (jalankan npm ci di server).'));
  }
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve) => {
    doc.on('data', (c) => c && chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

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

import type { DepotDailyReport, DepotDailyRow } from './report.service';

/**
 * The daily depot report as a PDF — the sheet an owner prints or forwards, where the CSV and
 * Excel exports next to it are for analysis.
 *
 * It renders the SAME `DepotDailyReport` and rows the screen and the other exports read, so
 * the three cannot disagree. Nothing is recomputed here except the layout: a figure the
 * service could not read stays "—" on paper, never a zero that reads as a measurement.
 *
 * pdfkit is a plain dependency (as in hr-service) but is typed by hand below: the payslip
 * renderer in hr-service does the same, and only a handful of calls are used.
 */
interface PdfDoc {
  page: {
    height: number;
    width: number;
    margins: { top: number; bottom: number; left: number; right: number };
  };
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

/** Orders listed before the sheet stops and says how many it left out. */
export const DAILY_PDF_ORDER_LIMIT = 300;

export interface DailyPdfInput {
  report: DepotDailyReport;
  /** The day's orders, cancelled ones included and flagged (same rows as the export). */
  rows: DepotDailyRow[];
  /** Depot name for the header; the id alone means nothing to whoever reads the paper. */
  depotLabel?: string;
  /** IANA zone the order times are printed in. */
  timeZone: string;
}

const MARGIN = 40;
const LINE = 14;
const UNREADABLE = '—';

const rupiah = (n: number): string => `Rp${Math.round(n).toLocaleString('id-ID')}`;
const money = (n: number | null): string => (n === null ? UNREADABLE : rupiah(n));
const count = (n: number | null): string => (n === null ? UNREADABLE : String(n));
const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

function clock(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

interface Col {
  x: number;
  w: number;
  right?: boolean;
}

/** Render the report. Resolves to the finished PDF bytes. */
export function depotDailyPdf(
  input: DailyPdfInput,
  opts: { compress?: boolean } = {},
): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const PDFDocument = require('pdfkit') as PdfModule;
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, compress: opts.compress ?? true });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve) => {
    doc.on('data', (c) => c && chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  const { report, rows } = input;
  const left = MARGIN;
  const width = doc.page.width - MARGIN * 2;
  const bottom = doc.page.height - MARGIN;
  let y = MARGIN;

  /** Start a new page when `h` more points would run past the bottom margin. */
  const room = (h: number, repeat?: () => void): void => {
    if (y + h <= bottom) return;
    doc.addPage();
    y = MARGIN;
    repeat?.();
  };

  const rowOf = (cols: Col[], values: string[], bold = false): void => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    cols.forEach((c, i) =>
      doc.text(values[i], c.x, y, {
        width: c.w,
        align: c.right ? 'right' : 'left',
        lineBreak: false,
      }),
    );
    y += LINE;
  };

  const rule = (): void => {
    doc
      .strokeColor('#999999')
      .moveTo(left, y)
      .lineTo(left + width, y)
      .stroke();
    y += 4;
  };

  const heading = (title: string): void => {
    room(LINE * 3);
    y += 8;
    doc.font('Helvetica-Bold').fontSize(11).text(title, left, y, { lineBreak: false });
    y += LINE + 2;
  };

  /** A table whose header row is repeated when it runs onto another page. */
  const table = (cols: Col[], header: string[], body: string[][]): void => {
    const head = (): void => {
      rowOf(cols, header, true);
      rule();
    };
    room(LINE * 3);
    head();
    for (const values of body) {
      room(LINE, head);
      rowOf(cols, values);
    }
  };

  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .text('Laporan Harian Depot', left, y, { width, align: 'center' });
  y += 22;
  const scope = input.depotLabel ? `${input.depotLabel} · ${report.date}` : report.date;
  doc
    .font('Helvetica')
    .fontSize(10)
    .text(scope, left, y, { width, align: 'center', lineBreak: false });
  y += 18;
  rule();

  heading('Ringkasan');
  const summary: [string, string][] = [
    ['Pesanan', String(report.orders)],
    ['Omzet', rupiah(report.revenueIdr)],
    ['Galon terkirim', String(report.gallonsDelivered)],
    ['Galon kembali', count(report.gallonsReturned)],
    ['Galon rusak', count(report.gallonsDamaged)],
    ['COD dikumpulkan kurir', money(report.codCollectedIdr)],
    ['Kas konter di laci', money(report.cashInDrawerIdr)],
    ['Antar gagal', String(report.failedDeliveries)],
  ];
  const kv: Col[] = [
    { x: left, w: 200 },
    { x: left + 210, w: 150, right: true },
  ];
  for (const [k, v] of summary) {
    room(LINE);
    rowOf(kv, [k, v]);
  }

  const { refill, partial, beli } = report.refillSplit;
  if (refill + partial + beli > 0) {
    heading('Galon isi ulang vs beli baru');
    const cols: Col[] = [
      { x: left, w: 260 },
      { x: left + 270, w: 110, right: true },
    ];
    table(
      cols,
      ['Jenis', 'Nota'],
      [
        ['Isi ulang (galon kosong ditukar penuh)', String(refill)],
        ['Sebagian (galon kosong ditukar sebagian)', String(partial)],
        ['Beli baru (tanpa galon kosong)', String(beli)],
      ],
    );
  }

  if (report.perCashier.length > 0) {
    heading('Penjualan konter per kasir');
    const cols: Col[] = [
      { x: left, w: 260 },
      { x: left + 270, w: 60, right: true },
      { x: left + 340, w: 110, right: true },
    ];
    table(
      cols,
      ['Kasir', 'Nota', 'Omzet'],
      report.perCashier.map((c) => [
        c.cashierId === null ? 'Tidak tercatat' : clip(c.label ?? c.cashierId, 44),
        String(c.orders),
        rupiah(c.revenueIdr),
      ]),
    );
  }

  const busy = report.byHour.filter((h) => h.orders > 0);
  if (busy.length > 0) {
    heading('Jam pesanan');
    const cols: Col[] = [
      { x: left, w: 80 },
      { x: left + 90, w: 60, right: true },
      { x: left + 160, w: 110, right: true },
    ];
    table(
      cols,
      ['Jam', 'Pesanan', 'Omzet'],
      busy.map((h) => [
        `${String(h.hour).padStart(2, '0')}:00`,
        String(h.orders),
        rupiah(h.revenueIdr),
      ]),
    );
  }

  if (report.perCourier.length > 0) {
    heading('Ringkasan kurir');
    const cols: Col[] = [
      { x: left, w: 220 },
      { x: left + 230, w: 60, right: true },
      { x: left + 300, w: 60, right: true },
      { x: left + 370, w: 110, right: true },
    ];
    table(
      cols,
      ['Kurir', 'Selesai', 'Gagal', 'COD'],
      report.perCourier.map((c) => [
        clip(c.name, 38),
        String(c.completed),
        String(c.failed),
        money(c.codIdr),
      ]),
    );
  }

  heading('Daftar pesanan');
  if (rows.length === 0) {
    room(LINE);
    rowOf([{ x: left, w: width }], ['Tidak ada pesanan pada hari ini.']);
  } else {
    const cols: Col[] = [
      { x: left, w: 95 },
      { x: left + 100, w: 35 },
      { x: left + 140, w: 120 },
      { x: left + 265, w: 100 },
      { x: left + 370, w: 30, right: true },
      { x: left + 405, w: 110, right: true },
    ];
    table(
      cols,
      ['No. pesanan', 'Jam', 'Penerima', 'Kurir', 'Galon', 'Total'],
      rows
        .slice(0, DAILY_PDF_ORDER_LIMIT)
        .map((r) => [
          r.orderNumber,
          clock(r.createdAt, input.timeZone),
          clip(r.isWalkIn ? `${r.recipientName} (konter)` : r.recipientName, 22),
          clip(r.driverName ?? '-', 18),
          String(r.gallons),
          r.cancelled ? 'Batal' : rupiah(r.totalIdr),
        ]),
    );
    if (rows.length > DAILY_PDF_ORDER_LIMIT) {
      room(LINE * 2);
      y += 6;
      rowOf(
        [{ x: left, w: width }],
        [
          `Menampilkan ${DAILY_PDF_ORDER_LIMIT} dari ${rows.length} pesanan. Unduh Excel atau CSV untuk data lengkap.`,
        ],
      );
    }
  }

  doc.end();
  return done;
}

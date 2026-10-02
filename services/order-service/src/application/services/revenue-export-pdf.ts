/**
 * The HQ revenue-export screen's PDF sheet — the same `label/orders/revenue` rows the
 * screen already rendered and that the Excel/CSV buttons next to it already write, so all
 * three formats can never disagree. See depot-daily-pdf.ts for the identical reasoning;
 * this is deliberately a second, self-contained renderer rather than a shared one, because
 * the two reports' layouts have nothing in common beyond "a table on A4".
 *
 * ponytail: the rows are supplied by the caller (already fetched for the on-screen table)
 * rather than recomputed here, because they come from three different services (dashboard
 * roll-up, order-service product revenue, payment-service by-method) and this report has
 * the same trust boundary the Excel/CSV export next to it already has — nothing here moves
 * money or approves anything. Recompute server-side if a tamper-proof PDF is ever required.
 */
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

const MARGIN = 40;
const LINE = 14;
const GROUP_LABEL: Record<string, string> = {
  depot: 'per depot',
  product: 'per produk',
  method: 'per metode pembayaran',
};

export interface RevenueExportRow {
  label: string;
  orders: number;
  revenue: number;
}

export interface RevenueExportPdfInput {
  group: 'depot' | 'product' | 'method';
  from: string;
  to: string;
  rows: RevenueExportRow[];
}

const rupiah = (n: number): string => `Rp${Math.round(n).toLocaleString('id-ID')}`;
const day = (iso: string): string => iso.slice(0, 10);

/** Render the revenue-export table as a PDF. Resolves to the finished bytes. */
export function revenueExportPdf(
  input: RevenueExportPdfInput,
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

  const left = MARGIN;
  const width = doc.page.width - MARGIN * 2;
  const bottom = doc.page.height - MARGIN;
  let y = MARGIN;

  const room = (h: number, repeat?: () => void): void => {
    if (y + h <= bottom) return;
    doc.addPage();
    y = MARGIN;
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
      doc.text(values[i], c.x, y, {
        width: c.w,
        align: c.right ? 'right' : 'left',
        lineBreak: false,
      }),
    );
    y += LINE;
  };

  const rule = (): void => {
    doc.strokeColor('#999999').moveTo(left, y).lineTo(left + width, y).stroke();
    y += 4;
  };

  const header = ['Label', 'Pesanan', 'Pendapatan'];
  const head = (): void => {
    rowOf(header, true);
    rule();
  };

  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .text(`Pendapatan ${GROUP_LABEL[input.group] ?? input.group}`, left, y, {
      width,
      align: 'center',
    });
  y += 22;
  doc
    .font('Helvetica')
    .fontSize(10)
    .text(`${day(input.from)} – ${day(input.to)}`, left, y, {
      width,
      align: 'center',
      lineBreak: false,
    });
  y += 18;
  rule();
  y += 8;

  room(LINE * 2);
  head();
  if (input.rows.length === 0) {
    room(LINE);
    rowOf(['Tidak ada data pada periode ini.', '', '']);
  } else {
    for (const r of input.rows) {
      room(LINE, head);
      rowOf([r.label, String(r.orders), rupiah(r.revenue)]);
    }
    room(LINE * 2);
    y += 6;
    const totalOrders = input.rows.reduce((s, r) => s + r.orders, 0);
    const totalRevenue = input.rows.reduce((s, r) => s + r.revenue, 0);
    rowOf(['Total', String(totalOrders), rupiah(totalRevenue)], true);
  }

  doc.end();
  return done;
}

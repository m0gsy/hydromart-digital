import type {
  DepotDailyReport,
  DepotDailyRow,
} from '../../src/application/services/report.service';
import {
  DAILY_PDF_ORDER_LIMIT,
  depotDailyPdf,
} from '../../src/application/services/depot-daily-pdf';

/**
 * pdfkit writes each text call as one `[<hex> kern <hex> …] TJ` operator. Rendering the PDF
 * uncompressed and reading those back gives the cells in draw order — enough to assert what
 * is on the sheet without a PDF parser.
 */
function cellsOf(pdf: Buffer): string[] {
  const out: string[] = [];
  for (const m of pdf.toString('latin1').matchAll(/\[([^\]]*)\]\s*TJ/g)) {
    const chunks = [...m[1].matchAll(/<([0-9a-f]*)>/g)].map((h) =>
      Buffer.from(h[1], 'hex').toString('latin1'),
    );
    out.push(chunks.join(''));
  }
  return out;
}

const pages = (pdf: Buffer): number =>
  (pdf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) ?? []).length;

// In WinAnsi, the encoding pdfkit's built-in Helvetica uses.
const EM_DASH = '\x97';
const ELLIPSIS = '\x85';

const row = (i: number, over: Partial<DepotDailyRow> = {}): DepotDailyRow => ({
  orderNumber: `HM-${1000 + i}`,
  createdAt: '2026-09-28T03:05:00.000Z', // 10:05 in Jakarta
  status: 'DELIVERED',
  cancelled: false,
  recipientName: 'Siti',
  driverName: 'Agus',
  gallons: 2,
  subtotalIdr: 40000,
  deliveryFeeIdr: 0,
  discountIdr: 0,
  totalIdr: 40000,
  isWalkIn: false,
  ...over,
});

const report = (over: Partial<DepotDailyReport> = {}): DepotDailyReport => ({
  depotId: '11111111-1111-1111-1111-111111111111',
  date: '2026-09-28',
  orders: 2,
  revenueIdr: 1250000,
  gallonsDelivered: 4,
  gallonsReturned: 3,
  gallonsDamaged: 0,
  codCollectedIdr: 80000,
  cashInDrawerIdr: 40000,
  failedDeliveries: 1,
  perCourier: [],
  byHour: Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0, revenueIdr: 0 })),
  perCashier: [],
  ...over,
});

const render = (r: DepotDailyReport, rows: DepotDailyRow[], depotLabel?: string) =>
  depotDailyPdf({ report: r, rows, depotLabel, timeZone: 'Asia/Jakarta' }, { compress: false });

describe('depotDailyPdf', () => {
  it('is a real PDF, compressed by default', async () => {
    const pdf = await depotDailyPdf({ report: report(), rows: [row(1)], timeZone: 'Asia/Jakarta' });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('%%EOF');
  });

  it('prints the title, the depot and day, and the summary figures', async () => {
    const cells = cellsOf(await render(report(), [row(1)], 'Depot Tirta Jaya'));
    expect(cells).toContain('Laporan Harian Depot');
    expect(cells).toContain('Depot Tirta Jaya \xb7 2026-09-28');
    expect(cells).toEqual(
      expect.arrayContaining(['Omzet', 'Rp1.250.000', 'COD dikumpulkan kurir', 'Rp80.000']),
    );
    expect(cells).toEqual(
      expect.arrayContaining(['Kas konter di laci', 'Rp40.000', 'Antar gagal', '1']),
    );
  });

  it('prints the day alone when no depot name is given', async () => {
    const cells = cellsOf(await render(report(), [row(1)]));
    expect(cells).toContain('2026-09-28');
  });

  it('prints an unreadable figure as a dash, never as zero', async () => {
    const cells = cellsOf(
      await render(
        report({
          gallonsReturned: null,
          gallonsDamaged: null,
          codCollectedIdr: null,
          cashInDrawerIdr: null,
        }),
        [row(1)],
      ),
    );
    // Four dashes in the summary: returned, damaged, COD, drawer. A `0` here would read as measured.
    expect(cells.filter((c) => c === EM_DASH)).toHaveLength(4);
    expect(cells).not.toContain('Rp0');
  });

  it('lists each order with the local time, and marks a cancelled one instead of pricing it', async () => {
    const cells = cellsOf(
      await render(report(), [
        row(1),
        row(2, { cancelled: true, status: 'CANCELLED', driverName: null }),
        row(3, { isWalkIn: true, recipientName: 'Umum' }),
      ]),
    );
    expect(cells).toEqual(expect.arrayContaining(['HM-1001', '10:05', 'Siti', 'Agus', 'Rp40.000']));
    expect(cells).toContain('Batal');
    expect(cells).toContain('Umum (konter)');
    expect(cells).toContain('-'); // no courier
  });

  it('clips a name too long for its column', async () => {
    const long = 'Nama penerima yang panjangnya jauh melebihi kolom';
    const cells = cellsOf(await render(report(), [row(1, { recipientName: long })]));
    const clipped = cells.find((c) => c.startsWith('Nama penerima'));
    expect(clipped).toBeDefined();
    expect(clipped!.length).toBeLessThan(long.length);
    expect(clipped!.endsWith(ELLIPSIS)).toBe(true);
  });

  it('says so when there were no orders', async () => {
    const cells = cellsOf(await render(report({ orders: 0, revenueIdr: 0 }), []));
    expect(cells).toContain('Tidak ada pesanan pada hari ini.');
    expect(cells).not.toContain('No. pesanan');
  });

  it('adds the cashier, hour, and courier sections only when they have something to show', async () => {
    const bare = cellsOf(await render(report(), [row(1)]));
    expect(bare).not.toContain('Penjualan konter per kasir');
    expect(bare).not.toContain('Jam pesanan');
    expect(bare).not.toContain('Ringkasan kurir');

    const byHour = report().byHour.map((h) =>
      h.hour === 9 ? { hour: 9, orders: 4, revenueIdr: 160000 } : h,
    );
    const full = cellsOf(
      await render(
        report({
          byHour,
          perCashier: [
            { cashierId: 'c1', label: '+62811', orders: 3, revenueIdr: 120000 },
            { cashierId: 'c2', label: null, orders: 1, revenueIdr: 40000 },
            { cashierId: null, label: null, orders: 2, revenueIdr: 80000 },
          ],
          perCourier: [
            { name: 'Agus', completed: 5, failed: 1, codIdr: 80000 },
            { name: 'Dedi', completed: 2, failed: 0, codIdr: null },
          ],
        }),
        [row(1)],
      ),
    );
    expect(full).toEqual(
      expect.arrayContaining(['Penjualan konter per kasir', '+62811', 'Rp120.000']),
    );
    expect(full).toContain('c2'); // no label recorded: the id stands in
    expect(full).toContain('Tidak tercatat');
    expect(full).toEqual(expect.arrayContaining(['Jam pesanan', '09:00', '4', 'Rp160.000']));
    expect(full).toEqual(expect.arrayContaining(['Ringkasan kurir', 'Agus', 'Dedi']));
    // 09:00 is the only hour with orders; the empty ones are not printed as rows.
    expect(full.filter((c) => /^\d\d:00$/.test(c))).toEqual(['09:00']);
  });

  it('breaks onto more pages, repeating the header, instead of running off the sheet', async () => {
    const pdf = await render(
      report({ orders: 120 }),
      Array.from({ length: 120 }, (_, i) => row(i)),
    );
    const headers = cellsOf(pdf).filter((c) => c === 'No. pesanan').length;
    expect(pages(pdf)).toBeGreaterThan(1);
    // Once where the table starts, again on every page it continues onto.
    expect(headers).toBeGreaterThan(1);
    expect(headers).toBeLessThanOrEqual(pages(pdf));
  });

  it('stops at the row limit and says how many it left out', async () => {
    const total = DAILY_PDF_ORDER_LIMIT + 25;
    const cells = cellsOf(
      await render(
        report(),
        Array.from({ length: total }, (_, i) => row(i)),
      ),
    );
    expect(cells.filter((c) => /^HM-\d+$/.test(c))).toHaveLength(DAILY_PDF_ORDER_LIMIT);
    expect(
      cells.some((c) => c.startsWith(`Menampilkan ${DAILY_PDF_ORDER_LIMIT} dari ${total} pesanan`)),
    ).toBe(true);
  });

  it('does not add a notice when every order fit', async () => {
    const cells = cellsOf(await render(report(), [row(1)]));
    expect(cells.some((c) => c.startsWith('Menampilkan'))).toBe(false);
  });
});
